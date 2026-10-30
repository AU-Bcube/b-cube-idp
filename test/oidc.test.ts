import { env, SELF } from "cloudflare:test";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authorizeUrl,
  basicAuth,
  Browser,
  CLIENT_ID,
  CLIENT_SECRET,
  csrfFrom,
  google,
  googleUser,
  installFakes,
  ISSUER,
  loginAndConsent,
  loginUntilConsent,
  mhaksa,
  REDIRECT_URI,
  resetFakes,
  SENSITIVE,
  tokenRequest,
  workerWith,
} from "./helpers";

beforeAll(installFakes);
beforeEach(resetFakes);

async function verifyIdToken(idToken: string) {
  const jwks = (await (await SELF.fetch(`${ISSUER}/jwks.json`)).json()) as { keys: never[] };
  return jwtVerify(idToken, createLocalJWKSet(jwks), { issuer: ISSUER, audience: CLIENT_ID, algorithms: ["ES256"] });
}

function redeem(location: URL, verifier: string, overrides: Record<string, string> = {}) {
  return tokenRequest({
    grant_type: "authorization_code",
    code: location.searchParams.get("code") ?? "",
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    ...overrides,
  });
}

describe("discovery", () => {
  it("issuer와 엔드포인트, 서명 키를 공개한다", async () => {
    const doc = (await (await SELF.fetch(`${ISSUER}/.well-known/openid-configuration`)).json()) as Record<string, unknown>;
    expect(doc.issuer).toBe(ISSUER);
    expect(doc.token_endpoint).toBe(`${ISSUER}/token`);
    expect(doc.code_challenge_methods_supported).toEqual(["S256"]);

    const jwks = (await (await SELF.fetch(`${ISSUER}/jwks.json`)).json()) as { keys: Record<string, unknown>[] };
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
    expect(jwks.keys[0]).not.toHaveProperty("d");
  });
});

describe("/authorize 검증", () => {
  it("등록되지 않은 client_id나 redirect_uri는 SP로 보내지 않고 오류 화면을 보여준다", async () => {
    const unknownClient = await authorizeUrl({ clientId: "nope" });
    const res1 = await SELF.fetch(`${ISSUER}${unknownClient.url}`, { redirect: "manual" });
    expect(res1.status).toBe(400);

    const badRedirect = await authorizeUrl({ redirectUri: "https://evil.example.com/cb" });
    const res2 = await SELF.fetch(`${ISSUER}${badRedirect.url}`, { redirect: "manual" });
    expect(res2.status).toBe(400);
    expect(res2.headers.get("Location")).toBeNull();
  });

  it.each([
    ["PKCE 없음", { code_challenge_method: "plain" }, "invalid_request"],
    ["openid 없음", { scope: "email" }, "invalid_scope"],
    ["response_type 오류", { response_type: "token" }, "unsupported_response_type"],
    ["prompt=none", { prompt: "none" }, "login_required"],
  ])("%s이면 redirect_uri로 오류를 돌려준다", async (_name, extra, error) => {
    const { url } = await authorizeUrl({ extra });
    const res = await SELF.fetch(`${ISSUER}${url}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get("error")).toBe(error);
    expect(location.searchParams.get("state")).toBe("sp-state");
    expect(location.searchParams.get("iss")).toBe(ISSUER);
  });

  it("SP에 허용되지 않은 scope는 거절한다", async () => {
    const { url } = await authorizeUrl({
      clientId: "email-only",
      redirectUri: "https://other.example.com/cb",
      scope: "openid email student",
    });
    const res = await SELF.fetch(`${ISSUER}${url}`, { redirect: "manual" });
    expect(new URL(res.headers.get("Location")!).searchParams.get("error")).toBe("invalid_scope");
  });

  it("Google로 보낼 때 PKCE와 hd 힌트를 붙인다", async () => {
    const { url } = await authorizeUrl();
    const res = await new Browser().fetch(url);
    const googleUrl = new URL(res.headers.get("Location")!);
    expect(googleUrl.origin).toBe("https://accounts.google.com");
    expect(googleUrl.searchParams.get("redirect_uri")).toBe(`${ISSUER}/callback/google`);
    expect(googleUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(googleUrl.searchParams.get("hd")).toBe("ajou.ac.kr");
  });
});

describe("로그인과 동의", () => {
  it("동의 화면에 요청한 정보만 보여주고 민감한 열은 보여주지 않는다", async () => {
    mhaksa.users.set("hong", "202600123");
    const browser = new Browser();
    const { res } = await loginUntilConsent(browser, "hong@ajou.ac.kr");
    expect(res.headers.get("Location")).toBe("/consent");

    const page = await browser.fetch("/consent");
    const html = await page.text();
    expect(html).toContain("테스트 SP");
    expect(html).toContain("202600123");
    expect(html).toContain("소프트웨어학과");
    expect(html).not.toContain("소학회 가입 내역"); // sohakoe scope를 요청하지 않음
    for (const v of Object.values(SENSITIVE)) expect(html).not.toContain(v);
    expect(page.headers.get("Content-Security-Policy")).toContain("form-action 'self' https://sp.example.com");
    // student scope만 요청했으므로 소학회는 조회하지 않는다.
    expect(mhaksa.calls.some((u) => u.includes("Circle"))).toBe(false);
  });

  it("동의하면 코드를 받고, 토큰 엔드포인트에서 서명된 id_token을 받는다", async () => {
    mhaksa.users.set("hong", "202600123");
    const browser = new Browser();
    const { location, verifier } = await loginAndConsent(browser, "hong@ajou.ac.kr", {
      scope: "openid email profile student sohakoe",
    });
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get("state")).toBe("sp-state");
    expect(location.searchParams.get("iss")).toBe(ISSUER);
    // 흐름 쿠키는 한 번 쓰면 지운다.
    expect(browser.cookies.size).toBe(0);

    const res = await redeem(location, verifier);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as { id_token: string; access_token: string; token_type: string; scope: string };
    expect(body.token_type).toBe("Bearer");
    expect(body.scope).toBe("openid email profile student sohakoe");

    expect(decodeProtectedHeader(body.id_token).alg).toBe("ES256");
    const { payload } = await verifyIdToken(body.id_token);
    expect(payload).toMatchObject({
      sub: "google-hong@ajou.ac.kr",
      nonce: "sp-nonce",
      email: "hong@ajou.ac.kr",
      email_verified: true,
      name: "구글 이름",
      student: {
        id: "202600123",
        name: "홍길동",
        college: "소프트웨어융합대학",
        department: "소프트웨어학과",
        grade: "3",
        status: "재학",
      },
      sohakoe_memberships: [{ name: "B-Cube", year: "2026", semester: "10" }],
    });
    // 빈 값은 빼고, 허용 목록에 없는 열은 넘기지 않는다.
    expect(payload.student).not.toHaveProperty("major");
    const raw = JSON.stringify(payload);
    for (const v of [...Object.values(SENSITIVE), "base64-photo", "10.0.0.1"]) expect(raw).not.toContain(v);

    const info = await SELF.fetch(`${ISSUER}/userinfo`, { headers: { Authorization: `Bearer ${body.access_token}` } });
    expect(info.status).toBe(200);
    expect(await info.json()).toMatchObject({ sub: "google-hong@ajou.ac.kr", student: { id: "202600123" } });
  });

  it("코드는 한 번만 쓸 수 있다", async () => {
    mhaksa.users.set("hong", "202600123");
    const { location, verifier } = await loginAndConsent(new Browser(), "hong@ajou.ac.kr");
    expect((await redeem(location, verifier)).status).toBe(200);
    const again = await redeem(location, verifier);
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("PKCE verifier나 redirect_uri가 틀리면 거절하고, 코드는 소모하지 않는다", async () => {
    mhaksa.users.set("hong", "202600123");
    const { location, verifier } = await loginAndConsent(new Browser(), "hong@ajou.ac.kr");
    expect((await redeem(location, "x".repeat(43))).status).toBe(400);
    expect((await redeem(location, verifier, { redirect_uri: "https://sp.example.com/other" })).status).toBe(400);
    expect((await redeem(location, verifier)).status).toBe(200);
  });

  it("클라이언트 인증이 틀리면 401이다 (basic, post 모두)", async () => {
    mhaksa.users.set("hong", "202600123");
    const { location, verifier } = await loginAndConsent(new Browser(), "hong@ajou.ac.kr");
    const form = { grant_type: "authorization_code", code: location.searchParams.get("code")!, redirect_uri: REDIRECT_URI };
    const wrong = await tokenRequest({ ...form, code_verifier: verifier }, basicAuth(CLIENT_ID, "wrong"));
    expect(wrong.status).toBe(401);
    // 다른 SP의 자격 증명으로는 이 코드를 쓸 수 없다.
    const other = await tokenRequest({ ...form, code_verifier: verifier }, basicAuth("email-only", "other-secret"));
    expect(other.status).toBe(400);

    const post = await tokenRequest({ ...form, code_verifier: verifier, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }, "");
    expect(post.status).toBe(200);
  });

  it("거부하면 access_denied로 돌려보내고 코드를 주지 않는다", async () => {
    mhaksa.users.set("hong", "202600123");
    const browser = new Browser();
    await loginUntilConsent(browser, "hong@ajou.ac.kr");
    const page = await browser.fetch("/consent");
    const res = await browser.postForm("/consent", { csrf: csrfFrom(await page.text()), decision: "deny" });
    const location = new URL(res.headers.get("Location")!);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.has("code")).toBe(false);
  });

  it("CSRF 토큰이 틀리거나 다른 출처에서 보낸 동의는 거절한다", async () => {
    mhaksa.users.set("hong", "202600123");
    const browser = new Browser();
    await loginUntilConsent(browser, "hong@ajou.ac.kr");
    const csrf = csrfFrom(await (await browser.fetch("/consent")).text());
    expect((await browser.postForm("/consent", { csrf: "wrong", decision: "allow" })).status).toBe(400);
    const cross = await browser.postForm("/consent", { csrf, decision: "allow" }, { Origin: "https://evil.example.com" });
    expect(cross.status).toBe(403);
  });

  it("email/profile만 요청하면 mhaksa를 조회하지 않는다", async () => {
    const { location } = await loginAndConsent(new Browser(), "staff@ajou.ac.kr", { scope: "openid email" });
    expect(location.searchParams.has("code")).toBe(true);
    expect(mhaksa.calls).toEqual([]);
  });
});

describe("화면", () => {
  it("같은 출처 폼 POST에 Origin이 실리도록 Referrer-Policy는 same-origin이다", async () => {
    // no-referrer면 브라우저가 Origin: null을 보내 동의와 관리 화면의 모든 POST가 403이 된다.
    const res = await SELF.fetch(`${ISSUER}/nope`);
    expect(res.headers.get("Referrer-Policy")).toBe("same-origin");
  });
});

describe("로그인 거절", () => {
  it.each([
    ["다른 도메인", "someone@gmail.com", {}],
    ["Workspace가 아닌 계정(hd 없음)", "hong@ajou.ac.kr", { hd: undefined }],
    ["이메일 미인증", "hong@ajou.ac.kr", { email_verified: false }],
  ])("%s", async (_name, email, extra) => {
    google.claims = googleUser(email, extra);
    const { res } = await loginUntilConsent(new Browser(), email);
    expect(res.status).toBe(403);
  });

  it("학생 정보가 없으면 동의 화면으로 가지 않는다", async () => {
    const { res } = await loginUntilConsent(new Browser(), "nobody@ajou.ac.kr");
    expect(res.status).toBe(403);
  });

  it("mhaksa의 학교 이메일이 로그인 계정과 다르면 거절한다", async () => {
    mhaksa.users.set("hong", "202600123");
    mhaksa.schEmail.set("202600123", "other@ajou.ac.kr");
    const { res } = await loginUntilConsent(new Browser(), "hong@ajou.ac.kr");
    expect(res.status).toBe(403);
  });

  it("mhaksa에 연결할 수 없으면 502", async () => {
    mhaksa.down = true;
    const { res } = await loginUntilConsent(new Browser(), "hong@ajou.ac.kr");
    expect(res.status).toBe(502);
  });

  it("흐름 쿠키 없이 콜백에 오면 거절한다", async () => {
    const res = await new Browser().fetch("/callback/google?state=x&code=y");
    expect(res.status).toBe(400);
  });
});

describe("설정", () => {
  it("운영 ISSUER에서 DEV_FAKE_LOGIN을 켜면 모든 요청이 500이다", async () => {
    const fetch = workerWith({ ISSUER: "https://id.b-cube.kr", DEV_FAKE_LOGIN: "true" });
    const res = await fetch(new Request("https://id.b-cube.kr/.well-known/openid-configuration"));
    expect(res.status).toBe(500);
  });

  it("개발용 가짜 로그인은 켰을 때만 등록된다", async () => {
    expect((await SELF.fetch(`${ISSUER}/dev/login`, { method: "POST" })).status).toBe(404);
    const fetch = workerWith({ DEV_FAKE_LOGIN: "true" });
    const { url } = await authorizeUrl();
    const res = await fetch(new Request(`${ISSUER}${url}`));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("개발용 로그인");
  });

  it("cron이 만료된 사용 기록을 지운다", async () => {
    await env.DB.prepare(`INSERT INTO used_codes (jti, expires_at) VALUES ('old', 1), ('new', ?)`)
      .bind(Date.now() + 60_000)
      .run();
    const { default: worker } = await import("../src/index");
    const { createExecutionContext, createScheduledController, waitOnExecutionContext } = await import("cloudflare:test");
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController(), env, ctx);
    await waitOnExecutionContext(ctx);
    const rows = await env.DB.prepare(`SELECT jti FROM used_codes WHERE jti IN ('old', 'new')`).all();
    expect(rows.results.map((r) => r.jti)).toEqual(["new"]);
  });
});
