/** 여러 라우트가 같이 쓰는 응답: 오류 화면, Google 로그인 시작. */
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { randomToken, sha256Base64url } from "./crypto";
import { saveFlow } from "./flow";
import { buildGoogleAuthUrl } from "./google";
import type { FlowPayload, HonoEnv } from "./types";
import { DevLoginPage, ErrorPage } from "./views";

export function errorPage(c: Context<HonoEnv>, status: ContentfulStatusCode, title: string, message: string) {
  return c.html(<ErrorPage title={title} message={message} />, status);
}

/** 흐름 쿠키를 만들고 Google 로그인(개발 모드에서는 가짜 로그인 화면)으로 보낸다. */
export async function startGoogleLogin(c: Context<HonoEnv>, flow: Pick<FlowPayload, "req" | "admin">) {
  const config = c.var.config;
  const google = { state: randomToken(32), nonce: randomToken(32), verifier: randomToken(32) };
  await saveFlow(c, { ...flow, google });

  if (config.devFakeLogin) return c.html(<DevLoginPage csrf={google.state} admin={flow.admin === true} />);
  const codeChallenge = await sha256Base64url(google.verifier);
  return c.redirect(buildGoogleAuthUrl(config, { state: google.state, nonce: google.nonce, codeChallenge }), 302);
}
