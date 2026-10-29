/**
 * 환경 변수 파싱과 검증.
 *
 * - ISSUER가 http://localhost:* 이면 개발 모드다. 개발 모드에서만 DEV_FAKE_LOGIN을 켤 수 있다.
 * - 설정이 잘못되면 ConfigError를 던지고, fetch 핸들러는 모든 요청에 500을 반환한다.
 */
import { DYNAMIC_CLIENT_PREFIX, isAllowedRedirectUri } from "./clients";
import { isScope, type Scope } from "./scopes";

export interface ClientConfig {
  clientId: string;
  name: string;
  redirectUris: readonly string[];
  scopes: ReadonlySet<Scope>;
  /** client_secret의 SHA-256 hex (소문자) */
  secretSha256: string;
}

export interface Config {
  issuer: string;
  isDev: boolean;
  allowedEmailDomain: string;
  googleClientId: string;
  googleClientSecret: string;
  /** ES256 private JWK (JSON 문자열) */
  signingKey: string;
  /** 쿠키·인가 코드·액세스 토큰 암호화 키를 파생하는 비밀값 */
  encryptionSecret: string;
  mhaksaIntervalMs: number;
  devFakeLogin: boolean;
  /** 관리 화면에 들어갈 수 있는 이메일. 비어 있으면 관리 화면을 쓸 수 없다. */
  adminEmails: ReadonlySet<string>;
  clients: ReadonlyMap<string, ClientConfig>;
}

/** 개발 모드 + DEV_FAKE_LOGIN에서 ADMIN_EMAILS에 자동으로 들어가는 계정 */
export const DEV_ADMIN_EMAIL = "admin@ajou.ac.kr";

export class ConfigError extends Error {
  override name = "ConfigError";
}

const LOCALHOST_ORIGIN = /^http:\/\/localhost(?::\d{1,5})?$/;
const CLIENT_ID = /^[a-z0-9][a-z0-9-]{1,62}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function bool(name: string, value: unknown, errors: string[]): boolean {
  const v = str(value).toLowerCase();
  if (v === "" || v === "false" || v === "0") return false;
  if (v === "true" || v === "1") return true;
  errors.push(`${name}는 true/false 중 하나여야 합니다 (현재: "${str(value)}")`);
  return false;
}

function parseClients(value: unknown, isDev: boolean, errors: string[]): Map<string, ClientConfig> {
  let list: unknown = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      errors.push("CLIENTS는 JSON 배열이어야 합니다");
      return new Map();
    }
  }
  if (!Array.isArray(list)) {
    errors.push("CLIENTS는 배열이어야 합니다");
    return new Map();
  }

  const clients = new Map<string, ClientConfig>();
  list.forEach((raw: Record<string, unknown>, i) => {
    const where = `CLIENTS[${i}]`;
    const clientId = str(raw?.client_id);
    if (!CLIENT_ID.test(clientId)) errors.push(`${where}.client_id 형식이 올바르지 않습니다`);
    if (clientId.startsWith(DYNAMIC_CLIENT_PREFIX)) {
      errors.push(`${where}.client_id는 동적 등록용 접두사 ${DYNAMIC_CLIENT_PREFIX}로 시작할 수 없습니다`);
    }
    if (clients.has(clientId)) errors.push(`${where}.client_id(${clientId})가 중복됩니다`);

    const name = str(raw?.name);
    if (!name) errors.push(`${where}.name이 필요합니다`);

    const redirectUris = Array.isArray(raw?.redirect_uris) ? raw.redirect_uris.map(str) : [];
    if (redirectUris.length === 0) errors.push(`${where}.redirect_uris가 필요합니다`);
    for (const uri of redirectUris) {
      // http는 localhost에만 허용한다. fragment는 OAuth 2.0에서 금지된다.
      if (!isAllowedRedirectUri(uri)) errors.push(`${where}.redirect_uris에 허용되지 않는 주소가 있습니다: ${uri}`);
    }

    const scopeList = Array.isArray(raw?.scopes) ? raw.scopes.map(str) : [];
    const unknown = scopeList.filter((s) => !isScope(s));
    if (unknown.length > 0) errors.push(`${where}.scopes에 알 수 없는 값이 있습니다: ${unknown.join(", ")}`);
    if (!scopeList.includes("openid")) errors.push(`${where}.scopes에 openid가 있어야 합니다`);

    const secretSha256 = str(raw?.client_secret_sha256).toLowerCase();
    // 개발 모드에서는 해시가 비어 있어도 시작한다. 해시가 없으면 어떤 비밀값으로도 인증할 수 없으므로 안전하다.
    if (!SHA256_HEX.test(secretSha256)) {
      if (isDev) console.warn(`[config] ${where}.client_secret_sha256이 없어 이 SP는 토큰을 받을 수 없습니다`);
      else errors.push(`${where}.client_secret_sha256은 64자리 hex여야 합니다`);
    }

    clients.set(clientId, {
      clientId,
      name,
      redirectUris,
      scopes: new Set(scopeList.filter(isScope)),
      secretSha256,
    });
  });
  return clients;
}

export function parseConfig(env: Env): Config {
  const errors: string[] = [];
  const raw = env as unknown as Record<string, unknown>;

  const issuer = str(raw.ISSUER).replace(/\/+$/, "");
  if (!issuer) throw new ConfigError("ISSUER가 설정되지 않았습니다");
  const isDev = LOCALHOST_ORIGIN.test(issuer);
  if (!isDev && !/^https:\/\/[^/]+$/.test(issuer)) errors.push("운영 ISSUER는 경로 없는 https:// 주소여야 합니다");

  const devFakeLogin = bool("DEV_FAKE_LOGIN", raw.DEV_FAKE_LOGIN, errors);
  if (devFakeLogin && !isDev) {
    throw new ConfigError(`ISSUER(${issuer})가 localhost가 아닌데 DEV_FAKE_LOGIN이 켜져 있습니다`);
  }

  const googleClientId = str(raw.GOOGLE_CLIENT_ID);
  const googleClientSecret = str(raw.GOOGLE_CLIENT_SECRET);
  if ((!googleClientId || !googleClientSecret) && !devFakeLogin) {
    errors.push("GOOGLE_CLIENT_ID와 GOOGLE_CLIENT_SECRET이 필요합니다");
  }

  const signingKey = str(raw.SIGNING_KEY);
  if (!signingKey) errors.push("SIGNING_KEY가 필요합니다 (`pnpm keys`로 만든다)");
  const encryptionSecret = str(raw.ENCRYPTION_SECRET);
  if (encryptionSecret.length < 43) errors.push("ENCRYPTION_SECRET은 32바이트 이상이어야 합니다 (`pnpm keys`로 만든다)");

  const allowedEmailDomain = str(raw.ALLOWED_EMAIL_DOMAIN).toLowerCase();
  if (!allowedEmailDomain) errors.push("ALLOWED_EMAIL_DOMAIN이 필요합니다");

  const intervalRaw = str(raw.MHAKSA_INTERVAL_MS);
  const mhaksaIntervalMs = intervalRaw === "" ? 3000 : Number(intervalRaw);
  if (!Number.isInteger(mhaksaIntervalMs) || mhaksaIntervalMs < 0) {
    errors.push(`MHAKSA_INTERVAL_MS는 0 이상의 정수여야 합니다 (현재: "${intervalRaw}")`);
  }

  const clients = parseClients(raw.CLIENTS, isDev, errors);

  const adminEmails = new Set(
    str(raw.ADMIN_EMAILS)
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e !== ""),
  );
  // 개발 모드의 관리자 자동 포함은 여기서만 처리한다. 권한 검사 코드에는 개발용 분기가 없다.
  if (isDev && devFakeLogin) adminEmails.add(DEV_ADMIN_EMAIL);

  if (errors.length > 0) {
    throw new ConfigError(`설정 오류:\n- ${errors.join("\n- ")}`);
  }
  return {
    issuer,
    isDev,
    allowedEmailDomain,
    googleClientId,
    googleClientSecret,
    signingKey,
    encryptionSecret,
    mhaksaIntervalMs,
    devFakeLogin,
    adminEmails,
    clients,
  };
}

const cache = new WeakMap<object, Config>();

/** env 객체 단위로 파싱 결과를 캐시한다. 실패하면 매번 다시 던진다. */
export function getConfig(env: Env): Config {
  let config = cache.get(env);
  if (!config) {
    config = parseConfig(env);
    cache.set(env, config);
  }
  return config;
}
