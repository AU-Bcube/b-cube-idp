import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  accountLogin,
  Browser,
  google,
  googleUser,
  installFakes,
  isConsentRedirect,
  loginAndConsent,
  loginUntilConsent,
  mhaksa,
  resetFakes,
  SENSITIVE,
  testDb,
} from "./helpers";

beforeAll(installFakes);
beforeEach(resetFakes);

const consentCount = async (sub = "google-hong@ajou.ac.kr") => (await testDb()).consents.countDocuments({ sub });

describe("내 동의 관리", () => {
  it("로그인하지 않으면 Google 로그인으로 보내고, POST는 403", async () => {
    const browser = new Browser();
    const res = await browser.fetch("/consents");
    expect(res.headers.get("Location")).toBe("/consents/login");
    expect((await browser.fetch("/consents/login")).headers.get("Location")).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect((await new Browser().postForm("/consents/revoke", { client_id: "test-sp" })).status).toBe(403);
  });

  it("동의한 SP별로 제공하는 항목과 기한을 보여준다", async () => {
    mhaksa.users.set("hong", "202600123");
    await loginAndConsent(new Browser(), "hong@ajou.ac.kr", { scope: "openid email profile student sohakoe" });
    await loginAndConsent(new Browser(), "hong@ajou.ac.kr", {
      clientId: "email-only",
      redirectUri: "https://other.example.com/cb",
      scope: "openid email",
    });
    // 다른 사람의 동의는 보이지 않는다.
    google.claims = googleUser("kim@ajou.ac.kr");
    mhaksa.users.set("kim", "202600999");
    await loginAndConsent(new Browser(), "kim@ajou.ac.kr", { scope: "openid email" });

    const { html } = await accountLogin(new Browser(), "hong@ajou.ac.kr");
    expect(html).toContain("테스트 SP");
    expect(html).toContain("https://sp.example.com");
    expect(html).toContain("이메일만");
    expect(html).toContain("https://other.example.com");
    expect(html).toContain("hong@ajou.ac.kr");
    expect(html).toContain("구글 이름");
    expect(html).toContain("학적 정보");
    expect(html).toContain("소학회 가입 내역");
    expect(html).not.toContain("kim@ajou.ac.kr");
    // 학생 정보 값은 저장하지 않으므로 화면에도 없다.
    expect(html).not.toContain("202600123");
    for (const v of Object.values(SENSITIVE)) expect(html).not.toContain(v);
    expect(html.match(/name="client_id"/g)).toHaveLength(2);
  });

  it("SP별로 동의를 철회하면 그 SP만 다시 동의를 묻는다", async () => {
    await loginAndConsent(new Browser(), "hong@ajou.ac.kr", { scope: "openid email" });
    const emailOnly = { clientId: "email-only", redirectUri: "https://other.example.com/cb", scope: "openid email" };
    await loginAndConsent(new Browser(), "hong@ajou.ac.kr", emailOnly);
    expect(await consentCount()).toBe(2);

    const browser = new Browser();
    const { csrf } = await accountLogin(browser, "hong@ajou.ac.kr");
    const res = await browser.postForm("/consents/revoke", { csrf, client_id: "test-sp" });
    expect(res.headers.get("Location")).toBe("/consents?revoked=test-sp");
    const after = await (await browser.fetch(res.headers.get("Location")!)).text();
    expect(after).toContain("테스트 SP에 대한 동의를 철회했습니다");
    expect(after).not.toContain('value="test-sp"');
    expect(await consentCount()).toBe(1);

    const revokedSp = await loginUntilConsent(new Browser(), "hong@ajou.ac.kr", { scope: "openid email" });
    expect(isConsentRedirect(revokedSp.res)).toBe(true);
    const otherSp = await loginUntilConsent(new Browser(), "hong@ajou.ac.kr", emailOnly);
    expect(isConsentRedirect(otherSp.res)).toBe(false);
  });

  it("남의 동의는 철회할 수 없다", async () => {
    google.claims = googleUser("kim@ajou.ac.kr");
    await loginAndConsent(new Browser(), "kim@ajou.ac.kr", { scope: "openid email" });
    const browser = new Browser();
    const { csrf } = await accountLogin(browser, "hong@ajou.ac.kr");
    await browser.postForm("/consents/revoke", { csrf, client_id: "test-sp" });
    expect(await consentCount("google-kim@ajou.ac.kr")).toBe(1);
  });

  it("CSRF 토큰이 틀리거나 다른 출처에서 보낸 철회는 거절한다", async () => {
    await loginAndConsent(new Browser(), "hong@ajou.ac.kr", { scope: "openid email" });
    const browser = new Browser();
    const { csrf } = await accountLogin(browser, "hong@ajou.ac.kr");
    expect((await browser.postForm("/consents/revoke", { csrf: "wrong", client_id: "test-sp" })).status).toBe(403);
    const cross = await browser.postForm("/consents/revoke", { csrf, client_id: "test-sp" }, { Origin: "https://evil.example.com" });
    expect(cross.status).toBe(403);
    expect(await consentCount()).toBe(1);
  });

  it("로그아웃하면 세션 쿠키를 지우고 안내 페이지로 보낸다", async () => {
    const browser = new Browser();
    const { csrf } = await accountLogin(browser, "hong@ajou.ac.kr");
    expect(await (await browser.fetch("/consents")).text()).toContain("동의한 서비스가 없습니다");
    const res = await browser.postForm("/consents/logout", { csrf });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
    expect(browser.cookies.size).toBe(0);
    expect((await browser.fetch("/consents")).headers.get("Location")).toBe("/consents/login");
  });

  it("동의 화면에서 내 동의 관리로 가는 링크를 보여준다", async () => {
    const browser = new Browser();
    const { res } = await loginUntilConsent(browser, "hong@ajou.ac.kr", { scope: "openid email" });
    expect(await (await browser.fetch(res.headers.get("Location")!)).text()).toContain('href="/consents"');
  });
});
