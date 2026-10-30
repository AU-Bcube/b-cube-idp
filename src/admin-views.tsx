/**
 * 관리 화면. IBM Carbon 클래스를 쓰는 서버 렌더링 화면이다. 스크립트는 없고, 모든 쓰기는 CSRF 토큰이 든 POST 폼이다.
 */
import type { Child, FC } from "hono/jsx";
import type { AuditLog } from "./audit";
import { SENSITIVE_SCOPES, TOKEN_AUTH_METHODS, type Client, type DynamicClient } from "./clients";
import type { InitialAccessToken } from "./initial-access-tokens";
import { SCOPES } from "./scopes";
import { Notice, PageHead } from "./views";

function fmt(ms: number | null): string {
  if (ms === null) return "-";
  // 관리자는 한국 시간으로 본다.
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

const NAV: [string, string][] = [
  ["/admin", "SP 목록"],
  ["/admin/clients/new", "SP 추가"],
  ["/admin/tokens", "등록 토큰"],
  ["/admin/audit", "감사 로그"],
];

export const AdminLayout: FC<{ title: string; email: string; csrf: string; path: string; children: Child }> = ({
  title,
  email,
  csrf,
  path,
  children,
}) => (
  <html lang="ko">
    <PageHead title={`${title} · B-CUBE IdP 관리`} />
    <body>
      <header class="cds--header" aria-label="B-CUBE IdP 관리">
        <a class="cds--header__name" href="/admin">
          <span class="cds--header__name--prefix">B-CUBE</span>&nbsp;IdP 관리
        </a>
        <nav class="cds--header__nav" aria-label="관리 메뉴">
          <ul class="cds--header__menu-bar">
            {NAV.map(([href, label]) => (
              <li>
                <a class="cds--header__menu-item" href={href} aria-current={path === href ? "page" : undefined}>
                  <span class="cds--text-truncate--end">{label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div class="idp-header-user">
          <span class="idp-header-email">{email}</span>
          <form method="post" action="/admin/logout">
            <input type="hidden" name="csrf" value={csrf} />
            <button type="submit" class="cds--btn cds--btn--ghost cds--btn--sm cds--layout--size-sm">
              로그아웃
            </button>
          </form>
        </div>
      </header>
      <main class="idp-admin-content">{children}</main>
    </body>
  </html>
);

const Tag: FC<{ color: string; children: Child }> = ({ color, children }) => (
  <span class={`cds--tag cds--tag--${color} cds--layout--size-md`}>
    <span class="cds--tag__label">{children}</span>
  </span>
);

const Status: FC<{ client: Client }> = ({ client }) => {
  if (client.source === "static") return <Tag color="cool-gray">정적</Tag>;
  const [label, color] = {
    pending: ["승인 대기", "purple"],
    active: ["활성", "green"],
    suspended: ["중지", "red"],
  }[client.status] as [string, string];
  return <Tag color={color}>{label}</Tag>;
};

const Scopes: FC<{ scopes: Iterable<string> }> = ({ scopes }) => (
  <span class="mono">
    {[...scopes].map((s, i) => (
      <>
        {i > 0 ? " " : ""}
        <span class={SENSITIVE_SCOPES.has(s as never) ? "idp-sensitive" : ""}>{s}</span>
      </>
    ))}
  </span>
);

export const ClientListPage: FC<{ statics: Client[]; dynamics: DynamicClient[] }> = ({ statics, dynamics }) => {
  const pending = dynamics.filter((c) => c.status === "pending").length;
  const rows = [...dynamics, ...statics];
  return (
    <>
      <h1 class="idp-page-title">SP 목록</h1>
      {pending > 0 ? <Notice kind="warning" title={`승인을 기다리는 SP가 ${pending}개 있습니다.`} /> : null}
      <p class="idp-lead">
        정적 SP는 <code>wrangler.jsonc</code>의 <code>CLIENTS</code>에서 관리하므로 여기서 바꿀 수 없습니다. 강조된
        scope는 학생 정보를 넘기는 scope입니다.
      </p>
      <div class="idp-table-wrap">
        <table class="cds--data-table cds--data-table--lg">
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
                    <a class="cds--link" href={`/admin/clients/${encodeURIComponent(c.clientId)}`}>
                      {c.name}
                    </a>
                    {c.source === "dynamic" && !c.reviewed ? <div class="idp-muted">미검토</div> : null}
                  </td>
                  <td class="mono">{c.clientId}</td>
                  <td>
                    <Scopes scopes={c.scopes} />
                  </td>
                  <td class="mono">
                    {c.redirectUris.map((u) => (
                      <div class="idp-uri">{u}</div>
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

const TextField: FC<{
  id: string;
  label: string;
  helper?: string;
  value: string;
  required?: boolean;
  maxlength?: number;
}> = ({ id, label, helper, value, required, maxlength }) => (
  <div class="cds--form-item cds--text-input-wrapper idp-form-row">
    <label class="cds--label" for={id}>
      {label}
    </label>
    <div class="cds--text-input__field-outer-wrapper">
      <div class="cds--text-input__field-wrapper">
        <input
          id={id}
          class="cds--text-input cds--text-input--md cds--layout--size-md"
          type="text"
          name={id}
          value={value}
          required={required}
          maxlength={maxlength}
        />
      </div>
    </div>
    {helper ? <div class="cds--form__helper-text">{helper}</div> : null}
  </div>
);

const NumberField: FC<{ id: string; label: string; value: string; min: number; max: number }> = ({
  id,
  label,
  value,
  min,
  max,
}) => (
  <div class="cds--form-item cds--text-input-wrapper idp-form-row">
    <label class="cds--label" for={id}>
      {label}
    </label>
    <div class="cds--text-input__field-outer-wrapper">
      <div class="cds--text-input__field-wrapper">
        <input
          id={id}
          class="cds--text-input cds--text-input--md cds--layout--size-md"
          type="number"
          name={id}
          value={value}
          min={min}
          max={max}
          required
        />
      </div>
    </div>
  </div>
);

const TextAreaField: FC<{ id: string; label: string; helper: string; value: string; required?: boolean }> = ({
  id,
  label,
  helper,
  value,
  required,
}) => (
  <div class="cds--form-item idp-form-row">
    <label class="cds--label" for={id}>
      {label}
    </label>
    <div class="cds--text-area__wrapper">
      <textarea id={id} class="cds--text-area mono" name={id} rows={3} required={required}>
        {value}
      </textarea>
    </div>
    <div class="cds--form__helper-text">{helper}</div>
  </div>
);

export const ClientForm: FC<{ action: string; csrf: string; values: ClientFormValues; submit: string; error?: string }> = ({
  action,
  csrf,
  values,
  submit,
  error,
}) => (
  <form method="post" action={action} class="idp-panel cds--layer-two">
    {error ? <Notice kind="error" title="입력을 확인하세요">{error}</Notice> : null}
    <input type="hidden" name="csrf" value={csrf} />
    <TextField
      id="client_name"
      label="이름"
      helper="동의 화면에 그대로 나옵니다."
      value={values.name}
      required
      maxlength={100}
    />
    <TextAreaField
      id="redirect_uris"
      label="redirect_uri"
      helper="한 줄에 하나. https만(localhost는 http 허용)"
      value={values.redirectUris}
      required
    />
    <fieldset class="cds--fieldset idp-form-row">
      <legend class="cds--label">scope</legend>
      <div class="idp-checks">
        {SCOPES.map((s) => (
          <div class="cds--form-item cds--checkbox-wrapper">
            <input
              id={`scope-${s}`}
              class="cds--checkbox"
              type="checkbox"
              name="scope"
              value={s}
              checked={s === "openid" || values.scopes.has(s)}
              disabled={s === "openid"}
            />
            <label class="cds--checkbox-label" for={`scope-${s}`}>
              <span class={`cds--checkbox-label-text ${SENSITIVE_SCOPES.has(s) ? "idp-sensitive" : ""}`}>{s}</span>
            </label>
          </div>
        ))}
      </div>
    </fieldset>
    <div class="cds--form-item idp-form-row">
      <div class="cds--select">
        <label class="cds--label" for="token_endpoint_auth_method">
          토큰 엔드포인트 인증
        </label>
        <div class="cds--select-input__wrapper">
          <select id="token_endpoint_auth_method" class="cds--select-input" name="token_endpoint_auth_method">
            {TOKEN_AUTH_METHODS.map((m) => (
              <option class="cds--select-option" value={m} selected={values.tokenEndpointAuthMethod === m}>
                {m}
              </option>
            ))}
          </select>
          <svg class="cds--select__arrow" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 11L3 6l.7-.7L8 9.6l4.3-4.3.7.7z" />
          </svg>
        </div>
      </div>
    </div>
    <TextAreaField id="contacts" label="담당자 연락처" helper="한 줄에 하나(선택)" value={values.contacts} />
    <TextField id="client_uri" label="서비스 주소" helper="https(선택)" value={values.clientUri} />
    <button type="submit" class="cds--btn cds--btn--lg cds--layout--size-lg cds--btn--primary">
      {submit}
    </button>
  </form>
);

const ActionButton: FC<{ action: string; csrf: string; label: string; kind?: "primary" | "secondary" | "danger" }> = ({
  action,
  csrf,
  label,
  kind = "secondary",
}) => (
  <form method="post" action={action}>
    <input type="hidden" name="csrf" value={csrf} />
    <button type="submit" class={`cds--btn cds--btn--sm cds--layout--size-sm cds--btn--${kind}`}>
      {label}
    </button>
  </form>
);

export const ClientDetailPage: FC<{ client: Client; csrf: string; form?: Child }> = ({ client, csrf, form }) => {
  const base = `/admin/clients/${encodeURIComponent(client.clientId)}`;
  const dyn = client.source === "dynamic" ? (client as DynamicClient) : null;
  return (
    <>
      <h1 class="idp-page-title">
        {client.name} <Status client={client} />
      </h1>
      <div class="idp-panel cds--layer-two">
        <dl class="idp-details">
          <dt>client_id</dt>
          <dd class="mono">{client.clientId}</dd>
          <dt>scope</dt>
          <dd>
            <Scopes scopes={client.scopes} />
          </dd>
          <dt>redirect_uri</dt>
          <dd class="mono">
            {client.redirectUris.map((u) => (
              <div class="idp-uri">{u}</div>
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
          <div class="idp-toolbar">
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
          <h2 class="idp-section-title">정보 수정</h2>
          <p class="idp-lead">관리자가 고치면 승인 상태를 유지합니다. SP가 RFC 7592로 민감한 scope를 늘리면 다시 승인 대기가 됩니다.</p>
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
    <h1 class="idp-page-title">{title}</h1>
    <Notice kind="warning" title="지금 한 번만 보여줍니다">
      IdP에는 해시만 남습니다. SP 담당자에게 안전한 경로로 전달하세요.
    </Notice>
    <div class="idp-panel cds--layer-two">
      {items.map(([k, v]) => (
        <>
          <div class="idp-form-title">{k}</div>
          <div class="secret mono">{v}</div>
        </>
      ))}
      {note ? <p class="idp-lead">{note}</p> : null}
      <div class="idp-link-row">
        <a class="cds--link" href={next}>
          계속
        </a>
      </div>
    </div>
  </>
);

export const TokensPage: FC<{ tokens: InitialAccessToken[]; csrf: string; issuer: string }> = ({ tokens, csrf, issuer }) => {
  const now = Date.now();
  return (
    <>
      <h1 class="idp-page-title">등록 토큰 (initial access token)</h1>
      <p class="idp-lead">
        SP 개발자가 <code>POST {issuer}/register</code>로 직접 SP를 등록할 때 쓰는 토큰입니다(RFC 7591). student,
        sohakoe scope를 요청한 SP는 승인할 때까지 쓸 수 없습니다.
      </p>
      <form method="post" action="/admin/tokens" class="idp-panel cds--layer-two">
        <input type="hidden" name="csrf" value={csrf} />
        <TextField id="label" label="용도" helper="누구에게 주는지" value="" required maxlength={100} />
        <NumberField id="max_uses" label="사용 횟수" value="1" min={1} max={100} />
        <NumberField id="ttl_days" label="유효 기간(일)" value="7" min={1} max={90} />
        <button type="submit" class="cds--btn cds--btn--lg cds--layout--size-lg cds--btn--primary">
          발급
        </button>
      </form>
      <div class="idp-table-wrap">
        <table class="cds--data-table cds--data-table--lg">
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
                        <span class="idp-muted">사용 불가</span>
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
    <h1 class="idp-page-title">감사 로그</h1>
    <p class="idp-lead">최근 200건. SP 등록·변경과 관리 작업만 기록합니다. 사용자 로그인은 기록하지 않습니다.</p>
    <div class="idp-table-wrap">
      <table class="cds--data-table cds--data-table--lg">
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
