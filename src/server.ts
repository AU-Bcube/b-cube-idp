import { getApp } from "./app";
import { getCollections } from "./db";
import { getConfig, type RawEnv } from "./env";
import { applySecurityHeaders } from "./security";

function configErrorResponse(): Response {
  const res = new Response("서버 설정 오류입니다. 관리자에게 문의하세요.", {
    status: 500,
    headers: { "Content-Type": "text/plain; charset=UTF-8" },
  });
  applySecurityHeaders(res.headers);
  return res;
}

/** 플랫폼과 무관한 요청 처리. Netlify Function(netlify/functions/idp.mts)과 테스트가 이 함수를 부른다. */
export async function handle(request: Request, env: RawEnv): Promise<Response> {
  let config;
  try {
    config = getConfig(env);
  } catch (err) {
    // 필수값 누락이나 운영 주소 + 개발 플래그: 모든 요청을 500으로 막는다.
    console.error("[config]", err instanceof Error ? err.message : err);
    return configErrorResponse();
  }
  return getApp(config).fetch(request, { DB: await getCollections(config) });
}
