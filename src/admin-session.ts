/**
 * 관리 화면 세션. 서버에 저장하지 않고 암호화한 쿠키에 담는다.
 * 요청마다 ADMIN_EMAILS를 다시 확인하므로, 목록에서 빼면 쿠키가 남아 있어도 바로 막힌다.
 */
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomToken } from "./crypto";
import type { Config } from "./env";
import { seal, unseal } from "./keys";
import type { HonoEnv } from "./types";

export const ADMIN_SESSION_TTL_SEC = 8 * 60 * 60;

export interface AdminSession {
  email: string;
  csrf: string;
}

/** 운영: `__Host-idp_admin`. 로컬(http)은 `__Host-`를 쓸 수 없어 `idp_admin`. */
export function adminCookieName(config: Config): string {
  return config.isDev ? "idp_admin" : "__Host-idp_admin";
}

export async function createAdminSession(c: Context<HonoEnv>, email: string): Promise<void> {
  const config = c.var.config;
  const session: AdminSession = { email, csrf: randomToken(32) };
  setCookie(c, adminCookieName(config), await seal(config, "admin", { ...session }, ADMIN_SESSION_TTL_SEC), {
    httpOnly: true,
    secure: !config.isDev,
    // Google 콜백(교차 사이트 리다이렉트) 직후 /admin 요청에도 실려야 하므로 Lax. 쓰기 요청은 CSRF 토큰으로 막는다.
    sameSite: "Lax",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_SEC,
  });
}

export async function loadAdminSession(c: Context<HonoEnv>): Promise<AdminSession | null> {
  const config = c.var.config;
  const payload = await unseal<AdminSession & Record<string, unknown>>(
    config,
    "admin",
    getCookie(c, adminCookieName(config)),
  );
  if (!payload || typeof payload.email !== "string" || typeof payload.csrf !== "string") return null;
  if (!config.adminEmails.has(payload.email)) return null;
  return { email: payload.email, csrf: payload.csrf };
}

export function clearAdminSession(c: Context<HonoEnv>): void {
  const config = c.var.config;
  deleteCookie(c, adminCookieName(config), { path: "/", secure: !config.isDev });
}
