import { createHash, webcrypto } from "node:crypto";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// 테스트는 workerd 안에서 실행된다. 개인 .dev.vars나 운영 값과 무관하게 설정을 고정한다.
// test/helpers.ts의 CLIENT_SECRET과 같은 값
const TEST_CLIENT_SECRET = "test-client-secret-0123456789abcdefghijklmnop";

async function testSigningKey(): Promise<string> {
  const { privateKey } = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const { kty, crv, x, y, d } = await webcrypto.subtle.exportKey("jwk", privateKey);
  return JSON.stringify({ kty, crv, x, y, d });
}

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ISSUER: "http://localhost:8787",
          DEV_FAKE_LOGIN: "false",
          GOOGLE_CLIENT_ID: "test-google-client-id",
          GOOGLE_CLIENT_SECRET: "test-google-client-secret",
          SIGNING_KEY: await testSigningKey(),
          ENCRYPTION_SECRET: "test-encryption-secret-0123456789abcdefghijkl",
          MHAKSA_INTERVAL_MS: "0",
          ADMIN_EMAILS: "t-admin@ajou.ac.kr",
          CLIENTS: JSON.stringify([
            {
              client_id: "test-sp",
              name: "테스트 SP",
              redirect_uris: ["https://sp.example.com/auth/callback"],
              scopes: ["openid", "email", "profile", "student", "sohakoe"],
              client_secret_sha256: createHash("sha256").update(TEST_CLIENT_SECRET).digest("hex"),
            },
            {
              client_id: "email-only",
              name: "이메일만",
              redirect_uris: ["https://other.example.com/cb"],
              scopes: ["openid", "email"],
              client_secret_sha256: createHash("sha256").update("other-secret").digest("hex"),
            },
          ]),
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
        },
      },
    })),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
