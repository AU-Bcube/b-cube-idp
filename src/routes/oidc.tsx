/**
 * OpenID Connect 엔드포인트: discovery, JWKS, authorize, token, userinfo.
 *
 * 지원 범위: Authorization Code + PKCE(S256 필수), confidential client(client_secret_basic/post).
 */
import { Hono, type Context } from "hono";
import { findClient, type Client } from "../clients";
import { randomToken, sha256Base64url, sha256Hex, timingSafeEqual } from "../crypto";
import type { Config } from "../env";
import { publicJwks, seal, SIGNING_ALG, signIdToken, unseal } from "../keys";
import { errorPage, startGoogleLogin } from "../respond";
import { CLAIMS_SUPPORTED, parseScopes, SCOPES, type Scope } from "../scopes";
import type { MhaksaClaims } from "../student";
import type { AuthRequest, HonoEnv } from "../types";

export const CODE_TTL_SEC = 60;
export const TOKEN_TTL_SEC = 300;

/** 인가 코드에 담는 내용. 서버만 열 수 있도록 암호화한다. */
interface CodePayload {
  jti: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  nonce?: string;
  scopes: Scope[];
  sub: string;
  auth_time: number;
  claims: Record<string, unknown>;
}

interface AccessTokenPayload {
  sub: string;
  client_id: string;
  scopes: Scope[];
  claims: Record<string, unknown>;
}

const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const PKCE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** scope에 따라 SP에 줄 클레임을 고른다. 동의 화면에 보여준 것과 같은 값이다. */
export function selectClaims(
  scopes: readonly Scope[],
  user: { email: string; name?: string | undefined; mhaksa: MhaksaClaims },
): Record<string, unknown> {
  const claims: Record<string, unknown> = {};
  if (scopes.includes("email")) {
    claims.email = user.email;
    claims.email_verified = true;
  }
  if (scopes.includes("profile") && user.name) claims.name = user.name;
  if (scopes.includes("student") && user.mhaksa.student) claims.student = user.mhaksa.student;
  if (scopes.includes("sohakoe")) claims.sohakoe_memberships = user.mhaksa.sohakoe_memberships ?? [];
  return claims;
}

/** 인가 응답(성공/오류)을 SP의 redirect_uri로 보낸다. RFC 9207의 iss도 붙인다. */
export function redirectToClient(
  c: Context<HonoEnv>,
  req: Pick<AuthRequest, "redirect_uri" | "state">,
  params: Record<string, string>,
) {
  const url = new URL(req.redirect_uri);
  for (const [k, v] of Object.entries({ ...params, state: req.state, iss: c.var.config.issuer })) {
    url.searchParams.set(k, v);
  }
  return c.redirect(url.toString(), 302);
}

export async function issueCode(
  config: Config,
  req: AuthRequest,
  user: { sub: string; email: string; name?: string | undefined; auth_time: number; mhaksa: MhaksaClaims },
): Promise<string> {
  const payload: CodePayload = {
    jti: randomToken(16),
    client_id: req.client_id,
    redirect_uri: req.redirect_uri,
    code_challenge: req.code_challenge,
    ...(req.nonce !== undefined ? { nonce: req.nonce } : {}),
    scopes: req.scopes,
    sub: user.sub,
    auth_time: user.auth_time,
    claims: selectClaims(req.scopes, user),
  };
  return seal(config, "code", { ...payload }, CODE_TTL_SEC);
}

function formValue(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

function tokenError(c: Context<HonoEnv>, status: 400 | 401, error: string, description: string) {
  if (status === 401) c.header("WWW-Authenticate", 'Basic realm="b-cube-idp"');
  return c.json({ error, error_description: description }, status);
}

/** client_secret_basic 또는 client_secret_post. 실패하거나 활성 상태가 아니면 null. */
async function authenticateClient(c: Context<HonoEnv>, form: FormData): Promise<Client | null> {
  let clientId = formValue(form, "client_id");
  let secret = formValue(form, "client_secret");
  const authz = c.req.header("Authorization");
  if (authz?.startsWith("Basic ")) {
    try {
      const decoded = atob(authz.slice(6).trim());
      const i = decoded.indexOf(":");
      if (i < 0) return null;
      // RFC 6749 §2.3.1: 각 값은 form-urlencoded 된 뒤 Basic으로 묶인다.
      clientId = decodeURIComponent(decoded.slice(0, i).replace(/\+/g, " "));
      secret = decodeURIComponent(decoded.slice(i + 1).replace(/\+/g, " "));
    } catch {
      return null;
    }
  }
  const client = clientId ? await findClient(c.var.config, c.env.DB, clientId) : null;
  if (!client || client.status !== "active" || !secret || !client.secretSha256) return null;
  return timingSafeEqual(await sha256Hex(secret), client.secretSha256) ? client : null;
}

export const oidcRoutes = new Hono<HonoEnv>()
  .get("/.well-known/openid-configuration", (c) => {
    const issuer = c.var.config.issuer;
    c.header("Cache-Control", "public, max-age=300");
    return c.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      jwks_uri: `${issuer}/jwks.json`,
      registration_endpoint: `${issuer}/register`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: [SIGNING_ALG],
      scopes_supported: SCOPES,
      claims_supported: CLAIMS_SUPPORTED,
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
    });
  })
  .get("/jwks.json", async (c) => {
    c.header("Cache-Control", "public, max-age=300");
    return c.json(await publicJwks(c.var.config));
  })
  .get("/authorize", async (c) => {
    const config = c.var.config;
    const q = c.req.query();

    // client_id와 redirect_uri를 확인하기 전에는 SP로 리다이렉트하지 않는다(open redirect 방지).
    const client = q.client_id ? await findClient(config, c.env.DB, q.client_id) : null;
    if (!client) return errorPage(c, 400, "등록되지 않은 서비스", "로그인을 요청한 서비스(client_id)를 찾을 수 없습니다.");
    if (client.status === "pending") {
      return errorPage(c, 403, "승인 대기 중인 서비스", `${client.name}은(는) B-CUBE 관리자의 승인을 기다리고 있습니다.`);
    }
    if (client.status !== "active") {
      return errorPage(c, 403, "사용이 중지된 서비스", `${client.name}은(는) 관리자가 사용을 중지했습니다.`);
    }
    const redirectUri = q.redirect_uri ?? "";
    if (!client.redirectUris.includes(redirectUri)) {
      return errorPage(c, 400, "잘못된 요청", "등록되지 않은 redirect_uri입니다.");
    }

    const state = q.state ?? "";
    const fail = (error: string, description: string) =>
      redirectToClient(c, { redirect_uri: redirectUri, state }, { error, error_description: description });

    if (!state || state.length > 512) return fail("invalid_request", "state is required");
    if (q.response_type !== "code") return fail("unsupported_response_type", "only response_type=code is supported");
    if (q.request !== undefined || q.request_uri !== undefined) {
      return fail("request_not_supported", "request objects are not supported");
    }
    if (q.code_challenge_method !== "S256" || !PKCE_CHALLENGE.test(q.code_challenge ?? "")) {
      return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
    }
    if (q.nonce !== undefined && (q.nonce === "" || q.nonce.length > 512)) {
      return fail("invalid_request", "invalid nonce");
    }
    const requested = parseScopes(q.scope);
    if (!requested.includes("openid")) return fail("invalid_scope", "openid scope is required");
    const scopes = requested.filter((s) => client.scopes.has(s));
    if (scopes.length !== requested.length) return fail("invalid_scope", "scope not allowed for this client");
    if (q.prompt === "none") return fail("login_required", "consent is required for every login");

    const req: AuthRequest = {
      client_id: client.clientId,
      redirect_uri: redirectUri,
      scopes,
      state,
      nonce: q.nonce,
      code_challenge: q.code_challenge as string,
    };
    return startGoogleLogin(c, { req });
  })
  .post("/token", async (c) => {
    const config = c.var.config;
    c.header("Cache-Control", "no-store");
    c.header("Pragma", "no-cache");

    if (!c.req.header("Content-Type")?.startsWith("application/x-www-form-urlencoded")) {
      return tokenError(c, 400, "invalid_request", "body must be application/x-www-form-urlencoded");
    }
    const form = await c.req.formData();
    const client = await authenticateClient(c, form);
    if (!client) return tokenError(c, 401, "invalid_client", "client authentication failed");
    if (formValue(form, "grant_type") !== "authorization_code") {
      return tokenError(c, 400, "unsupported_grant_type", "only authorization_code is supported");
    }

    const code = await unseal<CodePayload & Record<string, unknown>>(config, "code", formValue(form, "code"));
    if (!code || code.client_id !== client.clientId || code.redirect_uri !== formValue(form, "redirect_uri")) {
      return tokenError(c, 400, "invalid_grant", "invalid or expired code");
    }
    const verifier = formValue(form, "code_verifier");
    if (!PKCE_VERIFIER.test(verifier) || !timingSafeEqual(await sha256Base64url(verifier), code.code_challenge)) {
      return tokenError(c, 400, "invalid_grant", "PKCE verification failed");
    }

    // 코드는 한 번만 쓴다. 검증을 모두 통과한 뒤에 사용 처리해 잘못된 요청이 정상 코드를 소모하지 않게 한다.
    const used = await c.env.DB.prepare(`INSERT INTO used_codes (jti, expires_at) VALUES (?, ?) ON CONFLICT DO NOTHING`)
      .bind(code.jti, Number(code.exp) * 1000)
      .run();
    if (used.meta.changes !== 1) return tokenError(c, 400, "invalid_grant", "code already used");

    const idToken = await signIdToken(
      config,
      {
        sub: code.sub,
        aud: client.clientId,
        auth_time: code.auth_time,
        ...(code.nonce !== undefined ? { nonce: code.nonce } : {}),
        ...code.claims,
      },
      TOKEN_TTL_SEC,
    );
    const accessToken = await seal(
      config,
      "access_token",
      { sub: code.sub, client_id: client.clientId, scopes: code.scopes, claims: code.claims },
      TOKEN_TTL_SEC,
    );
    return c.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: TOKEN_TTL_SEC,
      id_token: idToken,
      scope: code.scopes.join(" "),
    });
  })
  .on(["GET", "POST"], "/userinfo", async (c) => {
    c.header("Cache-Control", "no-store");
    const authz = c.req.header("Authorization") ?? "";
    const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : undefined;
    const payload = await unseal<AccessTokenPayload & Record<string, unknown>>(c.var.config, "access_token", token);
    if (!payload) {
      c.header("WWW-Authenticate", 'Bearer error="invalid_token"');
      return c.json({ error: "invalid_token" }, 401);
    }
    return c.json({ sub: payload.sub, ...payload.claims });
  });
