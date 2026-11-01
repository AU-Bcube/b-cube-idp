/**
 * 서버에서 렌더링하는 화면. 스크립트는 쓰지 않는다.
 */
import type { Child, FC } from "hono/jsx";
import { SCOPE_LABELS, type Scope } from "./scopes";
import type { SohakoeClaim, StudentClaim } from "./student";
import type { AuthenticatedUser } from "./types";

/** Carbon 스타일과 글꼴. 스타일은 public/assets/app.css(`pnpm build:css`)에서 온다. */
export const PageHead: FC<{ title: string }> = ({ title }) => (
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>{title}</title>
    {/* IBM Plex Sans KR, D2Coding: jsDelivr 버전 고정. integrity는 파일이 바뀌면 로드를 막는다. */}
    <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin="anonymous" />
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans-kr@5.3.0/400.css"
      integrity="sha384-qLVaqLxeq6qZ/E40xWR0e+qVlNdUzJDclNn1c7c/YVr3Z54kjleakgc1mPj3zxsF"
      crossorigin="anonymous"
    />
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans-kr@5.3.0/600.css"
      integrity="sha384-v5pkM92zPDiVnHle/1KSWhkRf+GrjLp2VO5HbJNA9Wq0kCCIjbRDk+1EhX6FznC8"
      crossorigin="anonymous"
    />
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/d2coding@1.3.2/d2coding-subset.css"
      integrity="sha384-/aGOjRgXetckwYWTzGw1zfJJPlG4ZNUhc+ntpCY45ZqFXbKWXJQyg4WlSYt5Aghw"
      crossorigin="anonymous"
    />
    <link rel="stylesheet" href="/assets/app.css" />
  </head>
);

/** Carbon inline notification (low contrast). 닫기 버튼은 스크립트가 없어 넣지 않는다. */
export const Notice: FC<{ kind: "warning" | "error" | "info"; title: string; children?: Child }> = ({
  kind,
  title,
  children,
}) => (
  <div
    class={`cds--inline-notification cds--inline-notification--low-contrast cds--inline-notification--${kind} idp-notification`}
    role="status"
  >
    <div class="cds--inline-notification__details">
      <svg class="cds--inline-notification__icon" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 1c-5 0-9 4-9 9s4 9 9 9 9-4 9-9-4-9-9-9zm-.8 4h1.5v7H9.2V5zm.8 11c-.6 0-1-.4-1-1s.4-1 1-1 1 .4 1 1-.4 1-1 1z" />
      </svg>
      <div class="cds--inline-notification__text-wrapper">
        <div class="cds--inline-notification__title">{title}</div>
        {children ? <div class="cds--inline-notification__subtitle">{children}</div> : null}
      </div>
    </div>
  </div>
);

const Layout: FC<{ title: string; children: Child }> = ({ title, children }) => (
  <html lang="ko">
    <PageHead title={title} />
    <body>
      <div class="idp-center">
        <main class="idp-card cds--layer-two">
          <p class="idp-brand">
            <a href="/">B-CUBE 통합 로그인</a>
          </p>
          {children}
        </main>
      </div>
    </body>
  </html>
);

export const ErrorPage: FC<{ title: string; message: string }> = ({ title, message }) => (
  <Layout title={title}>
    <h1 class="idp-title idp-title--error">{title}</h1>
    <p class="idp-body">{message}</p>
  </Layout>
);

/** 루트(/) 안내 페이지. 주소창에 IdP 주소를 직접 입력한 사용자를 위한 화면이다. */
export const HomePage: FC<{ emailDomain: string; sourceUrl: string }> = ({ emailDomain, sourceUrl }) => (
  <Layout title="B-CUBE 통합 로그인">
    <h1 class="idp-title">B-CUBE 통합 로그인</h1>
    <p class="idp-body">
      B-CUBE 서비스에 학교 Google 계정(@{emailDomain})으로 로그인하는 곳입니다. 각 서비스에서 로그인을 누르면 이곳을 거쳐
      로그인합니다.
    </p>
    <h2 class="idp-scope-label">내 동의 관리</h2>
    <p class="idp-body">서비스에 제공하기로 동의한 정보를 확인하고, 서비스별로 동의를 철회할 수 있습니다.</p>
    <a href="/consents" class="cds--btn cds--btn--lg cds--layout--size-lg cds--btn--primary idp-home-action">
      내 동의 관리
    </a>
    <p class="idp-note">
      비밀번호와 학생 정보는 저장하지 않습니다. 어느 서비스에 어떤 항목을 동의했는지만 1년간 저장합니다.
      <br />
      서비스 개발자: <a href="/.well-known/openid-configuration">OpenID Connect 설정</a>
      {sourceUrl ? (
        <>
          {" "}
          · <a href={sourceUrl}>소스 코드 (AGPL-3.0)</a>
        </>
      ) : null}
    </p>
  </Layout>
);

const StudentValue: FC<{ student: StudentClaim }> = ({ student }) => {
  const rows: [string, string | undefined][] = [
    ["학번", student.id],
    ["이름", student.name],
    ["단과대학", student.college],
    ["학과", student.department],
    ["전공", student.major],
    ["학년", student.grade],
    ["학적 상태", student.status],
  ];
  return (
    <dl class="idp-pairs">
      {rows
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => (
          <>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </>
        ))}
    </dl>
  );
};

const SohakoeValue: FC<{ list: SohakoeClaim[] }> = ({ list }) =>
  list.length === 0 ? (
    <div class="idp-value">가입 내역 없음</div>
  ) : (
    <dl class="idp-pairs">
      {list.map((m) => (
        <>
          <dt>{[m.year, m.semester].filter(Boolean).join("-") || "-"}</dt>
          <dd>{m.name ?? "(이름 없음)"}</dd>
        </>
      ))}
    </dl>
  );

function scopeValue(scope: Exclude<Scope, "openid">, user: AuthenticatedUser): Child {
  switch (scope) {
    case "email":
      return <div class="idp-value">{user.email}</div>;
    case "profile":
      return <div class="idp-value">{user.name ?? "(이름 없음)"}</div>;
    case "student":
      return user.mhaksa.student ? <StudentValue student={user.mhaksa.student} /> : null;
    case "sohakoe":
      return <SohakoeValue list={user.mhaksa.sohakoe_memberships ?? []} />;
  }
}

/** 한국 시간 날짜 (YYYY-MM-DD) */
function kstDate(ms: number): string {
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 10);
}

export const ConsentPage: FC<{
  clientName: string;
  /** 관리자가 검토한 SP인지 */
  reviewed: boolean;
  redirectOrigin: string;
  user: AuthenticatedUser;
  scopes: Scope[];
  flowId: string;
  csrf: string;
  /** 지금 동의하면 동의를 기억하는 기한 */
  consentExpiresAt: number;
}> = ({ clientName, reviewed, redirectOrigin, user, scopes, flowId, csrf, consentExpiresAt }) => {
  const shared = scopes.filter((s): s is Exclude<Scope, "openid"> => s !== "openid");
  return (
    <Layout title={`${clientName} 정보 제공 동의`}>
      <h1 class="idp-title">{clientName}에 로그인</h1>
      <p class="idp-body">
        <strong>{clientName}</strong>이(가) 아래 정보를 요청합니다. 동의하면 이 정보를 전달합니다.
      </p>
      {reviewed ? null : (
        <Notice kind="warning" title="검토하지 않은 서비스">
          B-CUBE 관리자가 검토하지 않은 서비스입니다. 이름만으로 서비스를 믿지 말고 이동할 주소를 확인하세요.
        </Notice>
      )}
      <div class="idp-account">{user.email}</div>
      {shared.length > 0 ? (
        <ul class="idp-scopes">
          {shared.map((s) => (
            <li>
              <div class="idp-scope-label">{SCOPE_LABELS[s]}</div>
              {scopeValue(s, user)}
            </li>
          ))}
        </ul>
      ) : (
        <p class="idp-body">로그인 여부 외에 전달하는 정보는 없습니다.</p>
      )}
      <p class="idp-redirect">
        동의하면 <strong>{redirectOrigin}</strong>(으)로 이동합니다. 동의는 <strong>{kstDate(consentExpiresAt)}</strong>
        까지 1년간 저장되며, 그동안 이 서비스에 로그인할 때는 다시 묻지 않습니다.
      </p>
      <form method="post" action="/consent">
        <input type="hidden" name="flow" value={flowId} />
        <input type="hidden" name="csrf" value={csrf} />
        <div class="idp-actions">
          <button type="submit" name="decision" value="deny" class="cds--btn cds--btn--lg cds--layout--size-lg cds--btn--secondary">
            거부
          </button>
          <button type="submit" name="decision" value="allow" class="cds--btn cds--btn--lg cds--layout--size-lg cds--btn--primary">
            동의하고 계속
          </button>
        </div>
      </form>
      <p class="idp-note">
        B-CUBE 통합 로그인은 비밀번호와 학생 정보를 저장하지 않습니다. 어느 서비스에 어떤 항목을 동의했는지만 저장합니다.
        동의한 내용은 <a href="/consents">내 동의 관리</a>에서 확인하고 철회할 수 있습니다.
      </p>
    </Layout>
  );
};

/** 동의 관리 화면의 SP 하나 */
export interface ConsentEntry {
  clientId: string;
  /** 삭제된 SP면 null */
  clientName: string | null;
  origins: string[];
  scopes: Scope[];
  grantedAt: number;
  expiresAt: number;
}

/** 저장한 값이 없는 항목은 무엇을 전달하는지 설명한다. */
function providedValue(scope: Exclude<Scope, "openid">, account: { email: string; name?: string | undefined }): Child {
  switch (scope) {
    case "email":
      return <div class="idp-value">{account.email}</div>;
    case "profile":
      return <div class="idp-value">{account.name ?? "(이름 없음)"}</div>;
    case "student":
    case "sohakoe":
      return <div class="idp-value idp-muted-value">로그인할 때마다 학사 시스템에서 조회해 전달합니다.</div>;
  }
}

export const ConsentsPage: FC<{
  account: { email: string; name?: string | undefined };
  csrf: string;
  entries: ConsentEntry[];
  /** 방금 철회한 SP 이름 */
  revoked?: string | undefined;
}> = ({ account, csrf, entries, revoked }) => (
  <Layout title="내 동의 관리">
    <h1 class="idp-title">내 동의 관리</h1>
    <p class="idp-body">
      B-CUBE 통합 로그인으로 정보를 제공하기로 동의한 서비스입니다. 동의를 철회하면 다음 로그인부터 다시 동의를 묻습니다.
    </p>
    <div class="idp-account">{account.email}</div>
    {revoked ? (
      <Notice kind="info" title={`${revoked}에 대한 동의를 철회했습니다.`}>
        이미 제공한 정보의 삭제는 해당 서비스에 요청해야 합니다.
      </Notice>
    ) : null}
    {entries.length === 0 ? (
      <p class="idp-body">동의한 서비스가 없습니다.</p>
    ) : (
      entries.map((e) => {
        const name = e.clientName ?? `삭제된 서비스 (${e.clientId})`;
        const shared = e.scopes.filter((s): s is Exclude<Scope, "openid"> => s !== "openid");
        return (
          <section class="idp-sp">
            <h2 class="idp-sp-name">{name}</h2>
            <dl class="idp-pairs idp-sp-meta">
              {e.origins.length > 0 ? (
                <>
                  <dt>주소</dt>
                  <dd>{e.origins.join(", ")}</dd>
                </>
              ) : null}
              <dt>동의한 날</dt>
              <dd>{kstDate(e.grantedAt)}</dd>
              <dt>동의 기한</dt>
              <dd>{kstDate(e.expiresAt)}</dd>
            </dl>
            {shared.length > 0 ? (
              <ul class="idp-scopes">
                {shared.map((s) => (
                  <li>
                    <div class="idp-scope-label">{SCOPE_LABELS[s]}</div>
                    {providedValue(s, account)}
                  </li>
                ))}
              </ul>
            ) : (
              <p class="idp-body">로그인 여부 외에 제공하는 정보는 없습니다.</p>
            )}
            <form method="post" action="/consents/revoke">
              <input type="hidden" name="csrf" value={csrf} />
              <input type="hidden" name="client_id" value={e.clientId} />
              <button type="submit" class="cds--btn cds--btn--md cds--layout--size-md cds--btn--danger--tertiary">
                {name} 동의 철회
              </button>
            </form>
          </section>
        );
      })
    )}
    <form method="post" action="/consents/logout" class="idp-sp-logout">
      <input type="hidden" name="csrf" value={csrf} />
      <button type="submit" class="cds--btn cds--btn--md cds--layout--size-md cds--btn--ghost">
        로그아웃
      </button>
    </form>
  </Layout>
);

export const DevLoginPage: FC<{ csrf: string; admin: boolean }> = ({ csrf, admin }) => (
  <Layout title="개발용 로그인">
    <h1 class="idp-title">개발용 로그인</h1>
    <p class="idp-body">DEV_FAKE_LOGIN이 켜져 있습니다. Google 대신 입력한 이메일과 가짜 학생 정보로 로그인합니다.</p>
    <form method="post" action="/dev/login">
      <input type="hidden" name="csrf" value={csrf} />
      <div class="cds--form-item cds--text-input-wrapper idp-field">
        <label class="cds--label" for="email">
          이메일
        </label>
        <div class="cds--text-input__field-outer-wrapper">
          <div class="cds--text-input__field-wrapper">
            <input
              id="email"
              class="cds--text-input cds--text-input--md cds--layout--size-md"
              type="email"
              name="email"
              value={admin ? "admin@ajou.ac.kr" : "student@ajou.ac.kr"}
              required
            />
          </div>
        </div>
      </div>
      <button type="submit" class="cds--btn cds--btn--lg cds--layout--size-lg cds--btn--primary">
        로그인
      </button>
    </form>
  </Layout>
);
