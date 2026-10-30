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
          <p class="idp-brand">B-CUBE 통합 로그인</p>
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

export const ConsentPage: FC<{
  clientName: string;
  /** 관리자가 검토한 SP인지 */
  reviewed: boolean;
  redirectOrigin: string;
  user: AuthenticatedUser;
  scopes: Scope[];
  csrf: string;
}> = ({ clientName, reviewed, redirectOrigin, user, scopes, csrf }) => {
  const shared = scopes.filter((s): s is Exclude<Scope, "openid"> => s !== "openid");
  return (
    <Layout title={`${clientName} 정보 제공 동의`}>
      <h1 class="idp-title">{clientName}에 로그인</h1>
      <p class="idp-body">
        <strong>{clientName}</strong>이(가) 아래 정보를 요청합니다. 동의하면 이번 로그인에 한해 이 정보를 전달합니다.
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
        동의하면 <strong>{redirectOrigin}</strong>(으)로 이동합니다.
      </p>
      <form method="post" action="/consent">
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
      <p class="idp-note">B-CUBE 통합 로그인은 비밀번호와 학생 정보를 저장하지 않습니다.</p>
    </Layout>
  );
};

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
