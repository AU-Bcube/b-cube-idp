/**
 * 관리 화면. 서버에서 렌더링하고 스크립트는 쓰지 않는다. 모든 쓰기는 CSRF 토큰이 든 POST 폼이다.
 */
import type { Child, FC } from "hono/jsx";
import type { AuditLog } from "./audit";
import { SENSITIVE_SCOPES, TOKEN_AUTH_METHODS, type Client, type DynamicClient } from "./clients";
import type { InitialAccessToken } from "./initial-access-tokens";
import { SCOPES } from "./scopes";

const STYLE = `
:root { color-scheme: light dark; --bg: #f4f4f4; --card: #fff; --fg: #161616; --muted: #525252; --line: #e0e0e0;
  --primary: #0f62fe; --primary-fg: #fff; --danger: #da1e28; --warn: #8e6a00; --ok: #198038; --code: #f2f4f8; }
@media (prefers-color-scheme: dark) { :root { --bg: #161616; --card: #262626; --fg: #f4f4f4; --muted: #c6c6c6;
  --line: #393939; --primary: #4589ff; --danger: #ff8389; --warn: #f1c21b; --ok: #42be65; --code: #393939; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 14px/1.55 system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
header { background: var(--card); border-bottom: 1px solid var(--line); }
.bar { max-width: 1040px; margin: 0 auto; padding: 0 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; min-height: 52px; }
.bar strong { margin-right: 8px; }
.bar a { color: var(--fg); text-decoration: none; padding: 4px 0; }
.bar a:hover { color: var(--primary); }
.bar .me { margin-left: auto; color: var(--muted); display: flex; gap: 8px; align-items: center; }
main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 20px; margin: 0 0 16px; }
h2 { font-size: 16px; margin: 28px 0 10px; }
p { margin: 0 0 12px; color: var(--muted); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.table-wrap { overflow-x: auto; background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
a { color: var(--primary); }
code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; overflow-wrap: anywhere; }
.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; border: 1px solid currentColor; white-space: nowrap; }
.s-active { color: var(--ok); } .s-pending { color: var(--warn); } .s-suspended { color: var(--danger); } .s-static { color: var(--muted); }
.sensitive { color: var(--warn); font-weight: 600; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
label { display: block; font-weight: 600; margin: 12px 0 4px; }
.hint { font-weight: 400; color: var(--muted); font-size: 13px; }
input[type=text], input[type=number], textarea, select { width: 100%; padding: 8px 10px; border: 1px solid var(--line);
  border-radius: 6px; background: transparent; color: var(--fg); font: inherit; }
textarea { min-height: 76px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.checks { display: flex; flex-wrap: wrap; gap: 6px 18px; }
.checks label { display: flex; gap: 6px; align-items: center; font-weight: 400; margin: 0; }
.row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
button { font: inherit; padding: 8px 14px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: var(--fg); cursor: pointer; }
button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-fg); }
button.danger { color: var(--danger); border-color: var(--danger); }
form.inline { display: inline; }
.secret { background: var(--code); border-radius: 6px; padding: 10px 12px; margin: 4px 0 12px; user-select: all; }
.notice { border-left: 3px solid var(--warn); padding: 8px 12px; background: var(--card); margin-bottom: 16px; }
`;

function fmt(ms: number | null): string {
  if (ms === null) return "-";
  // 관리자는 한국 시간으로 본다.
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

export const AdminLayout: FC<{ title: string; email: string; csrf: string; children: Child }> = ({
  title,
  email,
  csrf,
  children,
}) => (
  <html lang="ko">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex" />
      <title>{`${title} · B-CUBE IdP 관리`}</title>
      <style>{STYLE}</style>
    </head>
    <body>
      <header>
        <nav class="bar">
          <strong>B-CUBE IdP 관리</strong>
          <a href="/admin">SP 목록</a>
          <a href="/admin/clients/new">SP 추가</a>
          <a href="/admin/tokens">등록 토큰</a>
          <a href="/admin/audit">감사 로그</a>
          <span class="me">
            {email}
            <form class="inline" method="post" action="/admin/logout">
              <input type="hidden" name="csrf" value={csrf} />
              <button type="submit">로그아웃</button>
            </form>
          </span>
        </nav>
      </header>
      <main>{children}</main>
    </body>
  </html>
);

const Status: FC<{ client: Client }> = ({ client }) => {
  if (client.source === "static") return <span class="badge s-static">정적</span>;
  const label = { pending: "승인 대기", active: "활성", suspended: "중지" }[client.status];
  return <span class={`badge s-${client.status}`}>{label}</span>;
};

const Scopes: FC<{ scopes: Iterable<string> }> = ({ scopes }) => (
  <span class="mono">
    {[...scopes].map((s, i) => (
      <>
        {i > 0 ? " " : ""}
        <span class={SENSITIVE_SCOPES.has(s as never) ? "sensitive" : ""}>{s}</span>
      </>
    ))}
  </span>
);

export const ClientListPage: FC<{ statics: Client[]; dynamics: DynamicClient[] }> = ({ statics, dynamics }) => {
  const pending = dynamics.filter((c) => c.status === "pending").length;
  const rows = [...dynamics, ...statics];
  return (
    <>
      <h1>SP 목록</h1>
      {pending > 0 ? <div class="notice">승인을 기다리는 SP가 {pending}개 있습니다.</div> : null}
      <p>
        정적 SP는 <code>wrangler.jsonc</code>의 <code>CLIENTS</code>에서 관리하므로 여기서 바꿀 수 없습니다. 주황색
        scope는 학생 정보를 넘기는 scope입니다.
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>상태</th>
              <th>이름</th>
              <th>client_id</th>
              <th>scope</th>
              <th>redirect_uri</th>
              <th>만든 곳</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colspan={6}>등록된 SP가 없습니다.</td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr>
                  <td>
                    <Status client={c} />
                  </td>
                  <td>
                    <a href={`/admin/clients/${encodeURIComponent(c.clientId)}`}>{c.name}</a>
                    {c.source === "dynamic" && !c.reviewed ? <div class="hint">미검토</div> : null}
                  </td>
                  <td class="mono">{c.clientId}</td>
                  <td>
                    <Scopes scopes={c.scopes} />
                  </td>
                  <td class="mono">
                    {c.redirectUris.map((u) => (
                      <div>{u}</div>
                    ))}
                  </td>
                  <td class="mono">{c.source === "dynamic" ? (c as DynamicClient).createdBy : "wrangler.jsonc"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
};

export interface ClientFormValues {
  name: string;
  redirectUris: string;
  scopes: ReadonlySet<string>;
  tokenEndpointAuthMethod: string;
  contacts: string;
  clientUri: string;
}

export const ClientForm: FC<{ action: string; csrf: string; values: ClientFormValues; submit: string; error?: string }> = ({
  action,
  csrf,
  values,
  submit,
  error,
}) => (
  <form method="post" action={action} class="card">
    {error ? <div class="notice">{error}</div> : null}
    <input type="hidden" name="csrf" value={csrf} />
    <label for="client_name">이름</label>
    <span class="hint">동의 화면에 그대로 나옵니다.</span>
    <input id="client_name" type="text" name="client_name" value={values.name} required maxlength={100} />
    <label for="redirect_uris">
      redirect_uri <span class="hint">한 줄에 하나. https만(localhost는 http 허용)</span>
    </label>
    <textarea id="redirect_uris" name="redirect_uris" required>
      {values.redirectUris}
    </textarea>
    <label>scope</label>
    <div class="checks">
      {SCOPES.map((s) => (
        <label>
          <input
            type="checkbox"
            name="scope"
            value={s}
            checked={s === "openid" || values.scopes.has(s)}
            disabled={s === "openid"}
          />
          <span class={SENSITIVE_SCOPES.has(s) ? "sensitive" : ""}>{s}</span>
        </label>
      ))}
    </div>
    <label for="token_endpoint_auth_method">토큰 엔드포인트 인증</label>
    <select id="token_endpoint_auth_method" name="token_endpoint_auth_method">
      {TOKEN_AUTH_METHODS.map((m) => (
        <option value={m} selected={values.tokenEndpointAuthMethod === m}>
          {m}
        </option>
      ))}
    </select>
    <label for="contacts">
      담당자 연락처 <span class="hint">한 줄에 하나(선택)</span>
    </label>
    <textarea id="contacts" name="contacts">
      {values.contacts}
    </textarea>
    <label for="client_uri">
      서비스 주소 <span class="hint">https(선택)</span>
    </label>
    <input id="client_uri" type="text" name="client_uri" value={values.clientUri} />
    <div class="row">
      <button type="submit" class="primary">
        {submit}
      </button>
    </div>
  </form>
);

const ActionButton: FC<{ action: string; csrf: string; label: string; kind?: string }> = ({ action, csrf, label, kind }) => (
  <form class="inline" method="post" action={action}>
    <input type="hidden" name="csrf" value={csrf} />
    <button type="submit" class={kind ?? ""}>
      {label}
    </button>
  </form>
);

export const ClientDetailPage: FC<{ client: Client; csrf: string; form?: Child }> = ({ client, csrf, form }) => {
  const base = `/admin/clients/${encodeURIComponent(client.clientId)}`;
  const dyn = client.source === "dynamic" ? (client as DynamicClient) : null;
  return (
    <>
      <h1>
        {client.name} <Status client={client} />
      </h1>
      <div class="card">
        <dl>
          <dt>client_id</dt>
          <dd class="mono">{client.clientId}</dd>
          <dt>scope</dt>
          <dd>
            <Scopes scopes={client.scopes} />
          </dd>
          <dt>redirect_uri</dt>
          <dd class="mono">
            {client.redirectUris.map((u) => (
              <div>{u}</div>
            ))}
          </dd>
          {dyn ? (
            <>
              <dt>담당자</dt>
              <dd>{dyn.contacts.join(", ") || "-"}</dd>
              <dt>서비스 주소</dt>
              <dd class="mono">{dyn.clientUri ?? "-"}</dd>
              <dt>만든 곳</dt>
              <dd class="mono">{dyn.createdBy}</dd>
              <dt>RFC 7592 관리</dt>
              <dd>{dyn.registrationTokenSha256 ? "SP가 registration_access_token으로 직접 관리" : "관리 화면에서만"}</dd>
              <dt>검토</dt>
              <dd>{dyn.reviewedAt ? `${fmt(dyn.reviewedAt)} · ${dyn.reviewedBy}` : "미검토"}</dd>
              <dt>만든 시각 / 수정</dt>
              <dd>
                {fmt(dyn.createdAt)} / {fmt(dyn.updatedAt)}
              </dd>
            </>
          ) : (
            <>
              <dt>관리</dt>
              <dd>
                <code>wrangler.jsonc</code>의 <code>CLIENTS</code>를 고치고 배포해야 바뀝니다.
              </dd>
            </>
          )}
        </dl>
        {dyn ? (
          <div class="row">
            {dyn.status === "pending" || !dyn.reviewed ? (
              <ActionButton action={`${base}/approve`} csrf={csrf} label="승인" kind="primary" />
            ) : null}
            {dyn.status === "suspended" ? (
              <ActionButton action={`${base}/resume`} csrf={csrf} label="재개" />
            ) : (
              <ActionButton action={`${base}/suspend`} csrf={csrf} label="중지" kind="danger" />
            )}
            <ActionButton action={`${base}/rotate-secret`} csrf={csrf} label="client_secret 재발급" />
            <ActionButton action={`${base}/delete`} csrf={csrf} label="삭제" kind="danger" />
          </div>
        ) : null}
      </div>
      {dyn ? (
        <>
          <h2>정보 수정</h2>
          <p>관리자가 고치면 승인 상태를 유지합니다. SP가 RFC 7592로 민감한 scope를 늘리면 다시 승인 대기가 됩니다.</p>
          {form}
        </>
      ) : null}
    </>
  );
};

export const SecretShownPage: FC<{ title: string; items: [string, string][]; next: string; note?: string }> = ({
  title,
  items,
  next,
  note,
}) => (
  <>
    <h1>{title}</h1>
    <div class="notice">아래 값은 지금 한 번만 보여줍니다. IdP에는 해시만 남습니다. SP 담당자에게 안전한 경로로 전달하세요.</div>
    <div class="card">
      {items.map(([k, v]) => (
        <>
          <div class="hint">{k}</div>
          <div class="secret mono">{v}</div>
        </>
      ))}
      {note ? <p>{note}</p> : null}
      <a href={next}>계속</a>
    </div>
  </>
);

export const TokensPage: FC<{ tokens: InitialAccessToken[]; csrf: string; issuer: string }> = ({ tokens, csrf, issuer }) => {
  const now = Date.now();
  return (
    <>
      <h1>등록 토큰 (initial access token)</h1>
      <p>
        SP 개발자가 <code>POST {issuer}/register</code>로 직접 SP를 등록할 때 쓰는 토큰입니다(RFC 7591). student,
        sohakoe scope를 요청한 SP는 승인할 때까지 쓸 수 없습니다.
      </p>
      <form method="post" action="/admin/tokens" class="card">
        <input type="hidden" name="csrf" value={csrf} />
        <label for="label">
          용도 <span class="hint">누구에게 주는지</span>
        </label>
        <input id="label" type="text" name="label" required maxlength={100} />
        <label for="max_uses">사용 횟수</label>
        <input id="max_uses" type="number" name="max_uses" value="1" min={1} max={100} required />
        <label for="ttl_days">유효 기간(일)</label>
        <input id="ttl_days" type="number" name="ttl_days" value="7" min={1} max={90} required />
        <div class="row">
          <button type="submit" class="primary">
            발급
          </button>
        </div>
      </form>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>용도</th>
              <th>사용</th>
              <th>만료</th>
              <th>발급</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tokens.length === 0 ? (
              <tr>
                <td colspan={5}>발급한 토큰이 없습니다.</td>
              </tr>
            ) : (
              tokens.map((t) => {
                const usable = t.revoked_at === null && t.expires_at > now && t.uses < t.max_uses;
                return (
                  <tr>
                    <td>{t.label}</td>
                    <td>
                      {t.uses} / {t.max_uses}
                    </td>
                    <td>{t.revoked_at ? `폐기 ${fmt(t.revoked_at)}` : fmt(t.expires_at)}</td>
                    <td>
                      {fmt(t.created_at)} · {t.created_by}
                    </td>
                    <td>
                      {usable ? (
                        <ActionButton action={`/admin/tokens/${t.id}/revoke`} csrf={csrf} label="폐기" kind="danger" />
                      ) : (
                        <span class="hint">사용 불가</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
};

export const AuditPage: FC<{ logs: AuditLog[] }> = ({ logs }) => (
  <>
    <h1>감사 로그</h1>
    <p>최근 200건. SP 등록·변경과 관리 작업만 기록합니다. 사용자 로그인은 기록하지 않습니다.</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>시각</th>
            <th>주체</th>
            <th>작업</th>
            <th>대상</th>
            <th>내용</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr>
              <td>{fmt(l.at)}</td>
              <td class="mono">{l.actor}</td>
              <td class="mono">{l.action}</td>
              <td class="mono">{l.target ?? "-"}</td>
              <td class="mono">{l.detail ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>
);
