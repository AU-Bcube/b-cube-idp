/**
 * 테스트 픽스처: 가짜 Google, 가짜 mhaksa, 쿠키를 들고 다니는 브라우저, SP 흉내.
 */
import { createExecutionContext, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { vi } from "vitest";
import { sha256Base64url } from "../src/crypto";
import { GOOGLE_JWKS_URL, GOOGLE_TOKEN_URL } from "../src/google";
import worker from "../src/index";

export const ISSUER = "http://localhost:8787"; // vitest.config.ts 바인딩과 같은 값
export const CLIENT_ID = "test-sp";
export const CLIENT_SECRET = "test-client-secret-0123456789abcdefghijklmnop";
export const REDIRECT_URI = "https://sp.example.com/auth/callback";
const GOOGLE_CLIENT_ID = "test-google-client-id";
// ajou-internal-id-federation이 요청하는 주소
const MHAKSA_ENDPOINT = "https://mhaksa.ajou.ac.kr:30443/nt/cvt.do";

// ---------------------------------------------------------------------------
// 가짜 Google
// ---------------------------------------------------------------------------
let googleKey: CryptoKey;
let googleJwk: Record<string, unknown>;

/** 다음 Google token 응답에 담을 id_token 클레임. null이면 400 응답 */
export const google: { claims: ((nonce: string) => JWTPayload) | null } = { claims: null };

export function googleUser(email: string, extra: JWTPayload = {}): (nonce: string) => JWTPayload {
  return (nonce) => ({
    iss: "https://accounts.google.com",
    aud: GOOGLE_CLIENT_ID,
    sub: `google-${email}`,
    email,
    email_verified: true,
    hd: email.split("@")[1],
    name: "구글 이름",
    nonce,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// 가짜 mhaksa: 실제 응답처럼 민감한 열을 함께 돌려준다.
// ---------------------------------------------------------------------------
export const SENSITIVE = { resNo: "000101-3000000", userPwd: "hashed-password", handNo: "010-0000-0000" };

export const mhaksa: {
  /** username → 학번. 없으면 조회 결과 없음 */
  users: Map<string, string>;
  /** 학번 → 학교 이메일 override */
  schEmail: Map<string, string>;
  down: boolean;
  calls: string[];
} = { users: new Map(), schEmail: new Map(), down: false, calls: [] };

function mhaksaResponse(body: { url: string; param: Record<string, string> }): Response {
  mhaksa.calls.push(body.url);
  const ok = (DatasetList: Record<string, unknown[]>) => Response.json({ VariableList: { ErrorCode: "0" }, DatasetList });
  if (body.url.endsWith("/findUser.action")) {
    const userId = body.param.strUserId ?? "";
    const stdNo = mhaksa.users.get(userId);
    return ok({ DS_CMMN040: stdNo ? [{ userId, userNo: stdNo, userNm: "홍길동", ...SENSITIVE }] : [] });
  }
  if (body.url.endsWith("/findUnicUnivBaseInformationDiv.action")) {
    const stdNo = body.param.strStdNo ?? "";
    const username = [...mhaksa.users].find(([, n]) => n === stdNo)?.[0];
    if (!username) return ok({ DS_SREG300: [] });
    return ok({
      DS_SREG300: [
        {
          stdNo,
          korNm: "홍길동",
          colgCdNm: "소프트웨어융합대학",
          sustCdNm: "소프트웨어학과",
          mjCdNm: "",
          shyrCd: "3",
          shregStNm: "재학",
          schEmail: mhaksa.schEmail.get(stdNo) ?? `${username}@ajou.ac.kr`,
          photoCtnt: "base64-photo",
          ...SENSITIVE,
        },
      ],
    });
  }
  if (body.url.endsWith("/findScarStdNonSbjtRegCircle.action")) {
    return ok({
      DS_SCAR200: [{ unSubmattNm: "B-Cube", yy: "2026", shtmCd: "10", unSubmattFrDt: "", regIp: "10.0.0.1" }],
    });
  }
  return Response.json({ VariableList: { ErrorCode: "-1", ErrorMsg: "unknown" } });
}

/** 테스트 파일의 beforeAll에서 한 번 부른다. fetch를 가로채 Google과 mhaksa를 흉내 낸다. */
export async function installFakes(): Promise<void> {
  const pair = await generateKeyPair("RS256", { extractable: true });
  googleKey = pair.privateKey;
  googleJwk = { ...(await exportJWK(pair.publicKey)), kid: "google-kid", alg: "RS256", use: "sig" };

  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === GOOGLE_JWKS_URL) return Response.json({ keys: [googleJwk] });
    if (request.url === GOOGLE_TOKEN_URL) {
      const form = await request.formData();
      if (!google.claims) return Response.json({ error: "invalid_grant" }, { status: 400 });
      // 인가 코드 자리에 nonce를 실어 보낸다(가짜 Google의 단순화).
      const idToken = await new SignJWT(google.claims(String(form.get("code") ?? "")))
        .setProtectedHeader({ alg: "RS256", kid: "google-kid" })
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(googleKey);
      return Response.json({ access_token: "at", id_token: idToken, token_type: "Bearer" });
    }
    if (request.url === MHAKSA_ENDPOINT) {
      if (mhaksa.down) throw new TypeError("network error");
      return mhaksaResponse(await request.json());
    }
    return realFetch(input, init);
  });
}

export function resetFakes(): void {
  google.claims = null;
  mhaksa.users = new Map();
  mhaksa.schEmail = new Map();
  mhaksa.down = false;
  mhaksa.calls = [];
}

// ---------------------------------------------------------------------------
// 브라우저
// ---------------------------------------------------------------------------
export class Browser {
  cookies = new Map<string, string>();

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) {
      headers.set("Cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    }
    const res = await SELF.fetch(new URL(path, ISSUER), { ...init, headers, redirect: "manual" });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const [name, ...rest] = pair!.split("=");
      const value = rest.join("=");
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim())) || value === "";
      if (expired) this.cookies.delete(name!.trim());
      else this.cookies.set(name!.trim(), value);
    }
    return res;
  }

  postForm(path: string, form: Record<string, string>, headers: Record<string, string> = {}) {
    return this.fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ISSUER, ...headers },
      body: new URLSearchParams(form).toString(),
    });
  }
}

// ---------------------------------------------------------------------------
// SP
// ---------------------------------------------------------------------------
export interface AuthorizeOptions {
  clientId?: string;
  redirectUri?: string;
  scope?: string;
  extra?: Record<string, string>;
}

export async function authorizeUrl(opts: AuthorizeOptions = {}) {
  const verifier = "v".repeat(20) + crypto.randomUUID().replaceAll("-", "");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId ?? CLIENT_ID,
    redirect_uri: opts.redirectUri ?? REDIRECT_URI,
    scope: opts.scope ?? "openid email profile student",
    state: "sp-state",
    nonce: "sp-nonce",
    code_challenge: await sha256Base64url(verifier),
    code_challenge_method: "S256",
    ...opts.extra,
  });
  return { url: `/authorize?${params}`, verifier };
}

/** /authorize → Google → 콜백까지 진행하고 마지막 응답을 돌려준다. */
export async function loginUntilConsent(browser: Browser, email: string, opts: AuthorizeOptions = {}) {
  const { url, verifier } = await authorizeUrl(opts);
  const res = await browser.fetch(url);
  if (res.status !== 302) return { res, verifier };
  const googleUrl = new URL(res.headers.get("Location")!);
  google.claims ??= googleUser(email);
  // 가짜 Google은 code 자리에 nonce를 받는다.
  const callback = await browser.fetch(
    `/callback/google?state=${googleUrl.searchParams.get("state")}&code=${googleUrl.searchParams.get("nonce")}`,
  );
  return { res: callback, verifier };
}

export function csrfFrom(html: string): string {
  const m = /name="csrf" value="([^"]+)"/.exec(html);
  if (!m) throw new Error("csrf 토큰이 없음");
  return m[1]!;
}

/** 동의 화면에서 동의하고 SP로 돌아온 리다이렉트 주소를 돌려준다. */
export async function loginAndConsent(browser: Browser, email: string, opts: AuthorizeOptions = {}) {
  const { res, verifier } = await loginUntilConsent(browser, email, opts);
  if (res.headers.get("Location") !== "/consent") throw new Error(`동의 화면으로 가지 않음: ${res.status}`);
  const page = await browser.fetch("/consent");
  const done = await browser.postForm("/consent", { csrf: csrfFrom(await page.text()), decision: "allow" });
  return { location: new URL(done.headers.get("Location")!), verifier };
}

export function basicAuth(id: string, secret: string): string {
  return `Basic ${btoa(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`)}`;
}

export function tokenRequest(form: Record<string, string>, auth = basicAuth(CLIENT_ID, CLIENT_SECRET)) {
  return SELF.fetch(`${ISSUER}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: auth },
    body: new URLSearchParams(form).toString(),
  });
}

/** env 값을 바꿔 Worker를 직접 호출한다(설정 오류 확인용). */
export function workerWith(overrides: Record<string, string>) {
  const variant = { ...env, ...overrides } as unknown as Env;
  return async (req: Request) => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(req as Request<unknown, IncomingRequestCfProperties>, variant, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  };
}

// ---------------------------------------------------------------------------
// 관리 화면, 동적 등록
// ---------------------------------------------------------------------------
export const ADMIN_EMAIL = "t-admin@ajou.ac.kr"; // vitest.config.ts 바인딩과 같은 값

/** Google 로그인을 거쳐 관리 화면 세션을 얻고 CSRF 토큰을 돌려준다. */
export async function adminLogin(browser: Browser, email = ADMIN_EMAIL): Promise<{ res: Response; csrf: string | null }> {
  const start = await browser.fetch("/admin/login");
  if (start.status !== 302) return { res: start, csrf: null };
  const googleUrl = new URL(start.headers.get("Location")!);
  google.claims = googleUser(email);
  const res = await browser.fetch(
    `/callback/google?state=${googleUrl.searchParams.get("state")}&code=${googleUrl.searchParams.get("nonce")}`,
  );
  if (res.headers.get("Location") !== "/admin") return { res, csrf: null };
  const home = await browser.fetch("/admin");
  return { res, csrf: csrfFrom(await home.text()) };
}

export function register(token: string | null, body: unknown) {
  return SELF.fetch(`${ISSUER}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

export interface Registered {
  client_id: string;
  client_secret: string;
  registration_access_token: string;
  registration_client_uri: string;
  b_cube_status: string;
  [k: string]: unknown;
}
