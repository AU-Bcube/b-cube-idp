import { Hono } from "hono";
import type { Config } from "./env";
import { adminRoutes } from "./routes/admin";
import { consentsRoutes } from "./routes/consents";
import { devLoginRoutes, loginRoutes } from "./routes/login";
import { errorPage } from "./respond";
import { oidcRoutes } from "./routes/oidc";
import { registerRoutes } from "./routes/register";
import { securityHeaders } from "./security";
import type { HonoEnv } from "./types";

/**
 * 설정에 따라 라우트를 등록한 Hono 앱을 만든다.
 * 개발 전용 라우트는 조건을 만족하지 않으면 등록 자체를 하지 않아 404가 된다.
 */
export function createApp(config: Config): Hono<HonoEnv> {
  const app = new Hono<HonoEnv>();

  app.use("*", securityHeaders);
  app.use("*", async (c, next) => {
    c.set("config", config);
    await next();
  });

  app.get("/", (c) => c.redirect("/.well-known/openid-configuration", 302));
  app.get("/health", async (c) => {
    await c.env.DB.clients.estimatedDocumentCount();
    return c.json({ status: "ok", time: new Date().toISOString() });
  });
  app.route("/", oidcRoutes);
  app.route("/", loginRoutes);
  app.route("/", registerRoutes);
  app.route("/admin", adminRoutes);
  app.route("/consents", consentsRoutes);
  if (config.devFakeLogin) app.route("/", devLoginRoutes);

  app.notFound((c) => errorPage(c, 404, "페이지를 찾을 수 없습니다", "요청한 주소가 없습니다."));
  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[unhandled]", c.req.method, c.req.path, message, err);
    return errorPage(c, 500, "서버 오류", "잠시 후 다시 시도해 주세요.");
  });
  return app;
}

const apps = new WeakMap<Config, Hono<HonoEnv>>();

/** getConfig가 환경 변수 객체마다 Config를 캐시하므로 앱도 Config마다 한 번만 만든다. */
export function getApp(config: Config): Hono<HonoEnv> {
  let app = apps.get(config);
  if (!app) {
    app = createApp(config);
    apps.set(config, app);
  }
  return app;
}
