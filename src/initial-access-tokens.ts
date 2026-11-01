/**
 * RFC 7591 §3 initial access token. 관리자가 발급하고, SP 개발자는 이 토큰으로 /register를 호출한다.
 * 토큰 원문은 발급할 때 한 번만 보여주고 해시만 저장한다.
 */
import { randomToken, sha256Hex } from "./crypto";
import type { Collections, InitialAccessTokenDoc } from "./db";

export interface InitialAccessToken {
  id: string;
  label: string;
  max_uses: number;
  uses: number;
  created_by: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

export async function createInitialAccessToken(
  db: Collections,
  opts: { label: string; maxUses: number; ttlDays: number; createdBy: string },
): Promise<{ id: string; token: string }> {
  const id = crypto.randomUUID();
  const token = `iat_${randomToken(32)}`;
  const now = Date.now();
  await db.initialAccessTokens.insertOne({
    _id: id,
    token_sha256: await sha256Hex(token),
    label: opts.label,
    max_uses: opts.maxUses,
    uses: 0,
    created_by: opts.createdBy,
    created_at: now,
    expires_at: now + opts.ttlDays * 86_400_000,
    revoked_at: null,
  });
  return { id, token };
}

/**
 * 유효한 토큰이면 사용 횟수를 하나 늘리고 id를 돌려준다. 만료·폐기·횟수 초과면 null.
 * 조건 검사와 증가를 한 findOneAndUpdate로 해서 동시에 써도 max_uses를 넘지 않는다.
 */
export async function consumeInitialAccessToken(db: Collections, token: string): Promise<string | null> {
  const doc = await db.initialAccessTokens.findOneAndUpdate(
    {
      token_sha256: await sha256Hex(token),
      revoked_at: null,
      expires_at: { $gt: Date.now() },
      $expr: { $lt: ["$uses", "$max_uses"] },
    },
    { $inc: { uses: 1 } },
  );
  return doc?._id ?? null;
}

function toToken({ _id, token_sha256: _hash, ...rest }: InitialAccessTokenDoc): InitialAccessToken {
  return { id: _id, ...rest };
}

export async function listInitialAccessTokens(db: Collections): Promise<InitialAccessToken[]> {
  const docs = await db.initialAccessTokens.find().sort({ created_at: -1 }).limit(100).toArray();
  return docs.map(toToken);
}

export async function revokeInitialAccessToken(db: Collections, id: string): Promise<boolean> {
  const res = await db.initialAccessTokens.updateOne({ _id: id, revoked_at: null }, { $set: { revoked_at: Date.now() } });
  return res.modifiedCount === 1;
}
