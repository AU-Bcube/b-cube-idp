import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MAX_FLOWS } from "../src/flow";
import {
  appFetch,
  appWith,
  authorizeUrl,
  basicAuth,
  Browser,
  CLIENT_ID,
  CLIENT_SECRET,
  consentForm,
  google,
  googleUser,
  installFakes,
  isConsentRedirect,
  ISSUER,
  loginAndConsent,
  loginUntilConsent,
  mhaksa,
  OTHER_CLIENT_ID,
  OTHER_CLIENT_SECRET,
  OTHER_REDIRECT_URI,
  REDIRECT_URI,
  resetFakes,
  SENSITIVE,
  testDb,
  tokenRequest,
} from "./helpers";

beforeAll(installFakes);
beforeEach(resetFakes);

async function verifyIdToken(idToken: string) {
  const jwks = (await (await appFetch(`${ISSUER}/jwks.json`)).json()) as { keys: never[] };
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
    const doc = (await (await appFetch(`${ISSUER}/.well-known/openid-configuration`)).json()) as Record<string, unknown>;
    expect(doc.issuer).toBe(ISSUER);
    expect(doc.token_endpoint).toBe(`${ISSUER}/token`);
    expect(doc.code_challenge_methods_supported).toEqual(["S256"]);

    const jwks = (await (await appFetch(`${ISSUER}/jwks.json`)).json()) as { keys: Record<string, unknown>[] };
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
    expect(jwks.keys[0]).not.toHaveProperty("d");
  });
});

describe("/authorize 검증", () => {
  it("등록되지 않은 client_id나 redirect_uri는 SP로 보내지 않고 오류 화면을 보여준다", async () => {
    const unknownClient = await authorizeUrl({ clientId: "nope" });
    const res1 = await appFetch(`${ISSUER}${unknownClient.url}`);
    expect(res1.status).toBe(400);

    const badRedirect = await authorizeUrl({ redirectUri: "https://evil.example.com/cb" });
    const res2 = await appFetch(`${ISSUER}${badRedirect.url}`);
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
    const res = await appFetch(`${ISSUER}${url}`);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe(REDIRECT_URI);
    expect(location.searchParams.get("error")).toBe(error);
    expect(location.searchParams.get("state")).toBe("sp-state");
    expect(location.searchParams.get("iss")).toBe(ISSUER);
  });

  it("SP에 허용되지 않은 scope는 거절한다", async () => {
    const { url } = await authorizeUrl({
      clientId: OTHER_CLIENT_ID,
      redirectUri: OTHER_REDIRECT_URI,
      scope: "openid email student",
    });
    const res = await appFetch(`${ISSUER}${url}`);
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
    expect(isConsentRedirect(res)).toBe(true);

    const page = await browser.fetch(res.headers.get("Location")!);
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

    const info = await appFetch(`${ISSUER}/userinfo`, { headers: { Authorization: `Bearer ${body.access_token}` } });
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
    const other = await tokenRequest({ ...form, code_verifier: verifier }, basicAuth(OTHER_CLIENT_ID, OTHER_CLIENT_SECRET));
    expect(other.status).toBe(400);

    const post = await tokenRequest({ ...form, code_verifier: verifier, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }, "");
    expect(post.status).toBe(200);
  });

  it("거부하면 access_denied로 돌려보내고 코드를 주지 않는다", async () => {
    mhaksa.users.set("hong", "202600123");
    const browser = new Browser();
    const { res: callback } = await loginUntilConsent(browser, "hong@ajou.ac.kr");
    const page = await browser.fetch(callback.headers.get("Location")!);
    const res = await browser.postForm("/consent", { ...consentForm(await page.text()), decision: "deny" });
    const location = new URL(res.headers.get("Location")!);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.has("code")).toBe(false);
  });

  it("CSRF 토큰이 틀리거나 다른 출처에서 보낸 동의는 거절한다", async () => {
    mhaksa.users.set("hong", "202600123");
    const browser = new Browser();
    const { res } = await loginUntilConsent(browser, "hong@ajou.ac.kr");
    const form = consentForm(await (await browser.fetch(res.headers.get("Location")!)).text());
    expect((await browser.postForm("/consent", { ...form, csrf: "wrong", decision: "allow" })).status).toBe(400);
    const cross = await browser.postForm("/consent", { ...form, decision: "allow" }, { Origin: "https://evil.example.com" });
    expect(cross.status).toBe(403);
  });

  it("email/profile만 요청하면 mhaksa를 조회하지 않는다", async () => {
    const { location } = await loginAndConsent(new Browser(), "staff@ajou.ac.kr", { scope: "openid email" });
    expect(location.searchParams.has("code")).toBe(true);
    expect(mhaksa.calls).toEqual([]);
  });
});

describe("여러 탭", () => {
  it("한 브라우저에서 두 로그인을 동시에 진행해도 각자 끝난다", async () => {
    mhaksa.users.set("hong", "202600123");
    const browser = new Browser();
    google.claims = googleUser("hong@ajou.ac.kr");
    const tabA = await authorizeUrl({ scope: "openid email", extra: { state: "tab-a" } });
    const tabB = await authorizeUrl({
      clientId: "email-only",
      redirectUri: "https://other.example.com/cb",
      scope: "openid email",
      extra: { state: "tab-b" },
    });
    const googleA = new URL((await browser.fetch(tabA.url)).headers.get("Location")!);
    const googleB = new URL((await browser.fetch(tabB.url)).headers.get("Location")!);
    expect(browser.cookies.size).toBe(2);

    // A를 시작한 뒤 B를 시작했어도 A의 콜백과 동의가 B에 섞이지 않는다.
    const callback = (u: URL) =>
      browser.fetch(`/callback/google?state=${u.searchParams.get("state")}&code=${u.searchParams.get("nonce")}`);
    const consentA = await callback(googleA);
    const consentB = await callback(googleB);
    const pageA = await (await browser.fetch(consentA.headers.get("Location")!)).text();
    const pageB = await (await browser.fetch(consentB.headers.get("Location")!)).text();
    expect(pageA).toContain("테스트 SP");
    expect(pageB).toContain("이메일만");

    const doneB = new URL((await browser.postForm("/consent", { ...consentForm(pageB), decision: "allow" })).headers.get("Location")!);
    const doneA = new URL((await browser.postForm("/consent", { ...consentForm(pageA), decision: "allow" })).headers.get("Location")!);
    expect(doneA.origin + doneA.pathname).toBe(REDIRECT_URI);
    expect(doneA.searchParams.get("state")).toBe("tab-a");
    expect(doneB.origin).toBe("https://other.example.com");
    expect(doneB.searchParams.get("state")).toBe("tab-b");
    expect((await redeem(doneA, tabA.verifier)).status).toBe(200);
    expect(browser.cookies.size).toBe(0);
  });

  it(`흐름 쿠키는 ${MAX_FLOWS}개까지만 두고 오래된 것부터 지운다`, async () => {
    const browser = new Browser();
    const states: string[] = [];
    for (let i = 0; i < MAX_FLOWS + 2; i++) {
      const { url } = await authorizeUrl();
      states.push(new URL((await browser.fetch(url)).headers.get("Location")!).searchParams.get("state")!);
      // 흐름 id는 밀리초 시각으로 정렬한다.
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(browser.cookies.size).toBe(MAX_FLOWS);
    const names = [...browser.cookies.keys()];
    for (const state of states.slice(-MAX_FLOWS)) expect(names).toContain(`idp_flow_${state.split(".")[0]}`);
  });

  it("흐름 id가 없거나 다른 동의 폼은 거절한다", async () => {
    const browser = new Browser();
    const { res } = await loginUntilConsent(browser, "hong@ajou.ac.kr", { scope: "openid email" });
    const form = consentForm(await (await browser.fetch(res.headers.get("Location")!)).text());
    expect((await browser.fetch("/consent")).status).toBe(400);
    expect((await browser.postForm("/consent", { csrf: form.csrf, decision: "allow" })).status).toBe(400);
    expect((await browser.postForm("/consent", { ...form, flow: "0-AAAAAAAAAAAAAAAA", decision: "allow" })).status).toBe(400);
  });
});

describe("화면", () => {
  it("Carbon 스타일 파일을 쓰고 인라인 스타일과 스크립트를 허용하지 않는다", async () => {
    const res = await appFetch(`${ISSUER}/nope`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('href="/assets/app.css"');
    const policy = res.headers.get("Content-Security-Policy")!;
    expect(policy).toContain("style-src 'self' https://cdn.jsdelivr.net");
    expect(policy).toContain("default-src 'none'");
    expect(policy).not.toContain("unsafe-inline");
  });

  it("같은 출처 폼 POST에 Origin이 실리도록 Referrer-Policy는 same-origin이다", async () => {
    // no-referrer면 브라우저가 Origin: null을 보내 동의와 관리 화면의 모든 POST가 403이 된다.
    const res = await appFetch(`${ISSUER}/nope`);
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
    const fetch = appWith({ ISSUER: "https://id.b-cube.kr", DEV_FAKE_LOGIN: "true" });
    const res = await fetch(new Request("https://id.b-cube.kr/.well-known/openid-configuration"));
    expect(res.status).toBe(500);
  });

  it("개발용 가짜 로그인은 켰을 때만 등록된다", async () => {
    expect((await appFetch(`${ISSUER}/dev/login`, { method: "POST" })).status).toBe(404);
    const fetch = appWith({ DEV_FAKE_LOGIN: "true" });
    const { url } = await authorizeUrl();
    const res = await fetch(new Request(`${ISSUER}${url}`));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("개발용 로그인");
  });

  it("만료된 사용 기록은 TTL 인덱스가 지운다", async () => {
    const indexes = await (await testDb()).usedCodes.indexes();
    expect(indexes).toContainEqual(expect.objectContaining({ key: { expires_at: 1 }, expireAfterSeconds: 0 }));
  });
});
