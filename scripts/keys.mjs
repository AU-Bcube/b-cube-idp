// SIGNING_KEY(ES256 개인 JWK)와 ENCRYPTION_SECRET을 새로 만들어 출력한다.
// 출력값은 비밀이다. `wrangler secret put`이나 .dev.vars에만 넣고 커밋하지 않는다.
import { webcrypto as crypto } from "node:crypto";

const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
const jwk = await crypto.subtle.exportKey("jwk", privateKey);
const signingKey = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d });
const encryptionSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

console.log(`SIGNING_KEY=${signingKey}`);
console.log(`ENCRYPTION_SECRET=${encryptionSecret}`);
