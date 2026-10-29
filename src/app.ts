import { Hono } from "hono";
import { type Config, getConfig } from "./env";
import { adminRoutes } from "./routes/admin";
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
    c.set("config", getConfig(c.env));
    await next();
  });

  app.get("/", (c) => c.redirect("/.well-known/openid-configuration", 302));
  app.get("/health", async (c) => {
    await c.env.DB.prepare("SELECT 1").first();
    return c.json({ status: "ok", time: new Date().toISOString() });
  });
  app.route("/", oidcRoutes);
  app.route("/", loginRoutes);
  app.route("/", registerRoutes);
  app.route("/admin", adminRoutes);
  if (config.devFakeLogin) app.route("/", devLoginRoutes);

  app.notFound((c) => errorPage(c, 404, "페이지를 찾을 수 없습니다", "요청한 주소가 없습니다."));
  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[unhandled]", c.req.method, c.req.path, message, err);
    return errorPage(c, 500, "서버 오류", "잠시 후 다시 시도해 주세요.");
  });
  return app;
}

const apps = new Map<string, Hono<HonoEnv>>();

export function getApp(config: Config): Hono<HonoEnv> {
  // 라우트 구성에 영향을 주는 값만 키로 쓴다.
  const key = String(config.devFakeLogin);
  let app = apps.get(key);
  if (!app) {
    app = createApp(config);
    apps.set(key, app);
  }
  return app;
}
