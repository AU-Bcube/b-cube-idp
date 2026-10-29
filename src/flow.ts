/**
 * 로그인 흐름 상태. 서버에 저장하지 않고 암호화한 쿠키 하나에 담는다.
 */
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Config } from "./env";
import { seal, unseal } from "./keys";
import type { FlowPayload, HonoEnv } from "./types";

/** 로그인부터 동의까지 허용하는 시간 */
export const FLOW_TTL_SEC = 600;

/** 운영: `__Host-idp_flow`. 로컬(http)은 `__Host-`를 쓸 수 없어 `idp_flow`. */
export function flowCookieName(config: Config): string {
  return config.isDev ? "idp_flow" : "__Host-idp_flow";
}

export async function saveFlow(c: Context<HonoEnv>, flow: FlowPayload): Promise<void> {
  const config = c.var.config;
  const token = await seal(config, "flow", { ...flow }, FLOW_TTL_SEC);
  setCookie(c, flowCookieName(config), token, {
    httpOnly: true,
    secure: !config.isDev,
    // Google에서 돌아오는 top-level GET에도 쿠키가 실려야 하므로 Lax.
    sameSite: "Lax",
    path: "/",
    maxAge: FLOW_TTL_SEC,
  });
}

export async function loadFlow(c: Context<HonoEnv>): Promise<FlowPayload | null> {
  const config = c.var.config;
  const payload = await unseal<FlowPayload & Record<string, unknown>>(
    config,
    "flow",
    getCookie(c, flowCookieName(config)),
  );
  return payload?.req || payload?.admin ? payload : null;
}

export function clearFlow(c: Context<HonoEnv>): void {
  const config = c.var.config;
  deleteCookie(c, flowCookieName(config), { path: "/", secure: !config.isDev });
}
