/**
 * 동의 관리 화면 세션. 서버에 저장하지 않고 암호화한 쿠키에 담는다.
 * 내 동의를 보고 철회하는 동안만 쓰므로 짧게 둔다.
 */
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomToken } from "./crypto";
import type { Config } from "./env";
import type { GoogleIdentity } from "./google";
import { seal, unseal } from "./keys";
import type { HonoEnv } from "./types";

export const ACCOUNT_SESSION_TTL_SEC = 30 * 60;

export interface AccountSession {
  sub: string;
  email: string;
  name?: string | undefined;
  csrf: string;
}

/** 운영: `__Host-idp_account`. 로컬(http)은 `__Host-`를 쓸 수 없어 `idp_account`. */
function accountCookieName(config: Config): string {
  return config.isDev ? "idp_account" : "__Host-idp_account";
}

export async function createAccountSession(c: Context<HonoEnv>, identity: GoogleIdentity): Promise<void> {
  const config = c.var.config;
  const session: AccountSession = { sub: identity.sub, email: identity.email, name: identity.name, csrf: randomToken(32) };
  setCookie(c, accountCookieName(config), await seal(config, "account", { ...session }, ACCOUNT_SESSION_TTL_SEC), {
    httpOnly: true,
    secure: !config.isDev,
    // Google 콜백(교차 사이트 리다이렉트) 직후 /consents 요청에도 실려야 하므로 Lax. 철회는 CSRF 토큰으로 막는다.
    sameSite: "Lax",
    path: "/",
    maxAge: ACCOUNT_SESSION_TTL_SEC,
  });
}

export async function loadAccountSession(c: Context<HonoEnv>): Promise<AccountSession | null> {
  const config = c.var.config;
  const payload = await unseal<AccountSession & Record<string, unknown>>(
    config,
    "account",
    getCookie(c, accountCookieName(config)),
  );
  if (!payload || typeof payload.sub !== "string" || typeof payload.email !== "string" || typeof payload.csrf !== "string") {
    return null;
  }
  return {
    sub: payload.sub,
    email: payload.email,
    name: typeof payload.name === "string" ? payload.name : undefined,
    csrf: payload.csrf,
  };
}

export function clearAccountSession(c: Context<HonoEnv>): void {
  const config = c.var.config;
  deleteCookie(c, accountCookieName(config), { path: "/", secure: !config.isDev });
}
