import { getApp } from "./app";
import { getConfig } from "./env";
import { applySecurityHeaders } from "./security";

function configErrorResponse(): Response {
  const res = new Response("서버 설정 오류입니다. 관리자에게 문의하세요.", {
    status: 500,
    headers: { "Content-Type": "text/plain; charset=UTF-8" },
  });
  applySecurityHeaders(res.headers);
  return res;
}

export default {
  async fetch(request, env, ctx) {
    let config;
    try {
      config = getConfig(env);
    } catch (err) {
      // 필수값 누락이나 운영 주소 + 개발 플래그: 모든 요청을 500으로 막는다.
      console.error("[config]", err instanceof Error ? err.message : err);
      return configErrorResponse();
    }
    return getApp(config).fetch(request, env, ctx);
  },

  async scheduled(_controller, env, ctx) {
    // 만료된 코드는 어차피 복호화 단계에서 거절되므로 기록을 지워도 된다.
    ctx.waitUntil(env.DB.prepare(`DELETE FROM used_codes WHERE expires_at < ?`).bind(Date.now()).run());
  },
} satisfies ExportedHandler<Env>;
