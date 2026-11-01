/**
 * 환경 변수 파싱과 검증.
 *
 * - ISSUER가 http://localhost:* 이면 개발 모드다. 개발 모드에서만 DEV_FAKE_LOGIN을 켤 수 있다.
 * - 설정이 잘못되면 ConfigError를 던지고, 요청 핸들러는 모든 요청에 500을 반환한다.
 * - Netlify Functions는 netlify.toml의 환경 변수를 런타임에 받지 못한다. 값은 Netlify 사이트 설정에 넣는다.
 */

/** process.env 모양의 환경 변수 */
export type RawEnv = Record<string, string | undefined>;

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
  devFakeLogin: boolean;
  /** 관리 화면에 들어갈 수 있는 이메일. 비어 있으면 관리 화면을 쓸 수 없다. */
  adminEmails: ReadonlySet<string>;
  /** MongoDB 연결 문자열 */
  dbConnectionString: string;
  dbName: string;
}

/** 개발 모드 + DEV_FAKE_LOGIN에서 ADMIN_EMAILS에 자동으로 들어가는 계정 */
export const DEV_ADMIN_EMAIL = "admin@ajou.ac.kr";

export class ConfigError extends Error {
  override name = "ConfigError";
}

const LOCALHOST_ORIGIN = /^http:\/\/localhost(?::\d{1,5})?$/;

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

export function parseConfig(raw: RawEnv): Config {
  const errors: string[] = [];

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

  const allowedEmailDomain = (str(raw.ALLOWED_EMAIL_DOMAIN) || "ajou.ac.kr").toLowerCase();

  const dbConnectionString = str(raw.DB_CONNECTION_STRING);
  if (!/^mongodb(\+srv)?:\/\//.test(dbConnectionString)) {
    errors.push("DB_CONNECTION_STRING은 mongodb:// 또는 mongodb+srv:// 주소여야 합니다");
  }
  const dbName = str(raw.DB_NAME);
  if (!dbName) errors.push("DB_NAME이 필요합니다");

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
    devFakeLogin,
    adminEmails,
    dbConnectionString,
    dbName,
  };
}

const cache = new WeakMap<object, Config>();

/** env 객체 단위로 파싱 결과를 캐시한다. 실패하면 매번 다시 던진다. */
export function getConfig(env: RawEnv): Config {
  let config = cache.get(env);
  if (!config) {
    config = parseConfig(env);
    cache.set(env, config);
  }
  return config;
}
