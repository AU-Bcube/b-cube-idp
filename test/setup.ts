import { applyD1Migrations, env } from "cloudflare:test";
import { sha256Hex } from "../src/crypto";
import { CLIENT_ID, CLIENT_SECRET, OTHER_CLIENT_ID, OTHER_CLIENT_SECRET, OTHER_REDIRECT_URI, REDIRECT_URI } from "./helpers";

// 이미 적용된 마이그레이션은 건너뛰므로 파일마다 실행해도 된다.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// 테스트용 SP. 관리자가 검토한 활성 SP로 둔다.
const seed = env.DB.prepare(
  `INSERT OR IGNORE INTO clients (client_id, name, redirect_uris, scopes, token_endpoint_auth_method,
     secret_sha256, status, reviewed_at, reviewed_by, created_by, created_at, updated_at)
   VALUES (?, ?, ?, ?, 'client_secret_basic', ?, 'active', 0, 'test', 'test', 0, 0)`,
);
await env.DB.batch([
  seed.bind(
    CLIENT_ID,
    "테스트 SP",
    JSON.stringify([REDIRECT_URI]),
    JSON.stringify(["openid", "email", "profile", "student", "sohakoe"]),
    await sha256Hex(CLIENT_SECRET),
  ),
  seed.bind(
    OTHER_CLIENT_ID,
    "이메일만",
    JSON.stringify([OTHER_REDIRECT_URI]),
    JSON.stringify(["openid", "email"]),
    await sha256Hex(OTHER_CLIENT_SECRET),
  ),
]);
