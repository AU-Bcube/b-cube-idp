import type { MiddlewareHandler } from "hono";

/** 기본 CSP. 화면에는 인라인 스타일만 있고 스크립트는 없다. */
export function csp(formAction = "'self'"): string {
  return (
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; " +
    `form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`
  );
}

/** 라우트가 정한 CSP와 Cache-Control은 유지하고, 없으면 기본값을 붙인다. */
export function applySecurityHeaders(headers: Headers): void {
  if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", csp());
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  // no-referrer는 안 된다. 브라우저가 같은 출처 폼 POST에도 `Origin: null`을 보내 sameOrigin 검사가 실패한다.
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Strict-Transport-Security", "max-age=31536000");
}

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  // 리다이렉트 등 불변 헤더 응답에도 적용하기 위해 새 Response로 감싼다.
  try {
    applySecurityHeaders(c.res.headers);
  } catch {
    const res = new Response(c.res.body, c.res);
    applySecurityHeaders(res.headers);
    c.res = res;
  }
};
