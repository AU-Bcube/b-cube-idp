/**
 * 서버에서 렌더링하는 화면. 스크립트는 쓰지 않는다.
 */
import type { Child, FC } from "hono/jsx";
import { SCOPE_LABELS, type Scope } from "./scopes";
import type { SohakoeClaim, StudentClaim } from "./student";
import type { AuthenticatedUser } from "./types";

const STYLE = `
:root { color-scheme: light dark; --bg: #f4f4f4; --card: #fff; --fg: #161616; --muted: #525252; --line: #e0e0e0;
  --primary: #0f62fe; --primary-fg: #fff; --danger: #da1e28; }
@media (prefers-color-scheme: dark) { :root { --bg: #161616; --card: #262626; --fg: #f4f4f4; --muted: #c6c6c6;
  --line: #393939; --primary: #4589ff; --danger: #ff8389; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px;
  background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
main { width: 100%; max-width: 440px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 28px 24px; }
.brand { font-size: 13px; font-weight: 600; color: var(--muted); letter-spacing: .02em; margin: 0 0 16px; }
h1 { font-size: 20px; margin: 0 0 8px; }
p { margin: 0 0 16px; color: var(--muted); }
.account { margin: 0 0 20px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 6px; font-size: 14px; }
ul.scopes { list-style: none; margin: 0 0 20px; padding: 0; border-top: 1px solid var(--line); }
ul.scopes > li { padding: 12px 0; border-bottom: 1px solid var(--line); }
.label { font-weight: 600; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 6px 0 0; font-size: 14px; color: var(--muted); }
dt { color: var(--muted); } dd { margin: 0; color: var(--fg); overflow-wrap: anywhere; }
.value { font-size: 14px; color: var(--fg); overflow-wrap: anywhere; }
.actions { display: flex; gap: 8px; }
button, input { font: inherit; }
button { flex: 1; padding: 11px 16px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: var(--fg); cursor: pointer; }
button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-fg); }
input[type=email] { width: 100%; padding: 10px 12px; margin: 0 0 12px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: var(--fg); }
.note { font-size: 13px; margin: 16px 0 0; }
.error { color: var(--danger); }
.warn { color: var(--danger); border-left: 3px solid var(--danger); padding-left: 10px; }
`;

const Layout: FC<{ title: string; children: Child }> = ({ title, children }) => (
  <html lang="ko">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex" />
      <title>{title}</title>
      <style>{STYLE}</style>
    </head>
    <body>
      <main>
        <p class="brand">B-CUBE 통합 로그인</p>
        {children}
      </main>
    </body>
  </html>
);

export const ErrorPage: FC<{ title: string; message: string }> = ({ title, message }) => (
  <Layout title={title}>
    <h1 class="error">{title}</h1>
    <p>{message}</p>
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
    <dl>
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
    <div class="value">가입 내역 없음</div>
  ) : (
    <dl>
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
      return <div class="value">{user.email}</div>;
    case "profile":
      return <div class="value">{user.name ?? "(이름 없음)"}</div>;
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
      <h1>{clientName}에 로그인</h1>
      <p>
        <strong>{clientName}</strong>이(가) 아래 정보를 요청합니다. 동의하면 이번 로그인에 한해 이 정보를 전달합니다.
      </p>
      {reviewed ? null : (
        <p class="warn">
          B-CUBE 관리자가 검토하지 않은 서비스입니다. 이름만으로 서비스를 믿지 말고 이동할 주소를 확인하세요.
        </p>
      )}
      <div class="account">{user.email}</div>
      {shared.length > 0 ? (
        <ul class="scopes">
          {shared.map((s) => (
            <li>
              <div class="label">{SCOPE_LABELS[s]}</div>
              {scopeValue(s, user)}
            </li>
          ))}
        </ul>
      ) : (
        <p>로그인 여부 외에 전달하는 정보는 없습니다.</p>
      )}
      <p class="note">
        동의하면 <strong>{redirectOrigin}</strong>(으)로 이동합니다.
      </p>
      <form method="post" action="/consent">
        <input type="hidden" name="csrf" value={csrf} />
        <div class="actions">
          <button type="submit" name="decision" value="deny">
            거부
          </button>
          <button type="submit" name="decision" value="allow" class="primary">
            동의하고 계속
          </button>
        </div>
      </form>
      <p class="note">B-CUBE 통합 로그인은 비밀번호와 학생 정보를 저장하지 않습니다.</p>
    </Layout>
  );
};

export const DevLoginPage: FC<{ csrf: string; admin: boolean }> = ({ csrf, admin }) => (
  <Layout title="개발용 로그인">
    <h1>개발용 로그인</h1>
    <p>DEV_FAKE_LOGIN이 켜져 있습니다. Google 대신 입력한 이메일과 가짜 학생 정보로 로그인합니다.</p>
    <form method="post" action="/dev/login">
      <input type="hidden" name="csrf" value={csrf} />
      <input type="email" name="email" value={admin ? "admin@ajou.ac.kr" : "student@ajou.ac.kr"} required />
      <div class="actions">
        <button type="submit" class="primary">
          로그인
        </button>
      </div>
    </form>
  </Layout>
);
