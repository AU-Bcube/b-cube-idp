/**
 * RFC 7591 §3 initial access token. 관리자가 발급하고, SP 개발자는 이 토큰으로 /register를 호출한다.
 * 토큰 원문은 발급할 때 한 번만 보여주고 해시만 저장한다.
 */
import { randomToken, sha256Hex } from "./crypto";

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
  db: D1Database,
  opts: { label: string; maxUses: number; ttlDays: number; createdBy: string },
): Promise<{ id: string; token: string }> {
  const id = crypto.randomUUID();
  const token = `iat_${randomToken(32)}`;
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO initial_access_tokens (id, token_sha256, label, max_uses, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, await sha256Hex(token), opts.label, opts.maxUses, opts.createdBy, now, now + opts.ttlDays * 86_400_000)
    .run();
  return { id, token };
}

/**
 * 유효한 토큰이면 사용 횟수를 하나 늘리고 id를 돌려준다. 만료·폐기·횟수 초과면 null.
 * 조건 검사와 증가를 한 UPDATE로 해서 동시에 써도 max_uses를 넘지 않는다.
 */
export async function consumeInitialAccessToken(db: D1Database, token: string): Promise<string | null> {
  const row = await db
    .prepare(
      `UPDATE initial_access_tokens SET uses = uses + 1
       WHERE token_sha256 = ? AND revoked_at IS NULL AND expires_at > ? AND uses < max_uses
       RETURNING id`,
    )
    .bind(await sha256Hex(token), Date.now())
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function listInitialAccessTokens(db: D1Database): Promise<InitialAccessToken[]> {
  const { results } = await db
    .prepare(
      `SELECT id, label, max_uses, uses, created_by, created_at, expires_at, revoked_at
       FROM initial_access_tokens ORDER BY created_at DESC LIMIT 100`,
    )
    .all<InitialAccessToken>();
  return results;
}

export async function revokeInitialAccessToken(db: D1Database, id: string): Promise<boolean> {
  const res = await db
    .prepare(`UPDATE initial_access_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`)
    .bind(Date.now(), id)
    .run();
  return res.meta.changes === 1;
}
