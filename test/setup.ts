import { inject } from "vitest";
import { sha256Hex } from "../src/crypto";
import type { ClientDoc } from "../src/db";
import {
  CLIENT_ID,
  CLIENT_SECRET,
  OTHER_CLIENT_ID,
  OTHER_CLIENT_SECRET,
  OTHER_REDIRECT_URI,
  REDIRECT_URI,
  testDb,
} from "./helpers";

// test/global-setup.ts가 띄운 MongoDB를 쓴다. 테스트 파일마다 DB를 따로 둬 서로 영향을 주지 않는다.
process.env.DB_CONNECTION_STRING = inject("mongoUri");
process.env.DB_NAME = `test-${crypto.randomUUID()}`;

// 테스트용 SP. 관리자가 검토한 활성 SP로 둔다.
async function seed(clientId: string, name: string, redirectUri: string, scopes: string[], secret: string): Promise<ClientDoc> {
  return {
    _id: clientId,
    name,
    redirect_uris: [redirectUri],
    scopes,
    token_endpoint_auth_method: "client_secret_basic",
    contacts: [],
    client_uri: null,
    secret_sha256: await sha256Hex(secret),
    registration_token_sha256: null,
    status: "active",
    reviewed_at: 0,
    reviewed_by: "test",
    created_by: "test",
    created_at: 0,
    updated_at: 0,
  };
}

await (await testDb()).clients.insertMany([
  await seed(CLIENT_ID, "테스트 SP", REDIRECT_URI, ["openid", "email", "profile", "student", "sohakoe"], CLIENT_SECRET),
  await seed(OTHER_CLIENT_ID, "이메일만", OTHER_REDIRECT_URI, ["openid", "email"], OTHER_CLIENT_SECRET),
]);
