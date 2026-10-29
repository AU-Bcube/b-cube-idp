/**
 * 동적 SP 등록 (RFC 7591)과 등록 정보 관리 (RFC 7592).
 *
 * - /register는 관리자가 발급한 initial access token이 있어야 쓸 수 있다(열린 등록은 지원하지 않는다).
 * - student, sohakoe scope를 요청한 SP는 관리자가 승인할 때까지 pending이다.
 */
import { Hono, type Context } from "hono";
import { writeAudit } from "../audit";
import {
  ClientMetadataError,
  createClient,
  deleteClient,
  findDynamicClient,
  metadataResponse,
  parseClientMetadata,
  updateClientMetadata,
  type DynamicClient,
} from "../clients";
import { sha256Hex, timingSafeEqual } from "../crypto";
import { consumeInitialAccessToken } from "../initial-access-tokens";
import type { HonoEnv } from "../types";

function bearer(c: Context<HonoEnv>): string | null {
  const authz = c.req.header("Authorization") ?? "";
  return authz.startsWith("Bearer ") ? authz.slice(7).trim() || null : null;
}

function invalidToken(c: Context<HonoEnv>) {
  c.header("WWW-Authenticate", 'Bearer error="invalid_token"');
  return c.json({ error: "invalid_token", error_description: "missing or invalid access token" }, 401);
}

async function readMetadata(c: Context<HonoEnv>) {
  if (!c.req.header("Content-Type")?.startsWith("application/json")) {
    throw new ClientMetadataError("invalid_client_metadata", "body must be application/json");
  }
  const body = await c.req.json().catch(() => {
    throw new ClientMetadataError("invalid_client_metadata", "body is not valid JSON");
  });
  return { body: body as Record<string, unknown>, meta: parseClientMetadata(body) };
}

function metadataError(c: Context<HonoEnv>, err: unknown) {
  if (!(err instanceof ClientMetadataError)) throw err;
  return c.json({ error: err.error, error_description: err.message }, 400);
}

function registrationUri(c: Context<HonoEnv>, clientId: string): string {
  return `${c.var.config.issuer}/register/${clientId}`;
}

function clientResponse(c: Context<HonoEnv>, client: DynamicClient) {
  return {
    ...metadataResponse(client),
    registration_client_uri: registrationUri(c, client.clientId),
    // 표준 밖 필드: SP가 승인 대기 여부를 알 수 있게 한다.
    b_cube_status: client.status,
  };
}

/** registration_access_token으로 자기 SP를 찾는다. 없는 SP와 틀린 토큰을 구분하지 않는다. */
async function authorizedClient(c: Context<HonoEnv>): Promise<DynamicClient | null> {
  const token = bearer(c);
  const client = await findDynamicClient(c.env.DB, c.req.param("clientId") ?? "");
  if (!token || !client?.registrationTokenSha256) return null;
  return timingSafeEqual(await sha256Hex(token), client.registrationTokenSha256) ? client : null;
}

export const registerRoutes = new Hono<HonoEnv>()
  .post("/register", async (c) => {
    const token = bearer(c);
    if (!token) return invalidToken(c);
    let meta;
    try {
      ({ meta } = await readMetadata(c));
    } catch (err) {
      return metadataError(c, err);
    }
    // 메타데이터가 올바를 때만 토큰 사용 횟수를 쓴다.
    const tokenId = await consumeInitialAccessToken(c.env.DB, token);
    if (!tokenId) return invalidToken(c);

    const created = await createClient(c.env.DB, meta, { createdBy: `iat:${tokenId}`, withRegistrationToken: true });
    await writeAudit(c.env.DB, {
      actor: `iat:${tokenId}`,
      action: "client.register",
      target: created.client.clientId,
      detail: { name: meta.name, scopes: meta.scopes, redirect_uris: meta.redirectUris, status: created.client.status },
    });
    return c.json(
      {
        ...clientResponse(c, created.client),
        client_secret: created.clientSecret,
        registration_access_token: created.registrationToken,
      },
      201,
    );
  })
  .get("/register/:clientId", async (c) => {
    const client = await authorizedClient(c);
    if (!client) return invalidToken(c);
    return c.json(clientResponse(c, client));
  })
  .put("/register/:clientId", async (c) => {
    const client = await authorizedClient(c);
    if (!client) return invalidToken(c);
    let body, meta;
    try {
      ({ body, meta } = await readMetadata(c));
    } catch (err) {
      return metadataError(c, err);
    }
    // RFC 7592 §2.2: 요청 본문의 client_id는 대상 SP와 같아야 한다.
    if (body.client_id !== client.clientId) {
      return c.json({ error: "invalid_client_metadata", error_description: "client_id does not match" }, 400);
    }
    const updated = await updateClientMetadata(c.env.DB, client, meta);
    await writeAudit(c.env.DB, {
      actor: `client:${client.clientId}`,
      action: "client.update",
      target: client.clientId,
      detail: { name: meta.name, scopes: meta.scopes, redirect_uris: meta.redirectUris, status: updated.status },
    });
    return c.json(clientResponse(c, updated));
  })
  .delete("/register/:clientId", async (c) => {
    const client = await authorizedClient(c);
    if (!client) return invalidToken(c);
    await deleteClient(c.env.DB, client.clientId);
    await writeAudit(c.env.DB, { actor: `client:${client.clientId}`, action: "client.delete", target: client.clientId });
    return c.body(null, 204);
  });
