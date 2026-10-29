/**
 * 사용자 쪽 화면: Google 콜백, 동의 화면, 개발용 가짜 로그인.
 * 같은 Google 콜백을 SP 로그인과 관리 화면 로그인이 함께 쓴다. 흐름 쿠키의 admin 여부로 나눈다.
 */
import { Hono, type Context } from "hono";
import { createAdminSession } from "../admin-session";
import { findClient } from "../clients";
import { randomToken, timingSafeEqual } from "../crypto";
import { clearFlow, loadFlow, saveFlow } from "../flow";
import {
  checkGoogleIdentity,
  exchangeGoogleCode,
  OAuthError,
  verifyGoogleIdToken,
  type GoogleIdentity,
} from "../google";
import { errorPage } from "../respond";
import { MHAKSA_SCOPES } from "../scopes";
import { csp } from "../security";
import { fakeStudentLookup, lookupStudent, StudentLookupError } from "../student";
import type { FlowPayload, HonoEnv } from "../types";
import { ConsentPage } from "../views";
import { issueCode, redirectToClient } from "./oidc";

const EXPIRED_MESSAGE = "로그인 요청이 만료되었거나 올바르지 않습니다. 이용하던 서비스에서 다시 로그인해 주세요.";

const LOOKUP_MESSAGES: Record<StudentLookupError["reason"], string> = {
  not_found: "학사 시스템에서 이 계정의 학생 정보를 찾을 수 없습니다. 학생 계정으로 로그인했는지 확인해 주세요.",
  mismatch: "학사 시스템의 학생 정보가 로그인한 계정과 일치하지 않습니다.",
  unavailable: "학사 시스템에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
};

/** 같은 출처에서 보낸 폼인지 확인한다. Origin이 없으면 SameSite 쿠키와 CSRF 토큰에 맡긴다. */
export function sameOrigin(c: Context<HonoEnv>): boolean {
  const origin = c.req.header("Origin");
  return origin === undefined || origin === c.var.config.issuer;
}

/** Google(또는 가짜 로그인) 인증을 마친 뒤의 처리. */
async function completeAuthentication(c: Context<HonoEnv>, flow: FlowPayload, identity: GoogleIdentity) {
  const config = c.var.config;
  if (flow.admin) {
    clearFlow(c);
    if (!config.adminEmails.has(identity.email)) {
      console.warn("[admin] 관리자가 아닌 계정의 로그인 시도:", identity.email);
      return errorPage(c, 403, "관리자가 아닙니다", `${identity.email} 계정은 관리 화면을 쓸 수 없습니다.`);
    }
    await createAdminSession(c, identity.email);
    return c.redirect("/admin", 302);
  }

  const req = flow.req!;
  let mhaksa = {};
  if (req.scopes.some((s) => MHAKSA_SCOPES.has(s))) {
    const lookup = config.devFakeLogin ? fakeStudentLookup : lookupStudent;
    try {
      mhaksa = await lookup(config, identity.email, req.scopes);
    } catch (err) {
      if (!(err instanceof StudentLookupError)) throw err;
      console.warn("[mhaksa]", err.reason, err.message);
      clearFlow(c);
      return errorPage(c, err.reason === "unavailable" ? 502 : 403, "학생 정보 확인 실패", LOOKUP_MESSAGES[err.reason]);
    }
  }
  await saveFlow(c, {
    req,
    user: { ...identity, auth_time: Math.floor(Date.now() / 1000), mhaksa },
    csrf: randomToken(32),
  });
  return c.redirect("/consent", 302);
}

export const loginRoutes = new Hono<HonoEnv>()
  .get("/callback/google", async (c) => {
    const config = c.var.config;
    const flow = await loadFlow(c);
    if (!flow?.google) return errorPage(c, 400, "로그인 실패", EXPIRED_MESSAGE);

    const googleError = c.req.query("error");
    if (googleError) {
      // 사용자가 계정 선택을 취소한 경우 등
      console.warn("[oauth] Google 오류 응답:", googleError.slice(0, 64));
      clearFlow(c);
      if (!flow.req) return errorPage(c, 400, "로그인 취소", "Google 로그인이 취소되었습니다.");
      return redirectToClient(c, flow.req, { error: "access_denied", error_description: "Google login cancelled" });
    }
    const state = c.req.query("state");
    const code = c.req.query("code");
    if (!state || !timingSafeEqual(state, flow.google.state) || !code) {
      return errorPage(c, 400, "로그인 실패", EXPIRED_MESSAGE);
    }

    let claims;
    try {
      const idToken = await exchangeGoogleCode(config, code, flow.google.verifier);
      claims = await verifyGoogleIdToken(config, idToken, flow.google.nonce);
    } catch (err) {
      if (!(err instanceof OAuthError)) throw err;
      console.error("[oauth]", err.message);
      clearFlow(c);
      return errorPage(c, 502, "로그인 실패", "Google 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    }
    const checked = checkGoogleIdentity(config, claims);
    if (!checked.ok) {
      clearFlow(c);
      const message =
        checked.reason === "email_unverified"
          ? "이메일 인증이 완료되지 않은 Google 계정입니다."
          : `@${config.allowedEmailDomain} 학교 Google 계정으로 로그인해 주세요.`;
      return errorPage(c, 403, "로그인할 수 없는 계정", message);
    }
    return completeAuthentication(c, flow, checked.identity);
  })
  .get("/consent", async (c) => {
    const flow = await loadFlow(c);
    if (!flow?.req || !flow.user || !flow.csrf) return errorPage(c, 400, "로그인 실패", EXPIRED_MESSAGE);
    const client = await findClient(c.var.config, c.env.DB, flow.req.client_id);
    if (client?.status !== "active") return errorPage(c, 400, "로그인 실패", EXPIRED_MESSAGE);

    // 동의 후 SP로 리다이렉트하므로 form-action에 SP 출처를 더한다(브라우저가 리다이렉트에도 적용한다).
    const spOrigin = new URL(flow.req.redirect_uri).origin;
    c.header("Content-Security-Policy", csp(`'self' ${spOrigin}`));
    return c.html(
      <ConsentPage
        clientName={client.name}
        reviewed={client.reviewed}
        redirectOrigin={spOrigin}
        user={flow.user}
        scopes={flow.req.scopes}
        csrf={flow.csrf}
      />,
    );
  })
  .post("/consent", async (c) => {
    const flow = await loadFlow(c);
    const body = await c.req.parseBody();
    if (!flow?.req || !flow.user || !flow.csrf || typeof body.csrf !== "string" || !timingSafeEqual(body.csrf, flow.csrf)) {
      return errorPage(c, 400, "로그인 실패", EXPIRED_MESSAGE);
    }
    if (!sameOrigin(c)) return errorPage(c, 403, "잘못된 요청", "다른 사이트에서 보낸 요청입니다.");

    // 흐름 쿠키는 한 번만 쓴다.
    clearFlow(c);
    if (body.decision !== "allow") {
      return redirectToClient(c, flow.req, { error: "access_denied", error_description: "user denied consent" });
    }
    // 동의 화면을 띄운 사이에 SP가 정지되었을 수 있다.
    const client = await findClient(c.var.config, c.env.DB, flow.req.client_id);
    if (client?.status !== "active") {
      return redirectToClient(c, flow.req, { error: "unauthorized_client", error_description: "client is not active" });
    }
    const code = await issueCode(c.var.config, flow.req, flow.user);
    return redirectToClient(c, flow.req, { code });
  });

/** DEV_FAKE_LOGIN이 켜졌을 때만 등록한다. */
export const devLoginRoutes = new Hono<HonoEnv>().post("/dev/login", async (c) => {
  const flow = await loadFlow(c);
  const body = await c.req.parseBody();
  if (!flow?.google || typeof body.csrf !== "string" || !timingSafeEqual(body.csrf, flow.google.state)) {
    return errorPage(c, 400, "로그인 실패", EXPIRED_MESSAGE);
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email.endsWith(`@${c.var.config.allowedEmailDomain}`)) {
    return errorPage(c, 403, "로그인할 수 없는 계정", `@${c.var.config.allowedEmailDomain} 이메일을 입력해 주세요.`);
  }
  return completeAuthentication(c, flow, { sub: `dev-${email}`, email, name: `개발용 ${email.split("@")[0]}` });
});
