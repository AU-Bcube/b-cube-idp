/**
 * SP 저장소. 정적 SP(wrangler.jsonc CLIENTS)와 D1의 동적 SP를 같은 모양으로 다룬다.
 */
import { randomToken, sha256Hex } from "./crypto";
import type { Config } from "./env";
import { isScope, SCOPES, type Scope } from "./scopes";

export type ClientStatus = "pending" | "active" | "suspended";
export type TokenAuthMethod = "client_secret_basic" | "client_secret_post";
export const TOKEN_AUTH_METHODS: readonly TokenAuthMethod[] = ["client_secret_basic", "client_secret_post"];

/** 관리자 승인 없이는 쓸 수 없는 scope. mhaksa 학생 정보를 넘긴다. */
export const SENSITIVE_SCOPES: ReadonlySet<Scope> = new Set(["student", "sohakoe"]);

/** 동적 SP의 client_id 접두사. 정적 SP는 이 접두사를 쓸 수 없다. */
export const DYNAMIC_CLIENT_PREFIX = "dyn-";

export interface Client {
  clientId: string;
  name: string;
  redirectUris: readonly string[];
  scopes: ReadonlySet<Scope>;
  /** client_secret의 SHA-256 hex. 빈 문자열이면 토큰을 받을 수 없다. */
  secretSha256: string;
  status: ClientStatus;
  /** 관리자가 검토했거나 정적 SP이면 true */
  reviewed: boolean;
  source: "static" | "dynamic";
}

export interface DynamicClient extends Client {
  source: "dynamic";
  tokenEndpointAuthMethod: TokenAuthMethod;
  contacts: string[];
  clientUri: string | null;
  registrationTokenSha256: string | null;
  reviewedAt: number | null;
  reviewedBy: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

interface ClientRow {
  client_id: string;
  name: string;
  redirect_uris: string;
  scopes: string;
  token_endpoint_auth_method: string;
  contacts: string;
  client_uri: string | null;
  secret_sha256: string;
  registration_token_sha256: string | null;
  status: ClientStatus;
  reviewed_at: number | null;
  reviewed_by: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

const LOCALHOST_URL = /^http:\/\/localhost(?::\d{1,5})?\//;

/** redirect_uri 규칙: https(또는 http://localhost), fragment 없음. */
export function isAllowedRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || uri.includes("#")) return false;
  return url.protocol === "https:" || LOCALHOST_URL.test(uri);
}

function toClient(row: ClientRow): DynamicClient {
  const scopes = (JSON.parse(row.scopes) as string[]).filter(isScope);
  return {
    clientId: row.client_id,
    name: row.name,
    redirectUris: JSON.parse(row.redirect_uris) as string[],
    scopes: new Set(scopes),
    secretSha256: row.secret_sha256,
    status: row.status,
    reviewed: row.reviewed_at !== null,
    source: "dynamic",
    tokenEndpointAuthMethod: row.token_endpoint_auth_method as TokenAuthMethod,
    contacts: JSON.parse(row.contacts) as string[],
    clientUri: row.client_uri,
    registrationTokenSha256: row.registration_token_sha256,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function staticClients(config: Config): Client[] {
  return [...config.clients.values()].map((c) => ({
    clientId: c.clientId,
    name: c.name,
    redirectUris: c.redirectUris,
    scopes: c.scopes,
    secretSha256: c.secretSha256,
    status: "active",
    reviewed: true,
    source: "static",
  }));
}

export async function findDynamicClient(db: D1Database, clientId: string): Promise<DynamicClient | null> {
  if (!clientId.startsWith(DYNAMIC_CLIENT_PREFIX)) return null;
  const row = await db.prepare(`SELECT * FROM clients WHERE client_id = ?`).bind(clientId).first<ClientRow>();
  return row ? toClient(row) : null;
}

/** 정적 SP를 먼저 찾고, 없으면 D1에서 찾는다. 상태는 호출한 쪽이 확인한다. */
export async function findClient(config: Config, db: D1Database, clientId: string): Promise<Client | null> {
  const s = config.clients.get(clientId);
  if (s) return staticClients(config).find((c) => c.clientId === clientId) ?? null;
  return findDynamicClient(db, clientId);
}

export async function listDynamicClients(db: D1Database): Promise<DynamicClient[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM clients
       ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, created_at DESC`,
    )
    .all<ClientRow>();
  return results.map(toClient);
}

/** SP 메타데이터. RFC 7591 요청과 관리 화면 입력이 이 모양으로 모인다. */
export interface ClientMetadata {
  name: string;
  redirectUris: string[];
  scopes: Scope[];
  tokenEndpointAuthMethod: TokenAuthMethod;
  contacts: string[];
  clientUri: string | null;
}

/** 검증 실패. error는 RFC 7591 §3.2.2 오류 코드다. */
export class ClientMetadataError extends Error {
  override name = "ClientMetadataError";
  constructor(
    readonly error: "invalid_redirect_uri" | "invalid_client_metadata",
    message: string,
  ) {
    super(message);
  }
}

function strings(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new ClientMetadataError("invalid_client_metadata", `${field} must be an array of strings`);
  }
  return value.map((v: string) => v.trim()).filter((v) => v !== "");
}

/**
 * RFC 7591 §2 메타데이터를 검증한다. 모르는 필드는 무시한다.
 * 이 IdP는 authorization_code + code 응답, client_secret 인증만 지원한다.
 */
export function parseClientMetadata(body: unknown): ClientMetadata {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ClientMetadataError("invalid_client_metadata", "body must be a JSON object");
  }
  const m = body as Record<string, unknown>;

  const redirectUris = strings(m.redirect_uris, "redirect_uris");
  if (redirectUris.length === 0 || redirectUris.length > 10) {
    throw new ClientMetadataError("invalid_redirect_uri", "1 to 10 redirect_uris are required");
  }
  const bad = redirectUris.find((u) => !isAllowedRedirectUri(u) || u.length > 2000);
  if (bad) throw new ClientMetadataError("invalid_redirect_uri", `redirect_uri not allowed: ${bad}`);

  const name = typeof m.client_name === "string" ? m.client_name.trim() : "";
  if (!name || name.length > 100) {
    throw new ClientMetadataError("invalid_client_metadata", "client_name (1-100 chars) is required");
  }

  const rawScopes = typeof m.scope === "string" ? m.scope.split(" ").filter(Boolean) : ["openid"];
  const unknown = rawScopes.filter((s) => !isScope(s));
  if (unknown.length > 0) {
    throw new ClientMetadataError("invalid_client_metadata", `unsupported scope: ${unknown.join(" ")}`);
  }
  const scopes = SCOPES.filter((s) => s === "openid" || rawScopes.includes(s));

  const method = m.token_endpoint_auth_method ?? "client_secret_basic";
  if (!TOKEN_AUTH_METHODS.includes(method as TokenAuthMethod)) {
    throw new ClientMetadataError("invalid_client_metadata", "token_endpoint_auth_method not supported");
  }
  const grantTypes = strings(m.grant_types, "grant_types");
  if (grantTypes.some((g) => g !== "authorization_code")) {
    throw new ClientMetadataError("invalid_client_metadata", "only authorization_code grant is supported");
  }
  const responseTypes = strings(m.response_types, "response_types");
  if (responseTypes.some((r) => r !== "code")) {
    throw new ClientMetadataError("invalid_client_metadata", "only code response_type is supported");
  }

  const contacts = strings(m.contacts, "contacts").slice(0, 10);
  let clientUri: string | null = null;
  if (m.client_uri !== undefined) {
    if (typeof m.client_uri !== "string" || !/^https:\/\//.test(m.client_uri) || m.client_uri.length > 2000) {
      throw new ClientMetadataError("invalid_client_metadata", "client_uri must be an https URL");
    }
    clientUri = m.client_uri;
  }
  return { name, redirectUris, scopes, tokenEndpointAuthMethod: method as TokenAuthMethod, contacts, clientUri };
}

/** RFC 7591 §3.2.1 응답에 들어가는 메타데이터 */
export function metadataResponse(client: DynamicClient) {
  return {
    client_id: client.clientId,
    client_id_issued_at: Math.floor(client.createdAt / 1000),
    client_secret_expires_at: 0,
    client_name: client.name,
    redirect_uris: client.redirectUris,
    scope: [...client.scopes].join(" "),
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    contacts: client.contacts,
    ...(client.clientUri ? { client_uri: client.clientUri } : {}),
  };
}

/**
 * 민감한 scope를 요청하면 관리자 승인 전까지 pending이다.
 * 이미 검토한 SP라도 검토 당시보다 넓은 민감 scope를 요청하면 다시 pending이 된다.
 */
export function statusFor(scopes: readonly Scope[], previous?: DynamicClient): ClientStatus {
  if (previous?.status === "suspended") return "suspended";
  const sensitive = scopes.filter((s) => SENSITIVE_SCOPES.has(s));
  if (sensitive.length === 0) return "active";
  if (previous?.reviewed && previous.status === "active" && sensitive.every((s) => previous.scopes.has(s))) {
    return "active";
  }
  return "pending";
}

export interface CreatedClient {
  client: DynamicClient;
  clientSecret: string;
  registrationToken: string | null;
}

export async function createClient(
  db: D1Database,
  meta: ClientMetadata,
  opts: { createdBy: string; withRegistrationToken: boolean; reviewedBy?: string },
): Promise<CreatedClient> {
  const now = Date.now();
  const clientId = `${DYNAMIC_CLIENT_PREFIX}${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const clientSecret = randomToken(32);
  const registrationToken = opts.withRegistrationToken ? randomToken(32) : null;
  // 관리자가 직접 만든 SP는 만든 순간 검토한 것으로 본다.
  const reviewed = opts.reviewedBy !== undefined;
  const status = reviewed ? "active" : statusFor(meta.scopes);
  await db
    .prepare(
      `INSERT INTO clients (client_id, name, redirect_uris, scopes, token_endpoint_auth_method, contacts, client_uri,
         secret_sha256, registration_token_sha256, status, reviewed_at, reviewed_by, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      clientId,
      meta.name,
      JSON.stringify(meta.redirectUris),
      JSON.stringify(meta.scopes),
      meta.tokenEndpointAuthMethod,
      JSON.stringify(meta.contacts),
      meta.clientUri,
      await sha256Hex(clientSecret),
      registrationToken ? await sha256Hex(registrationToken) : null,
      status,
      reviewed ? now : null,
      opts.reviewedBy ?? null,
      opts.createdBy,
      now,
      now,
    )
    .run();
  const client = await findDynamicClient(db, clientId);
  if (!client) throw new Error("client insert failed");
  return { client, clientSecret, registrationToken };
}

/** 메타데이터를 바꾼다. SP가 바꾸면 statusFor 규칙으로 상태를 다시 정하고, 관리자가 바꾸면 상태를 유지한다. */
export async function updateClientMetadata(
  db: D1Database,
  previous: DynamicClient,
  meta: ClientMetadata,
  opts: { byAdmin?: string } = {},
): Promise<DynamicClient> {
  const now = Date.now();
  const status = opts.byAdmin ? previous.status : statusFor(meta.scopes, previous);
  await db
    .prepare(
      `UPDATE clients SET name = ?, redirect_uris = ?, scopes = ?, token_endpoint_auth_method = ?, contacts = ?,
         client_uri = ?, status = ?, updated_at = ? WHERE client_id = ?`,
    )
    .bind(
      meta.name,
      JSON.stringify(meta.redirectUris),
      JSON.stringify(meta.scopes),
      meta.tokenEndpointAuthMethod,
      JSON.stringify(meta.contacts),
      meta.clientUri,
      status,
      now,
      previous.clientId,
    )
    .run();
  return (await findDynamicClient(db, previous.clientId))!;
}

export async function setClientStatus(
  db: D1Database,
  clientId: string,
  status: ClientStatus,
  reviewer?: string,
): Promise<void> {
  const now = Date.now();
  if (reviewer) {
    await db
      .prepare(`UPDATE clients SET status = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE client_id = ?`)
      .bind(status, now, reviewer, now, clientId)
      .run();
  } else {
    await db.prepare(`UPDATE clients SET status = ?, updated_at = ? WHERE client_id = ?`).bind(status, now, clientId).run();
  }
}

export async function rotateClientSecret(db: D1Database, clientId: string): Promise<string> {
  const secret = randomToken(32);
  await db
    .prepare(`UPDATE clients SET secret_sha256 = ?, updated_at = ? WHERE client_id = ?`)
    .bind(await sha256Hex(secret), Date.now(), clientId)
    .run();
  return secret;
}

export async function deleteClient(db: D1Database, clientId: string): Promise<void> {
  await db.prepare(`DELETE FROM clients WHERE client_id = ?`).bind(clientId).run();
}
