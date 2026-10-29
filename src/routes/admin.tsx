/**
 * 관리 화면: SP 승인·중지·수정·삭제, client_secret 재발급, 등록 토큰 발급·폐기, 감사 로그.
 * ADMIN_EMAILS에 있는 학교 Google 계정만 들어올 수 있다.
 */
import { Hono, type Context } from "hono";
import type { Child } from "hono/jsx";
import { clearAdminSession, loadAdminSession } from "../admin-session";
import {
  AdminLayout,
  AuditPage,
  ClientDetailPage,
  ClientForm,
  ClientListPage,
  SecretShownPage,
  TokensPage,
  type ClientFormValues,
} from "../admin-views";
import { recentAudit, writeAudit } from "../audit";
import {
  ClientMetadataError,
  createClient,
  deleteClient,
  findClient,
  findDynamicClient,
  listDynamicClients,
  parseClientMetadata,
  rotateClientSecret,
  SENSITIVE_SCOPES,
  setClientStatus,
  staticClients,
  updateClientMetadata,
  type DynamicClient,
} from "../clients";
import { timingSafeEqual } from "../crypto";
import {
  createInitialAccessToken,
  listInitialAccessTokens,
  revokeInitialAccessToken,
} from "../initial-access-tokens";
import { errorPage, startGoogleLogin } from "../respond";
import type { HonoEnv } from "../types";
import { sameOrigin } from "./login";

type AdminContext = Context<HonoEnv>;

function page(c: AdminContext, title: string, body: Child, status: 200 | 400 | 404 = 200) {
  const { email, csrf } = c.var.admin;
  return c.html(
    <AdminLayout title={title} email={email} csrf={csrf}>
      {body}
    </AdminLayout>,
    status,
  );
}

function actor(c: AdminContext): string {
  return `admin:${c.var.admin.email}`;
}

function lines(value: unknown): string[] {
  return typeof value === "string"
    ? value
        .split(/\r?\n/)
        .map((v) => v.trim())
        .filter(Boolean)
    : [];
}

/** 관리 화면 폼을 RFC 7591 메타데이터 모양으로 바꿔 같은 검증을 거친다. */
function metadataFromForm(form: Record<string, unknown>) {
  const scopeField = form.scope;
  const scopes = Array.isArray(scopeField) ? scopeField : scopeField ? [scopeField] : [];
  const clientUri = typeof form.client_uri === "string" ? form.client_uri.trim() : "";
  return parseClientMetadata({
    client_name: form.client_name,
    redirect_uris: lines(form.redirect_uris),
    scope: ["openid", ...scopes.map(String)].join(" "),
    token_endpoint_auth_method: form.token_endpoint_auth_method,
    contacts: lines(form.contacts),
    ...(clientUri ? { client_uri: clientUri } : {}),
  });
}

function formValues(form: Record<string, unknown>): ClientFormValues {
  const scopeField = form.scope;
  const scopes = Array.isArray(scopeField) ? scopeField.map(String) : scopeField ? [String(scopeField)] : [];
  return {
    name: String(form.client_name ?? ""),
    redirectUris: String(form.redirect_uris ?? ""),
    scopes: new Set(scopes),
    tokenEndpointAuthMethod: String(form.token_endpoint_auth_method ?? "client_secret_basic"),
    contacts: String(form.contacts ?? ""),
    clientUri: String(form.client_uri ?? ""),
  };
}

function clientValues(client: DynamicClient): ClientFormValues {
  return {
    name: client.name,
    redirectUris: client.redirectUris.join("\n"),
    scopes: client.scopes,
    tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
    contacts: client.contacts.join("\n"),
    clientUri: client.clientUri ?? "",
  };
}

const EMPTY_FORM: ClientFormValues = {
  name: "",
  redirectUris: "",
  scopes: new Set(["openid", "email"]),
  tokenEndpointAuthMethod: "client_secret_basic",
  contacts: "",
  clientUri: "",
};

function intField(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

async function loadDynamic(c: AdminContext): Promise<DynamicClient | null> {
  return findDynamicClient(c.env.DB, c.req.param("clientId") ?? "");
}

function detailPath(clientId: string): string {
  return `/admin/clients/${encodeURIComponent(clientId)}`;
}

export const adminRoutes = new Hono<HonoEnv>()
  .get("/login", (c) => {
    if (c.var.config.adminEmails.size === 0) {
      return errorPage(c, 403, "관리 화면 미설정", "ADMIN_EMAILS가 비어 있어 관리 화면을 쓸 수 없습니다.");
    }
    return startGoogleLogin(c, { admin: true });
  })
  .use("*", async (c, next) => {
    const session = await loadAdminSession(c);
    if (!session) {
      if (c.req.method === "GET") return c.redirect("/admin/login", 302);
      return errorPage(c, 403, "로그인이 필요합니다", "관리 화면에 다시 로그인해 주세요.");
    }
    c.set("admin", session);
    if (c.req.method === "POST") {
      const form = await c.req.parseBody({ all: true });
      const csrf = form.csrf;
      if (typeof csrf !== "string" || !timingSafeEqual(csrf, session.csrf) || !sameOrigin(c)) {
        return errorPage(c, 403, "잘못된 요청", "요청이 만료되었거나 다른 사이트에서 보낸 요청입니다.");
      }
      c.set("form", form);
    }
    await next();
  })
  .post("/logout", (c) => {
    clearAdminSession(c);
    return c.redirect("/admin/login", 302);
  })
  .get("/", async (c) => {
    const dynamics = await listDynamicClients(c.env.DB);
    return page(c, "SP 목록", <ClientListPage statics={staticClients(c.var.config)} dynamics={dynamics} />);
  })
  .get("/clients/new", (c) =>
    page(
      c,
      "SP 추가",
      <>
        <h1>SP 추가</h1>
        <p>관리자가 만든 SP는 바로 활성 상태이며 검토한 것으로 표시됩니다.</p>
        <ClientForm action="/admin/clients" csrf={c.var.admin.csrf} values={EMPTY_FORM} submit="만들기" />
      </>,
    ),
  )
  .post("/clients", async (c) => {
    const form = c.var.form;
    let meta;
    try {
      meta = metadataFromForm(form);
    } catch (err) {
      if (!(err instanceof ClientMetadataError)) throw err;
      return page(
        c,
        "SP 추가",
        <>
          <h1>SP 추가</h1>
          <ClientForm
            action="/admin/clients"
            csrf={c.var.admin.csrf}
            values={formValues(form)}
            submit="만들기"
            error={err.message}
          />
        </>,
        400,
      );
    }
    const created = await createClient(c.env.DB, meta, {
      createdBy: actor(c),
      withRegistrationToken: false,
      reviewedBy: c.var.admin.email,
    });
    await writeAudit(c.env.DB, {
      actor: actor(c),
      action: "client.create",
      target: created.client.clientId,
      detail: { name: meta.name, scopes: meta.scopes, redirect_uris: meta.redirectUris },
    });
    return page(
      c,
      "SP 만듦",
      <SecretShownPage
        title={`${meta.name} 만듦`}
        items={[
          ["client_id", created.client.clientId],
          ["client_secret", created.clientSecret],
        ]}
        next={detailPath(created.client.clientId)}
      />,
    );
  })
  .get("/clients/:clientId", async (c) => {
    const client = await findClient(c.var.config, c.env.DB, c.req.param("clientId"));
    if (!client) return page(c, "없음", <h1>SP를 찾을 수 없습니다</h1>, 404);
    const form =
      client.source === "dynamic" ? (
        <ClientForm
          action={detailPath(client.clientId)}
          csrf={c.var.admin.csrf}
          values={clientValues(client as DynamicClient)}
          submit="저장"
        />
      ) : undefined;
    return page(c, client.name, <ClientDetailPage client={client} csrf={c.var.admin.csrf} form={form} />);
  })
  .post("/clients/:clientId", async (c) => {
    const client = await loadDynamic(c);
    if (!client) return page(c, "없음", <h1>SP를 찾을 수 없습니다</h1>, 404);
    const form = c.var.form;
    let meta;
    try {
      meta = metadataFromForm(form);
    } catch (err) {
      if (!(err instanceof ClientMetadataError)) throw err;
      const editor = (
        <ClientForm
          action={detailPath(client.clientId)}
          csrf={c.var.admin.csrf}
          values={formValues(form)}
          submit="저장"
          error={err.message}
        />
      );
      return page(c, client.name, <ClientDetailPage client={client} csrf={c.var.admin.csrf} form={editor} />, 400);
    }
    await updateClientMetadata(c.env.DB, client, meta, { byAdmin: c.var.admin.email });
    await writeAudit(c.env.DB, {
      actor: actor(c),
      action: "client.update",
      target: client.clientId,
      detail: { name: meta.name, scopes: meta.scopes, redirect_uris: meta.redirectUris },
    });
    return c.redirect(detailPath(client.clientId), 302);
  })
  .post("/clients/:clientId/approve", async (c) => {
    const client = await loadDynamic(c);
    if (!client) return page(c, "없음", <h1>SP를 찾을 수 없습니다</h1>, 404);
    // 중지된 SP는 승인으로 되살리지 않는다. 재개를 따로 누른다.
    const status = client.status === "suspended" ? "suspended" : "active";
    await setClientStatus(c.env.DB, client.clientId, status, c.var.admin.email);
    await writeAudit(c.env.DB, {
      actor: actor(c),
      action: "client.approve",
      target: client.clientId,
      detail: { scopes: [...client.scopes] },
    });
    return c.redirect(detailPath(client.clientId), 302);
  })
  .post("/clients/:clientId/suspend", async (c) => {
    const client = await loadDynamic(c);
    if (!client) return page(c, "없음", <h1>SP를 찾을 수 없습니다</h1>, 404);
    await setClientStatus(c.env.DB, client.clientId, "suspended");
    await writeAudit(c.env.DB, { actor: actor(c), action: "client.suspend", target: client.clientId });
    return c.redirect(detailPath(client.clientId), 302);
  })
  .post("/clients/:clientId/resume", async (c) => {
    const client = await loadDynamic(c);
    if (!client) return page(c, "없음", <h1>SP를 찾을 수 없습니다</h1>, 404);
    // 검토하지 않은 SP가 민감한 scope를 갖고 있으면 승인 대기로 돌아간다.
    const needsReview = !client.reviewed && [...client.scopes].some((s) => SENSITIVE_SCOPES.has(s));
    await setClientStatus(c.env.DB, client.clientId, needsReview ? "pending" : "active");
    await writeAudit(c.env.DB, { actor: actor(c), action: "client.resume", target: client.clientId });
    return c.redirect(detailPath(client.clientId), 302);
  })
  .post("/clients/:clientId/rotate-secret", async (c) => {
    const client = await loadDynamic(c);
    if (!client) return page(c, "없음", <h1>SP를 찾을 수 없습니다</h1>, 404);
    const secret = await rotateClientSecret(c.env.DB, client.clientId);
    await writeAudit(c.env.DB, { actor: actor(c), action: "client.rotate_secret", target: client.clientId });
    return page(
      c,
      "client_secret 재발급",
      <SecretShownPage
        title={`${client.name} client_secret 재발급`}
        items={[
          ["client_id", client.clientId],
          ["client_secret", secret],
        ]}
        next={detailPath(client.clientId)}
        note="이전 client_secret은 바로 쓸 수 없습니다. SP 설정을 곧바로 바꿔야 합니다."
      />,
    );
  })
  .post("/clients/:clientId/delete", async (c) => {
    const client = await loadDynamic(c);
    if (!client) return page(c, "없음", <h1>SP를 찾을 수 없습니다</h1>, 404);
    await deleteClient(c.env.DB, client.clientId);
    await writeAudit(c.env.DB, {
      actor: actor(c),
      action: "client.delete",
      target: client.clientId,
      detail: { name: client.name },
    });
    return c.redirect("/admin", 302);
  })
  .get("/tokens", async (c) => {
    const tokens = await listInitialAccessTokens(c.env.DB);
    return page(c, "등록 토큰", <TokensPage tokens={tokens} csrf={c.var.admin.csrf} issuer={c.var.config.issuer} />);
  })
  .post("/tokens", async (c) => {
    const form = c.var.form;
    const label = String(form.label ?? "").trim().slice(0, 100);
    if (!label) return c.redirect("/admin/tokens", 302);
    const maxUses = intField(form.max_uses, 1, 100, 1);
    const ttlDays = intField(form.ttl_days, 1, 90, 7);
    const { id, token } = await createInitialAccessToken(c.env.DB, {
      label,
      maxUses,
      ttlDays,
      createdBy: c.var.admin.email,
    });
    await writeAudit(c.env.DB, {
      actor: actor(c),
      action: "iat.create",
      target: id,
      detail: { label, max_uses: maxUses, ttl_days: ttlDays },
    });
    return page(
      c,
      "등록 토큰 발급",
      <SecretShownPage
        title={`등록 토큰 발급: ${label}`}
        items={[
          ["registration_endpoint", `${c.var.config.issuer}/register`],
          ["initial access token (Authorization: Bearer …)", token],
        ]}
        next="/admin/tokens"
        note={`${maxUses}회, ${ttlDays}일 동안 쓸 수 있습니다.`}
      />,
    );
  })
  .post("/tokens/:id/revoke", async (c) => {
    const id = c.req.param("id");
    if (await revokeInitialAccessToken(c.env.DB, id)) {
      await writeAudit(c.env.DB, { actor: actor(c), action: "iat.revoke", target: id });
    }
    return c.redirect("/admin/tokens", 302);
  })
  .get("/audit", async (c) => page(c, "감사 로그", <AuditPage logs={await recentAudit(c.env.DB)} />));
