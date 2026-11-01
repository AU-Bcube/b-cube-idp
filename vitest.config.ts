import { webcrypto } from "node:crypto";
import { defineConfig } from "vitest/config";

// 개인 .env나 운영 값과 무관하게 설정을 고정한다.
// MongoDB는 test/global-setup.ts가 띄우고, 테스트용 SP는 test/setup.ts가 넣는다.
async function testSigningKey(): Promise<string> {
  const { privateKey } = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const { kty, crv, x, y, d } = await webcrypto.subtle.exportKey("jwk", privateKey);
  return JSON.stringify({ kty, crv, x, y, d });
}

export default defineConfig(async () => ({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup.ts"],
    env: {
      ISSUER: "http://localhost:8787",
      DEV_FAKE_LOGIN: "false",
      GOOGLE_CLIENT_ID: "test-google-client-id",
      GOOGLE_CLIENT_SECRET: "test-google-client-secret",
      SIGNING_KEY: await testSigningKey(),
      ENCRYPTION_SECRET: "test-encryption-secret-0123456789abcdefghijkl",
      MHAKSA_INTERVAL_MS: "0",
      ADMIN_EMAILS: "t-admin@ajou.ac.kr",
    },
  },
}));
