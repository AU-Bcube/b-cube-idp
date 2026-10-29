import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setClientStatus } from "../src/clients";
import { createInitialAccessToken } from "../src/initial-access-tokens";
import {
  basicAuth,
  Browser,
  csrfFrom,
  installFakes,
  ISSUER,
  loginAndConsent,
  loginUntilConsent,
  mhaksa,
  register,
  resetFakes,
  SENSITIVE,
  type Registered,
  workerWith,
} from "./helpers";

beforeAll(installFakes);
beforeEach(resetFakes);

const SP_REDIRECT = "https://new-sp.example.com/cb";

async function issueToken(maxUses = 1, ttlDays = 7) {
  return (await createInitialAccessToken(env.DB, { label: "test", maxUses, ttlDays, createdBy: "test" })).token;
}

function metadata(extra: Record<string, unknown> = {}) {
  return { client_name: "새 SP", redirect_uris: [SP_REDIRECT], scope: "openid email", ...extra };
}

async function registerOk(extra: Record<string, unknown> = {}): Promise<Registered> {
  const res = await register(await issueToken(), metadata(extra));
  expect(res.status).toBe(201);
  return (await res.json()) as Registered;
}

function manage(client: Registered, init: RequestInit & { token?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${init.token ?? client.registration_access_token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return SELF.fetch(client.registration_client_uri, { ...init, headers });
}

describe("RFC 7591 등록", () => {
  it("discovery에 registration_endpoint가 있다", async () => {
    const doc = (await (await SELF.fetch(`${ISSUER}/.well-known/openid-configuration`)).json()) as Record<string, unknown>;
    expect(doc.registration_endpoint).toBe(`${ISSUER}/register`);
  });

  it("initial access token이 없거나 틀리면 401", async () => {
    expect((await register(null, metadata())).status).toBe(401);
    expect((await register("iat_wrong", metadata())).status).toBe(401);
  });

  it("등록하면 client_secret과 관리 토큰을 한 번 돌려주고, 그 SP로 로그인할 수 있다", async () => {
    const client = await registerOk({ token_endpoint_auth_method: "client_secret_post", contacts: ["dev@ajou.ac.kr"] });
    expect(client.client_id).toMatch(/^dyn-/);
    expect(client).toMatchObject({
      client_name: "새 SP",
      redirect_uris: [SP_REDIRECT],
      scope: "openid email",
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_secret_expires_at: 0,
      registration_client_uri: `${ISSUER}/register/${client.client_id}`,
      b_cube_status: "active",
    });

    const browser = new Browser();
    const { res } = await loginUntilConsent(browser, "hong@ajou.ac.kr", {
      clientId: client.client_id,
      redirectUri: SP_REDIRECT,
      scope: "openid email",
    });
    expect(res.headers.get("Location")).toBe("/consent");
    // 관리자가 검토하지 않은 SP는 동의 화면에 경고와 이동할 주소를 보여준다.
    const html = await (await browser.fetch("/consent")).text();
    expect(html).toContain("검토하지 않은 서비스");
    expect(html).toContain("https://new-sp.example.com");

    const { location, verifier } = await loginAndConsent(new Browser(), "hong@ajou.ac.kr", {
      clientId: client.client_id,
      redirectUri: SP_REDIRECT,
      scope: "openid email",
    });
    const token = await SELF.fetch(`${ISSUER}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: location.searchParams.get("code")!,
        redirect_uri: SP_REDIRECT,
        code_verifier: verifier,
        client_id: client.client_id,
        client_secret: client.client_secret,
      }).toString(),
    });
    expect(token.status).toBe(200);
  });

  it("토큰은 max_uses만큼만 쓸 수 있고, 잘못된 메타데이터는 횟수를 쓰지 않는다", async () => {
    const token = await issueToken(1);
    const bad = await register(token, metadata({ redirect_uris: ["http://evil.example.com/cb"] }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_redirect_uri" });
    expect((await register(token, metadata())).status).toBe(201);
    expect((await register(token, metadata())).status).toBe(401);
  });

  it("만료된 토큰은 쓸 수 없다", async () => {
    const { token, id } = await createInitialAccessToken(env.DB, { label: "x", maxUses: 5, ttlDays: 1, createdBy: "t" });
    await env.DB.prepare(`UPDATE initial_access_tokens SET expires_at = 1 WHERE id = ?`).bind(id).run();
    expect((await register(token, metadata())).status).toBe(401);
  });

  it.each([
    ["client_name 없음", { client_name: "" }, "invalid_client_metadata"],
    ["fragment가 있는 redirect_uri", { redirect_uris: [`${SP_REDIRECT}#x`] }, "invalid_redirect_uri"],
    ["모르는 scope", { scope: "openid admin" }, "invalid_client_metadata"],
    ["implicit grant", { grant_types: ["implicit"] }, "invalid_client_metadata"],
    ["지원하지 않는 인증 방식", { token_endpoint_auth_method: "none" }, "invalid_client_metadata"],
  ])("%s이면 400", async (_name, extra, error) => {
    const res = await register(await issueToken(), metadata(extra));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error });
  });
});

describe("민감한 scope 승인", () => {
  it("student를 요청한 SP는 승인 전까지 로그인할 수 없다", async () => {
    mhaksa.users.set("hong", "202600123");
    const client = await registerOk({ scope: "openid email student" });
    expect(client.b_cube_status).toBe("pending");

    const opts = { clientId: client.client_id, redirectUri: SP_REDIRECT, scope: "openid student" };
    const { res } = await loginUntilConsent(new Browser(), "hong@ajou.ac.kr", opts);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("승인");

    await setClientStatus(env.DB, client.client_id, "active", "t-admin@ajou.ac.kr");
    const browser = new Browser();
    expect((await loginUntilConsent(browser, "hong@ajou.ac.kr", opts)).res.headers.get("Location")).toBe("/consent");
    const html = await (await browser.fetch("/consent")).text();
    expect(html).not.toContain("검토하지 않은 서비스");
    for (const v of Object.values(SENSITIVE)) expect(html).not.toContain(v);
  });

  it("승인 후 SP가 민감한 scope를 더 늘리면 다시 승인 대기가 된다", async () => {
    const client = await registerOk({ scope: "openid student" });
    await setClientStatus(env.DB, client.client_id, "active", "t-admin@ajou.ac.kr");

    // 같은 민감 scope 안에서 바꾸면 활성 상태를 유지한다.
    const same = await manage(client, {
      method: "PUT",
      body: JSON.stringify({ ...metadata({ scope: "openid email student" }), client_id: client.client_id }),
    });
    expect(((await same.json()) as Registered).b_cube_status).toBe("active");

    const wider = await manage(client, {
      method: "PUT",
      body: JSON.stringify({ ...metadata({ scope: "openid student sohakoe" }), client_id: client.client_id }),
    });
    expect(((await wider.json()) as Registered).b_cube_status).toBe("pending");
  });

  it("중지된 SP는 로그인도 토큰 교환도 할 수 없다", async () => {
    const client = await registerOk();
    const opts = { clientId: client.client_id, redirectUri: SP_REDIRECT, scope: "openid email" };
    const { location, verifier } = await loginAndConsent(new Browser(), "hong@ajou.ac.kr", opts);
    await setClientStatus(env.DB, client.client_id, "suspended");

    expect((await loginUntilConsent(new Browser(), "hong@ajou.ac.kr", opts)).res.status).toBe(403);
    const token = await SELF.fetch(`${ISSUER}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuth(client.client_id, client.client_secret),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: location.searchParams.get("code")!,
        redirect_uri: SP_REDIRECT,
        code_verifier: verifier,
      }).toString(),
    });
    expect(token.status).toBe(401);
  });

  it("동의 화면을 띄운 사이에 중지되면 코드를 주지 않는다", async () => {
    const client = await registerOk();
    const browser = new Browser();
    await loginUntilConsent(browser, "hong@ajou.ac.kr", { clientId: client.client_id, redirectUri: SP_REDIRECT, scope: "openid" });
    const csrf = csrfFrom(await (await browser.fetch("/consent")).text());
    await setClientStatus(env.DB, client.client_id, "suspended");
    const res = await browser.postForm("/consent", { csrf, decision: "allow" });
    const location = new URL(res.headers.get("Location")!);
    expect(location.searchParams.get("error")).toBe("unauthorized_client");
    expect(location.searchParams.has("code")).toBe(false);
  });
});

describe("RFC 7592 관리", () => {
  it("관리 토큰으로 조회·수정·삭제한다", async () => {
    const client = await registerOk();
    const read = await manage(client);
    expect(read.status).toBe(200);
    const body = (await read.json()) as Record<string, unknown>;
    expect(body.client_id).toBe(client.client_id);
    expect(body).not.toHaveProperty("client_secret");

    const put = await manage(client, {
      method: "PUT",
      body: JSON.stringify({ ...metadata({ client_name: "바뀐 이름" }), client_id: client.client_id }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ client_name: "바뀐 이름" });

    expect((await manage(client, { method: "DELETE" })).status).toBe(204);
    expect((await manage(client)).status).toBe(401);
  });

  it("다른 SP의 관리 토큰이나 틀린 토큰은 401", async () => {
    const a = await registerOk();
    const b = await registerOk();
    expect((await manage(a, { token: b.registration_access_token })).status).toBe(401);
    expect((await manage(a, { token: "wrong" })).status).toBe(401);
  });

  it("PUT 본문의 client_id가 다르면 400", async () => {
    const client = await registerOk();
    const res = await manage(client, { method: "PUT", body: JSON.stringify({ ...metadata(), client_id: "dyn-other" }) });
    expect(res.status).toBe(400);
  });
});

describe("정적 SP 설정", () => {
  it("정적 SP는 dyn- 접두사를 쓸 수 없다", async () => {
    const fetch = workerWith({
      CLIENTS: JSON.stringify([
        { client_id: "dyn-static", name: "x", redirect_uris: ["https://x.example.com/cb"], scopes: ["openid"] },
      ]),
    });
    expect((await fetch(new Request(`${ISSUER}/health`))).status).toBe(500);
  });
});
