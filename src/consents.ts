/**
 * 기억한 동의. 동의한 날부터 1년 동안 같은 SP가 같거나 좁은 scope를 요청하면 동의 화면을 생략한다.
 * 누가(sub) 어느 SP에 어떤 scope로 동의했는지만 저장한다.
 */
import type { Collections, ConsentDoc } from "./db";
import { isScope, type Scope } from "./scopes";

export const CONSENT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export interface Consent {
  scopes: Scope[];
  expiresAt: number;
}

export interface StoredConsent extends Consent {
  clientId: string;
  grantedAt: number;
}

function toConsent(doc: ConsentDoc): StoredConsent {
  return {
    clientId: doc.client_id,
    scopes: doc.scopes.filter(isScope),
    grantedAt: doc.granted_at,
    expiresAt: doc.expires_at.getTime(),
  };
}

/** 만료되지 않은 동의. 없으면 null. TTL 인덱스는 주기적으로 지우므로 기한을 직접 확인한다. */
export async function findConsent(db: Collections, sub: string, clientId: string): Promise<Consent | null> {
  const doc = await db.consents.findOne({ sub, client_id: clientId, expires_at: { $gt: new Date() } });
  return doc ? toConsent(doc) : null;
}

/** 사용자의 만료되지 않은 동의. 최근에 동의한 것부터 */
export async function listConsents(db: Collections, sub: string): Promise<StoredConsent[]> {
  const docs = await db.consents.find({ sub, expires_at: { $gt: new Date() } }).sort({ granted_at: -1 }).toArray();
  return docs.map(toConsent);
}

export function consentCovers(consent: Consent | null, scopes: readonly Scope[]): boolean {
  return consent !== null && scopes.every((s) => consent.scopes.includes(s));
}

/** 동의를 저장한다. 이전에 동의한 scope는 유지하고, 기간은 지금부터 다시 1년이다. */
export async function saveConsent(db: Collections, sub: string, clientId: string, scopes: readonly Scope[]): Promise<number> {
  const previous = await findConsent(db, sub, clientId);
  const merged = [...new Set([...(previous?.scopes ?? []), ...scopes])];
  const now = Date.now();
  const expiresAt = now + CONSENT_TTL_MS;
  await db.consents.updateOne(
    { sub, client_id: clientId },
    { $set: { scopes: merged, granted_at: now, expires_at: new Date(expiresAt) } },
    { upsert: true },
  );
  return expiresAt;
}

export async function deleteConsent(db: Collections, sub: string, clientId: string): Promise<void> {
  await db.consents.deleteOne({ sub, client_id: clientId });
}
