import { env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findDynamicClient } from "../src/clients";
import {
  ADMIN_EMAIL,
  adminLogin,
  basicAuth,
  Browser,
  installFakes,
  ISSUER,
  loginAndConsent,
  register,
  resetFakes,
  tokenRequest,
  type Registered,
} from "./helpers";

beforeAll(installFakes);
beforeEach(resetFakes);

const SP_REDIRECT = "https://admin-made.example.com/cb";

async function loggedIn() {
  const browser = new Browser();
  const { csrf } = await adminLogin(browser);
  expect(csrf).not.toBeNull();
  return { browser, csrf: csrf! };
}

function secretsFrom(html: string): string[] {
  return [...html.matchAll(/<div class="secret mono">([^<]+)<\/div>/g)].map((m) => m[1]!);
}

describe("관리 화면 접근", () => {
  it("세션이 없으면 로그인으로 보내고, POST는 403", async () => {
    const res = await new Browser().fetch("/admin");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin/login");
    expect((await new Browser().postForm("/admin/tokens", { label: "x" })).status).toBe(403);
  });

  it("ADMIN_EMAILS에 없는 계정은 들어올 수 없다", async () => {
    const browser = new Browser();
    const { res, csrf } = await adminLogin(browser, "student@ajou.ac.kr");
    expect(res.status).toBe(403);
    expect(csrf).toBeNull();
    expect((await browser.fetch("/admin")).status).toBe(302);
  });

  it("관리자는 목록을 보고, 정적 SP도 목록에 나온다", async () => {
    const { browser } = await loggedIn();
    const html = await (await browser.fetch("/admin")).text();
    expect(html).toContain(ADMIN_EMAIL);
    expect(html).toContain("test-sp");
  });

  it("CSRF 토큰이 틀리거나 다른 출처에서 보낸 POST는 403", async () => {
    const { browser, csrf } = await loggedIn();
    expect((await browser.postForm("/admin/tokens", { csrf: "wrong", label: "x" })).status).toBe(403);
    const cross = await browser.postForm("/admin/tokens", { csrf, label: "x" }, { Origin: "https://evil.example.com" });
    expect(cross.status).toBe(403);
  });

  it("로그아웃하면 세션이 사라진다", async () => {
    const { browser, csrf } = await loggedIn();
    await browser.postForm("/admin/logout", { csrf });
    expect((await browser.fetch("/admin")).status).toBe(302);
  });
});

describe("SP 관리", () => {
  async function createSp(browser: Browser, csrf: string, scopes: string[] = ["email"]) {
    const form = new URLSearchParams({
      csrf,
      client_name: "관리자 SP",
      redirect_uris: SP_REDIRECT,
      token_endpoint_auth_method: "client_secret_basic",
      contacts: "",
      client_uri: "",
    });
    for (const s of scopes) form.append("scope", s);
    const res = await browser.fetch("/admin/clients", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ISSUER },
      body: form.toString(),
    });
    expect(res.status).toBe(200);
    const [clientId, clientSecret] = secretsFrom(await res.text());
    return { clientId: clientId!, clientSecret: clientSecret! };
  }

  it("관리자가 만든 SP는 바로 활성·검토 상태이고 로그인할 수 있다", async () => {
    const { browser, csrf } = await loggedIn();
    const { clientId, clientSecret } = await createSp(browser, csrf, ["email", "student"]);
    const client = await findDynamicClient(env.DB, clientId);
    expect(client).toMatchObject({ status: "active", reviewed: true, reviewedBy: ADMIN_EMAIL, registrationTokenSha256: null });
    expect([...client!.scopes]).toEqual(["openid", "email", "student"]);

    const { location, verifier } = await loginAndConsent(new Browser(), "hong@ajou.ac.kr", {
      clientId,
      redirectUri: SP_REDIRECT,
      scope: "openid email",
    });
    const res = await tokenRequest(
      { grant_type: "authorization_code", code: location.searchParams.get("code")!, redirect_uri: SP_REDIRECT, code_verifier: verifier },
      basicAuth(clientId, clientSecret),
    );
    expect(res.status).toBe(200);
  });

  it("잘못된 입력이면 폼을 다시 보여준다", async () => {
    const { browser, csrf } = await loggedIn();
    const res = await browser.postForm("/admin/clients", { csrf, client_name: "x", redirect_uris: "http://evil.example.com/cb" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("redirect_uri not allowed");
  });

  it("승인 대기 SP를 승인하고, 중지·재개·삭제한다", async () => {
    const { token } = await import("../src/initial-access-tokens").then((m) =>
      m.createInitialAccessToken(env.DB, { label: "t", maxUses: 1, ttlDays: 1, createdBy: "t" }),
    );
    const reg = (await (
      await register(token, { client_name: "학생 SP", redirect_uris: [SP_REDIRECT], scope: "openid student" })
    ).json()) as Registered;
    expect(reg.b_cube_status).toBe("pending");

    const { browser, csrf } = await loggedIn();
    expect(await (await browser.fetch("/admin")).text()).toContain("승인을 기다리는 SP가");
    const base = `/admin/clients/${reg.client_id}`;

    await browser.postForm(`${base}/approve`, { csrf });
    expect(await findDynamicClient(env.DB, reg.client_id)).toMatchObject({ status: "active", reviewed: true });

    await browser.postForm(`${base}/suspend`, { csrf });
    expect((await findDynamicClient(env.DB, reg.client_id))?.status).toBe("suspended");
    // 중지된 SP는 승인으로 되살리지 않는다.
    await browser.postForm(`${base}/approve`, { csrf });
    expect((await findDynamicClient(env.DB, reg.client_id))?.status).toBe("suspended");
    await browser.postForm(`${base}/resume`, { csrf });
    expect((await findDynamicClient(env.DB, reg.client_id))?.status).toBe("active");

    await browser.postForm(`${base}/delete`, { csrf });
    expect(await findDynamicClient(env.DB, reg.client_id)).toBeNull();

    const audit = await (await browser.fetch("/admin/audit")).text();
    for (const action of ["client.register", "client.approve", "client.suspend", "client.resume", "client.delete"]) {
      expect(audit).toContain(action);
    }
  });

  it("client_secret을 재발급하면 이전 값은 쓸 수 없다", async () => {
    const { browser, csrf } = await loggedIn();
    const { clientId, clientSecret } = await createSp(browser, csrf);
    const res = await browser.postForm(`/admin/clients/${clientId}/rotate-secret`, { csrf });
    const [, newSecret] = secretsFrom(await res.text());
    expect(newSecret).toBeTruthy();
    expect(newSecret).not.toBe(clientSecret);

    const { location, verifier } = await loginAndConsent(new Browser(), "hong@ajou.ac.kr", {
      clientId,
      redirectUri: SP_REDIRECT,
      scope: "openid",
    });
    const form = { grant_type: "authorization_code", code: location.searchParams.get("code")!, redirect_uri: SP_REDIRECT, code_verifier: verifier };
    expect((await tokenRequest(form, basicAuth(clientId, clientSecret))).status).toBe(401);
    expect((await tokenRequest(form, basicAuth(clientId, newSecret!))).status).toBe(200);
  });

  it("정적 SP는 관리 화면에서 바꿀 수 없다", async () => {
    const { browser, csrf } = await loggedIn();
    const page = await (await browser.fetch("/admin/clients/test-sp")).text();
    expect(page).toContain("wrangler.jsonc");
    expect(page).not.toContain("/admin/clients/test-sp/suspend");
    expect((await browser.postForm("/admin/clients/test-sp/suspend", { csrf })).status).toBe(404);
  });
});

describe("등록 토큰", () => {
  it("발급한 토큰으로 등록하고, 폐기하면 쓸 수 없다", async () => {
    const { browser, csrf } = await loggedIn();
    const issued = await browser.postForm("/admin/tokens", { csrf, label: "동아리 A", max_uses: "2", ttl_days: "7" });
    const [, token] = secretsFrom(await issued.text());
    expect(token).toMatch(/^iat_/);

    const body = { client_name: "A", redirect_uris: [SP_REDIRECT] };
    expect((await register(token!, body)).status).toBe(201);

    const list = await (await browser.fetch("/admin/tokens")).text();
    expect(list).toContain("동아리 A");
    expect(list).toContain("1 / 2");
    const id = /\/admin\/tokens\/([0-9a-f-]+)\/revoke/.exec(list)![1]!;
    await browser.postForm(`/admin/tokens/${id}/revoke`, { csrf });
    expect((await register(token!, body)).status).toBe(401);
  });

  it("토큰 원문은 저장하지 않는다", async () => {
    const { browser, csrf } = await loggedIn();
    const issued = await browser.postForm("/admin/tokens", { csrf, label: "해시 확인", max_uses: "1", ttl_days: "1" });
    const [, token] = secretsFrom(await issued.text());
    const rows = await env.DB.prepare(`SELECT * FROM initial_access_tokens WHERE label = '해시 확인'`).all();
    expect(JSON.stringify(rows.results)).not.toContain(token!);
    expect(await (await SELF.fetch(`${ISSUER}/admin/tokens`, { redirect: "manual" })).status).toBe(302);
  });
});
