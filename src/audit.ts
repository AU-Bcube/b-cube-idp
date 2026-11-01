import type { Collections } from "./db";

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
  id: string;
  at: number;
  actor: string;
  action: AuditAction;
  target: string | null;
  detail: string | null;
}

export async function writeAudit(
  db: Collections,
  entry: { actor: string; action: AuditAction; target?: string; detail?: Record<string, unknown> },
): Promise<void> {
  await db.auditLogs.insertOne({
    at: Date.now(),
    actor: entry.actor,
    action: entry.action,
    target: entry.target ?? null,
    detail: entry.detail ?? null,
  });
}

export async function recentAudit(db: Collections, limit = 200): Promise<AuditLog[]> {
  const docs = await db.auditLogs.find().sort({ at: -1, _id: -1 }).limit(limit).toArray();
  return docs.map((d) => ({
    id: d._id.toHexString(),
    at: d.at,
    actor: d.actor,
    action: d.action as AuditAction,
    target: d.target,
    detail: d.detail ? JSON.stringify(d.detail) : null,
  }));
}
