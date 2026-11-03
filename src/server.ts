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

/** 요청 주소를 오픈그래프 주소로 쓰는 Netlify 배포 컨텍스트. 운영에서는 요청의 Host를 믿지 않고 ISSUER를 쓴다. */
const PREVIEW_DEPLOY_CONTEXTS: ReadonlySet<string> = new Set(["deploy-preview", "branch-deploy"]);

/** 플랫폼과 무관한 요청 처리. Netlify Function(netlify/functions/idp.mts)과 테스트가 이 함수를 부른다. */
export async function handle(request: Request, env: RawEnv, deployContext?: string): Promise<Response> {
  let config;
  try {
    config = getConfig(env);
  } catch (err) {
    // 필수값 누락이나 운영 주소 + 개발 플래그: 모든 요청을 500으로 막는다.
    console.error("[config]", err instanceof Error ? err.message : err);
    return configErrorResponse();
  }
  const previewOrigin =
    deployContext && PREVIEW_DEPLOY_CONTEXTS.has(deployContext) ? new URL(request.url).origin : undefined;
  return getApp(config).fetch(request, { DB: await getCollections(config), previewOrigin });
}
