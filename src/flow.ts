/**
 * 로그인 흐름 상태. 서버에 저장하지 않고 암호화한 쿠키에 담는다.
 *
 * 흐름마다 id를 붙여 쿠키를 따로 둔다. 두 탭에서 동시에 로그인해도 서로의 쿠키를 덮어쓰지 않는다.
 * id는 Google state(`<id>.<랜덤>`)와 동의 화면 주소(`/consent?flow=<id>`)로 흐름을 따라다닌다.
 */
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomToken } from "./crypto";
import type { Config } from "./env";
import { seal, unseal } from "./keys";
import type { FlowPayload, HonoEnv } from "./types";

/** 로그인부터 동의까지 허용하는 시간 */
export const FLOW_TTL_SEC = 600;

/** 동시에 진행할 수 있는 흐름 수. 넘으면 가장 오래된 흐름 쿠키를 지운다(요청 헤더 크기 제한). */
export const MAX_FLOWS = 5;

/** 시각(36진수, 정렬용) + 랜덤. 쿠키 이름에 그대로 쓴다. */
const FLOW_ID = /^[0-9a-z]{1,12}-[A-Za-z0-9_-]{16}$/;

export function newFlowId(): string {
  return `${Date.now().toString(36)}-${randomToken(12)}`;
}

export function isFlowId(value: unknown): value is string {
  return typeof value === "string" && FLOW_ID.test(value);
}

/** Google state는 `<흐름 id>.<랜덤>`이다. 콜백에서 어느 흐름인지 찾는 데 쓴다. */
export function flowIdFromState(state: string | undefined): string | null {
  const id = state?.split(".", 1)[0];
  return isFlowId(id) ? id : null;
}

/** 운영: `__Host-idp_flow_<id>`. 로컬(http)은 `__Host-`를 쓸 수 없어 `idp_flow_<id>`. */
function flowCookiePrefix(config: Config): string {
  return config.isDev ? "idp_flow_" : "__Host-idp_flow_";
}

export async function saveFlow(c: Context<HonoEnv>, id: string, flow: FlowPayload): Promise<void> {
  const config = c.var.config;
  const prefix = flowCookiePrefix(config);
  const name = prefix + id;
  // 새 흐름을 열 때 다른 흐름이 너무 많으면 오래된 것부터 지운다. id가 시각으로 시작해 이름순이 시작순이다.
  const others = Object.keys(getCookie(c))
    .filter((n) => n.startsWith(prefix) && n !== name)
    .sort();
  for (const old of others.slice(0, Math.max(0, others.length - (MAX_FLOWS - 1)))) {
    deleteCookie(c, old, { path: "/", secure: !config.isDev });
  }

  const token = await seal(config, "flow", { ...flow }, FLOW_TTL_SEC);
  setCookie(c, name, token, {
    httpOnly: true,
    secure: !config.isDev,
    // Google에서 돌아오는 top-level GET에도 쿠키가 실려야 하므로 Lax.
    sameSite: "Lax",
    path: "/",
    maxAge: FLOW_TTL_SEC,
  });
}

export async function loadFlow(c: Context<HonoEnv>, id: string | null): Promise<FlowPayload | null> {
  if (!id) return null;
  const config = c.var.config;
  const payload = await unseal<FlowPayload & Record<string, unknown>>(
    config,
    "flow",
    getCookie(c, flowCookiePrefix(config) + id),
  );
  return payload?.req || payload?.admin || payload?.account ? payload : null;
}

export function clearFlow(c: Context<HonoEnv>, id: string): void {
  const config = c.var.config;
  deleteCookie(c, flowCookiePrefix(config) + id, { path: "/", secure: !config.isDev });
}
