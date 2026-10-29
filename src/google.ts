/**
 * Google OAuth (Authorization Code + PKCE) 클라이언트. 사용자 인증은 Google에 맡기고 비밀번호는 다루지 않는다.
 */
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from "jose";
import type { Config } from "./env";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/** OAuth 흐름 실패. message는 로그용이며 사용자에게는 일반화한 메시지만 보여준다. */
export class OAuthError extends Error {
  override name = "OAuthError";
}

export function googleRedirectUri(config: Config): string {
  return `${config.issuer}/callback/google`;
}

export function buildGoogleAuthUrl(
  config: Config,
  params: { state: string; nonce: string; codeChallenge: string },
): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.googleClientId,
    redirect_uri: googleRedirectUri(config),
    scope: "openid email profile",
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    // UI 힌트일 뿐 검증이 아니다. 실제 검증은 checkGoogleIdentity가 한다.
    hd: config.allowedEmailDomain,
    prompt: "select_account",
  }).toString();
  return url.toString();
}

/** 인가 코드를 토큰으로 교환하고 id_token을 돌려준다. */
export async function exchangeGoogleCode(config: Config, code: string, codeVerifier: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: googleRedirectUri(config),
        code_verifier: codeVerifier,
      }).toString(),
    });
  } catch (err) {
    throw new OAuthError(`token endpoint 요청 실패: ${String(err)}`);
  }
  const body = (await res.json().catch(() => null)) as { id_token?: unknown; error?: unknown } | null;
  if (!res.ok || typeof body?.id_token !== "string") {
    throw new OAuthError(`token endpoint 응답 오류: HTTP ${res.status} ${String(body?.error ?? "")}`);
  }
  return body.id_token;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function googleJwks() {
  // 키 집합은 isolate 단위로 캐시한다(jose가 kid 미스 시 재조회).
  jwks ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return jwks;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name?: string | undefined;
}

export type GoogleDenyReason = "email_unverified" | "domain_not_allowed";

/** id_token 서명(JWKS)과 iss, aud, exp, nonce를 검증한다. */
export async function verifyGoogleIdToken(
  config: Config,
  idToken: string,
  expectedNonce: string,
): Promise<Record<string, unknown>> {
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, googleJwks(), {
      issuer: GOOGLE_ISSUERS,
      audience: config.googleClientId,
      algorithms: ["RS256"],
    }));
  } catch (err) {
    const code = err instanceof joseErrors.JOSEError ? err.code : String(err);
    throw new OAuthError(`id_token 검증 실패: ${code}`);
  }
  if (typeof payload.nonce !== "string" || payload.nonce !== expectedNonce) {
    throw new OAuthError("id_token nonce 불일치");
  }
  if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
    throw new OAuthError("id_token에 sub 또는 email이 없음");
  }
  return payload;
}

/** 학교 Google Workspace 계정만 허용한다. 순수 함수. */
export function checkGoogleIdentity(
  config: Config,
  claims: Record<string, unknown>,
): { ok: true; identity: GoogleIdentity } | { ok: false; reason: GoogleDenyReason } {
  // Google은 boolean으로 주지만, 그 외 값은 모두 미인증으로 취급한다.
  if (claims.email_verified !== true) return { ok: false, reason: "email_unverified" };
  const email = String(claims.email).trim().toLowerCase();
  // hd는 Workspace 계정에만 있다. 같은 도메인의 개인 Google 계정(Gmail 연결)을 막는다.
  if (!email.endsWith(`@${config.allowedEmailDomain}`) || claims.hd !== config.allowedEmailDomain) {
    return { ok: false, reason: "domain_not_allowed" };
  }
  return {
    ok: true,
    identity: {
      sub: String(claims.sub),
      email,
      name: typeof claims.name === "string" ? claims.name : undefined,
    },
  };
}
