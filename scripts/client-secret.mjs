// SP용 client_secret과 그 SHA-256 해시를 만든다.
// client_secret은 SP의 비밀값으로만 전달하고, 해시는 wrangler.jsonc의 CLIENTS[].client_secret_sha256에 넣는다.
import { createHash, randomBytes } from "node:crypto";

const secret = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(secret).digest("hex");

console.log(`client_secret=${secret}`);
console.log(`client_secret_sha256=${hash}`);
