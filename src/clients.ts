/**
 * SP 저장소. 모든 SP는 MongoDB에 있고, 관리 화면이나 동적 등록(RFC 7591)으로 만든다.
 */
import { randomToken, sha256Hex } from "./crypto";
import type { ClientDoc, Collections } from "./db";
import { isScope, SCOPES, type Scope } from "./scopes";

export type ClientStatus = "pending" | "active" | "suspended";
export type TokenAuthMethod = "client_secret_basic" | "client_secret_post";
export const TOKEN_AUTH_METHODS: readonly TokenAuthMethod[] = ["client_secret_basic", "client_secret_post"];

/** 관리자 승인 없이는 쓸 수 없는 scope. mhaksa 학생 정보를 넘긴다. */
export const SENSITIVE_SCOPES: ReadonlySet<Scope> = new Set(["student", "sohakoe"]);

/** 새로 만드는 SP의 client_id 접두사 */
export const CLIENT_ID_PREFIX = "dyn-";

export interface Client {
  clientId: string;
  name: string;
  redirectUris: readonly string[];
  scopes: ReadonlySet<Scope>;
  /** client_secret의 SHA-256 hex */
  secretSha256: string;
  status: ClientStatus;
  /** 관리자가 검토했으면 true */
  reviewed: boolean;
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

function toClient(doc: ClientDoc): Client {
  return {
    clientId: doc._id,
    name: doc.name,
    redirectUris: doc.redirect_uris,
    scopes: new Set(doc.scopes.filter(isScope)),
    secretSha256: doc.secret_sha256,
    status: doc.status,
    reviewed: doc.reviewed_at !== null,
    tokenEndpointAuthMethod: doc.token_endpoint_auth_method,
    contacts: doc.contacts,
    clientUri: doc.client_uri,
    registrationTokenSha256: doc.registration_token_sha256,
    reviewedAt: doc.reviewed_at,
    reviewedBy: doc.reviewed_by,
    createdBy: doc.created_by,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
  };
}

/** 상태는 호출한 쪽이 확인한다. */
export async function findClient(db: Collections, clientId: string): Promise<Client | null> {
  const doc = await db.clients.findOne({ _id: clientId });
  return doc ? toClient(doc) : null;
}

const STATUS_ORDER: Record<ClientStatus, number> = { pending: 0, active: 1, suspended: 2 };

/** 승인 대기, 활성, 중지 순서이고 같은 상태 안에서는 최근에 만든 것이 먼저다. */
export async function listClients(db: Collections): Promise<Client[]> {
  const docs = await db.clients.find().sort({ created_at: -1 }).toArray();
  return docs.map(toClient).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
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
export function metadataResponse(client: Client) {
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
export function statusFor(scopes: readonly Scope[], previous?: Client): ClientStatus {
  if (previous?.status === "suspended") return "suspended";
  const sensitive = scopes.filter((s) => SENSITIVE_SCOPES.has(s));
  if (sensitive.length === 0) return "active";
  if (previous?.reviewed && previous.status === "active" && sensitive.every((s) => previous.scopes.has(s))) {
    return "active";
  }
  return "pending";
}

export interface CreatedClient {
  client: Client;
  clientSecret: string;
  registrationToken: string | null;
}

export async function createClient(
  db: Collections,
  meta: ClientMetadata,
  opts: { createdBy: string; withRegistrationToken: boolean; reviewedBy?: string },
): Promise<CreatedClient> {
  const now = Date.now();
  const clientId = `${CLIENT_ID_PREFIX}${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const clientSecret = randomToken(32);
  const registrationToken = opts.withRegistrationToken ? randomToken(32) : null;
  // 관리자가 직접 만든 SP는 만든 순간 검토한 것으로 본다.
  const reviewed = opts.reviewedBy !== undefined;
  const doc: ClientDoc = {
    _id: clientId,
    name: meta.name,
    redirect_uris: meta.redirectUris,
    scopes: meta.scopes,
    token_endpoint_auth_method: meta.tokenEndpointAuthMethod,
    contacts: meta.contacts,
    client_uri: meta.clientUri,
    secret_sha256: await sha256Hex(clientSecret),
    registration_token_sha256: registrationToken ? await sha256Hex(registrationToken) : null,
    status: reviewed ? "active" : statusFor(meta.scopes),
    reviewed_at: reviewed ? now : null,
    reviewed_by: opts.reviewedBy ?? null,
    created_by: opts.createdBy,
    created_at: now,
    updated_at: now,
  };
  await db.clients.insertOne(doc);
  return { client: toClient(doc), clientSecret, registrationToken };
}

/** 메타데이터를 바꾼다. SP가 바꾸면 statusFor 규칙으로 상태를 다시 정하고, 관리자가 바꾸면 상태를 유지한다. */
export async function updateClientMetadata(
  db: Collections,
  previous: Client,
  meta: ClientMetadata,
  opts: { byAdmin?: string } = {},
): Promise<Client> {
  const doc = await db.clients.findOneAndUpdate(
    { _id: previous.clientId },
    {
      $set: {
        name: meta.name,
        redirect_uris: meta.redirectUris,
        scopes: meta.scopes,
        token_endpoint_auth_method: meta.tokenEndpointAuthMethod,
        contacts: meta.contacts,
        client_uri: meta.clientUri,
        status: opts.byAdmin ? previous.status : statusFor(meta.scopes, previous),
        updated_at: Date.now(),
      },
    },
    { returnDocument: "after" },
  );
  if (!doc) throw new Error("client update failed");
  return toClient(doc);
}

export async function setClientStatus(
  db: Collections,
  clientId: string,
  status: ClientStatus,
  reviewer?: string,
): Promise<void> {
  const now = Date.now();
  await db.clients.updateOne(
    { _id: clientId },
    { $set: { status, updated_at: now, ...(reviewer ? { reviewed_at: now, reviewed_by: reviewer } : {}) } },
  );
}

export async function rotateClientSecret(db: Collections, clientId: string): Promise<string> {
  const secret = randomToken(32);
  await db.clients.updateOne({ _id: clientId }, { $set: { secret_sha256: await sha256Hex(secret), updated_at: Date.now() } });
  return secret;
}

export async function deleteClient(db: Collections, clientId: string): Promise<void> {
  await db.clients.deleteOne({ _id: clientId });
}
