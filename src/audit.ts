/** 관리 작업과 동적 등록 기록. 사용자 로그인은 기록하지 않는다(사용자 정보를 저장하지 않는다). */
export type AuditAction =
  | "client.create"
  | "client.register"
  | "client.update"
  | "client.approve"
  | "client.suspend"
  | "client.resume"
  | "client.rotate_secret"
  | "client.delete"
  | "iat.create"
  | "iat.revoke";

export interface AuditLog {
  id: number;
  at: number;
  actor: string;
  action: AuditAction;
  target: string | null;
  detail: string | null;
}

export async function writeAudit(
  db: D1Database,
  entry: { actor: string; action: AuditAction; target?: string; detail?: Record<string, unknown> },
): Promise<void> {
  await db
    .prepare(`INSERT INTO audit_logs (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)`)
    .bind(Date.now(), entry.actor, entry.action, entry.target ?? null, entry.detail ? JSON.stringify(entry.detail) : null)
    .run();
}

export async function recentAudit(db: D1Database, limit = 200): Promise<AuditLog[]> {
  const { results } = await db.prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?`).bind(limit).all<AuditLog>();
  return results;
}
