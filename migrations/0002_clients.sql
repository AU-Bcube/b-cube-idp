-- 동적으로 등록한 SP (RFC 7591) 와 관리 화면에서 만든 SP.
-- wrangler.jsonc의 CLIENTS(정적 SP)는 여기에 들어가지 않는다.
-- 비밀값은 SHA-256 해시만 저장한다.
CREATE TABLE clients (
  client_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,            -- JSON 배열
  scopes TEXT NOT NULL,                   -- JSON 배열. SP가 요청한 scope
  token_endpoint_auth_method TEXT NOT NULL,
  contacts TEXT NOT NULL DEFAULT '[]',    -- JSON 배열
  client_uri TEXT,
  secret_sha256 TEXT NOT NULL,
  -- RFC 7592 관리 토큰. 관리 화면에서 만든 SP는 null
  registration_token_sha256 TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'suspended')),
  -- 관리자가 검토(승인)한 시각. null이면 동의 화면에 미검토 표시
  reviewed_at INTEGER,
  reviewed_by TEXT,
  created_by TEXT NOT NULL,               -- 'admin:<email>' 또는 'iat:<토큰 id>'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- RFC 7591 §3 initial access token. 이 토큰이 있어야 /register를 쓸 수 있다.
CREATE TABLE initial_access_tokens (
  id TEXT PRIMARY KEY,
  token_sha256 TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  max_uses INTEGER NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT                             -- JSON
);

CREATE INDEX audit_logs_at ON audit_logs (at);
