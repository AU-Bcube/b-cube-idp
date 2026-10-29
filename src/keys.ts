/**
 * 서명 키(id_token)와 암호화 키(쿠키, 인가 코드, 액세스 토큰).
 *
 * 암호화 키는 ENCRYPTION_SECRET에서 용도별로 HKDF로 파생한다. 용도가 다른 토큰을 서로 바꿔 넣을 수 없다.
 */
import {
  calculateJwkThumbprint,
  importJWK,
  jwtDecrypt,
  EncryptJWT,
  SignJWT,
  type JWK,
  type JWTPayload,
} from "jose";
import { ConfigError, type Config } from "./env";

export const SIGNING_ALG = "ES256";

export type SealPurpose = "flow" | "code" | "access_token" | "admin";

interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
}

const signingKeys = new Map<string, Promise<SigningKey>>();

async function loadSigningKey(raw: string): Promise<SigningKey> {
  let jwk: JWK;
  try {
    jwk = JSON.parse(raw) as JWK;
  } catch {
    throw new ConfigError("SIGNING_KEY는 JWK JSON이어야 합니다");
  }
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d) {
    throw new ConfigError("SIGNING_KEY는 P-256 EC 개인 키 JWK여야 합니다");
  }
  const { d: _d, ...rest } = jwk;
  const kid = await calculateJwkThumbprint(rest);
  const publicJwk: JWK = { kty: rest.kty, crv: rest.crv, x: rest.x, y: rest.y, kid, alg: SIGNING_ALG, use: "sig" };
  const privateKey = (await importJWK(jwk, SIGNING_ALG)) as CryptoKey;
  return { kid, privateKey, publicJwk };
}

function signingKey(config: Config): Promise<SigningKey> {
  let key = signingKeys.get(config.signingKey);
  if (!key) {
    key = loadSigningKey(config.signingKey);
    signingKeys.set(config.signingKey, key);
    key.catch(() => signingKeys.delete(config.signingKey));
  }
  return key;
}

export async function publicJwks(config: Config): Promise<{ keys: JWK[] }> {
  return { keys: [(await signingKey(config)).publicJwk] };
}

export async function signIdToken(config: Config, payload: JWTPayload, expiresInSec: number): Promise<string> {
  const key = await signingKey(config);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: SIGNING_ALG, kid: key.kid, typ: "JWT" })
    .setIssuer(config.issuer)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSec}s`)
    .sign(key.privateKey);
}

const encoder = new TextEncoder();
const sealKeys = new Map<string, Promise<CryptoKey>>();

function sealKey(config: Config, purpose: SealPurpose): Promise<CryptoKey> {
  const cacheKey = `${purpose}:${config.encryptionSecret}`;
  let key = sealKeys.get(cacheKey);
  if (!key) {
    key = (async () => {
      const ikm = await crypto.subtle.importKey("raw", encoder.encode(config.encryptionSecret), "HKDF", false, [
        "deriveKey",
      ]);
      return crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: encoder.encode("b-cube-idp"), info: encoder.encode(purpose) },
        ikm,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    })();
    sealKeys.set(cacheKey, key);
  }
  return key;
}

/** 용도별 키로 암호화한 JWE(dir, A256GCM)를 만든다. 서버만 열 수 있다. */
export async function seal(config: Config, purpose: SealPurpose, payload: JWTPayload, expiresInSec: number) {
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: purpose })
    .setIssuer(config.issuer)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSec}s`)
    .encrypt(await sealKey(config, purpose));
}

/** seal로 만든 토큰을 연다. 만료, 위조, 다른 용도의 토큰이면 null. */
export async function unseal<T extends JWTPayload>(
  config: Config,
  purpose: SealPurpose,
  token: string | undefined,
): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload, protectedHeader } = await jwtDecrypt(token, await sealKey(config, purpose), {
      issuer: config.issuer,
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    if (protectedHeader.typ !== purpose) return null;
    return payload as T;
  } catch {
    return null;
  }
}
