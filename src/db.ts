/**
 * MongoDB 연결과 컬렉션.
 *
 * - 서버리스 함수 인스턴스가 살아 있는 동안 연결을 재사용한다.
 * - 인덱스는 연결할 때 만든다. 이미 있으면 아무 일도 하지 않으므로 별도 마이그레이션이 없다.
 * - 사용자 정보와 학생 정보는 저장하지 않는다. SP 등록 정보, 등록 토큰 해시, 감사 로그, 사용한 인가 코드 ID만 남는다.
 */
import { MongoClient, MongoServerError, type Collection, type Db } from "mongodb";
import type { ClientStatus, TokenAuthMethod } from "./clients";
import type { Config } from "./env";

/** 동적으로 등록한 SP(RFC 7591)와 관리 화면에서 만든 SP. 비밀값은 SHA-256 해시만 저장한다. */
export interface ClientDoc {
  _id: string;
  name: string;
  redirect_uris: string[];
  /** SP가 요청한 scope */
  scopes: string[];
  token_endpoint_auth_method: TokenAuthMethod;
  contacts: string[];
  client_uri: string | null;
  secret_sha256: string;
  /** RFC 7592 관리 토큰. 관리 화면에서 만든 SP는 null */
  registration_token_sha256: string | null;
  status: ClientStatus;
  /** 관리자가 검토(승인)한 시각. null이면 동의 화면에 미검토 표시 */
  reviewed_at: number | null;
  reviewed_by: string | null;
  /** 'admin:<email>' 또는 'iat:<토큰 id>' */
  created_by: string;
  created_at: number;
  updated_at: number;
}

/** RFC 7591 §3 initial access token. 이 토큰이 있어야 /register를 쓸 수 있다. */
export interface InitialAccessTokenDoc {
  _id: string;
  token_sha256: string;
  label: string;
  max_uses: number;
  uses: number;
  created_by: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

export interface AuditLogDoc {
  at: number;
  actor: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
}

/** 인가 코드는 암호화된 자기 완결형 토큰이다. 한 번만 쓰이도록 사용한 코드의 jti만 기록한다. */
export interface UsedCodeDoc {
  _id: string;
  /** TTL 인덱스가 이 시각이 지난 문서를 지운다. */
  expires_at: Date;
}

export interface Collections {
  clients: Collection<ClientDoc>;
  initialAccessTokens: Collection<InitialAccessTokenDoc>;
  auditLogs: Collection<AuditLogDoc>;
  usedCodes: Collection<UsedCodeDoc>;
}

export function collections(db: Db): Collections {
  return {
    clients: db.collection<ClientDoc>("clients"),
    initialAccessTokens: db.collection<InitialAccessTokenDoc>("initial_access_tokens"),
    auditLogs: db.collection<AuditLogDoc>("audit_logs"),
    usedCodes: db.collection<UsedCodeDoc>("used_codes"),
  };
}

async function ensureIndexes(db: Db): Promise<void> {
  const c = collections(db);
  await Promise.all([
    c.initialAccessTokens.createIndex({ token_sha256: 1 }, { unique: true }),
    c.auditLogs.createIndex({ at: -1 }),
    // 만료된 코드는 어차피 복호화 단계에서 거절되므로 기록을 지워도 된다.
    c.usedCodes.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

const connections = new Map<string, Promise<Collections>>();

/** 연결 문자열과 DB 이름 단위로 연결을 캐시한다. 실패하면 다음 요청에서 다시 연결한다. */
export function getCollections(config: Pick<Config, "dbConnectionString" | "dbName">): Promise<Collections> {
  const key = `${config.dbConnectionString}\n${config.dbName}`;
  let conn = connections.get(key);
  if (!conn) {
    conn = (async () => {
      const client = await new MongoClient(config.dbConnectionString, { serverSelectionTimeoutMS: 5000 }).connect();
      const db = client.db(config.dbName);
      await ensureIndexes(db);
      return collections(db);
    })();
    conn.catch(() => connections.delete(key));
    connections.set(key, conn);
  }
  return conn;
}

/** 고유 키 충돌(E11000) */
export function isDuplicateKey(err: unknown): boolean {
  return err instanceof MongoServerError && err.code === 11000;
}
