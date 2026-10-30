# B-CUBE-IDP

B-CUBE 서비스(SP)들이 함께 쓰는 OpenID Connect IdP. Cloudflare Workers에서 동작한다.

- 사용자 인증은 `@ajou.ac.kr` Google Workspace 계정으로만 한다. 비밀번호를 받거나 저장하지 않는다.
- 조회한 정보는 동의 화면에 그대로 보여주고, 사용자가 동의한 경우에만 SP에 전달한다.
- 사용자 정보와 학생 정보는 저장하지 않는다. D1에는 SP 등록 정보, 등록 토큰 해시, 관리 감사 로그, 이미 사용한 인가 코드의 ID만 남는다.
- SP는 `wrangler.jsonc`에 적는 정적 SP와, 관리 화면이나 동적 등록(RFC 7591/7592)으로 만드는 동적 SP 두 종류다.

설치와 배포, SP 연동 절차는 [docs/MANUAL.md](docs/MANUAL.md)에 있다.
SP 저장소에서 Claude Code로 기존 인증을 이 IdP로 옮길 때는 [docs/SP_MIGRATION_PROMPT.md](docs/SP_MIGRATION_PROMPT.md)를 쓴다.

## 흐름

```
SP ──/authorize──▶ IdP ──▶ Google 로그인 ──▶ /callback/google
                                               │ 학교 계정 확인 (email_verified, hd)
                                               │ mhaksa 조회 (student, sohakoe scope일 때만)
                                               ▼
SP ◀──code────── /consent (동의 화면) ◀────────┘
SP ──/token (client_secret + PKCE)──▶ id_token (ES256), access_token
```

로그인 중간 상태(SP 요청, Google state·nonce·PKCE, 조회한 학생 정보)는 서버에 두지 않고
암호화한 `__Host-idp_flow` 쿠키(10분)에 담는다. 인가 코드도 암호화한 자기 완결형 토큰(60초)이다.

## 엔드포인트

| 경로 | 설명 |
| --- | --- |
| `GET /.well-known/openid-configuration` | Discovery |
| `GET /jwks.json` | id_token 서명 공개 키 (ES256) |
| `GET /authorize` | 인가 요청. `response_type=code`, PKCE `S256`, `state` 필수 |
| `POST /token` | `authorization_code` 교환. `client_secret_basic` 또는 `client_secret_post` |
| `GET, POST /userinfo` | `Authorization: Bearer <access_token>` |
| `POST /register` | 동적 등록 (RFC 7591). `Authorization: Bearer <initial access token>` 필수 |
| `GET, PUT, DELETE /register/{client_id}` | 등록 정보 관리 (RFC 7592). `Authorization: Bearer <registration_access_token>` |
| `/admin` | 관리 화면 (`ADMIN_EMAILS` 계정만) |
| `GET /health` | 상태 확인 |

- 동의는 로그인할 때마다 받는다. `prompt=none`은 `login_required`로 거절한다.
- 인가 응답에 `iss`를 붙인다(RFC 9207).
- 토큰 수명은 5분이다. refresh token은 발급하지 않는다. SP는 id_token을 검증한 뒤 자체 세션을 만든다.

## scope와 클레임

| scope | 클레임 | 출처 |
| --- | --- | --- |
| `openid` (필수) | `sub` | Google 계정 `sub` |
| `email` | `email`, `email_verified` | Google |
| `profile` | `name` | Google |
| `student` | `student: { id, name, college, department, major, grade, status }` | mhaksa 학적 기본 정보 |
| `sohakoe` | `sohakoe_memberships: [{ name, year, semester, from, to }]` | mhaksa 소학회 가입 내역 |

- 값이 비어 있는 필드는 빠진다. 모든 값은 문자열이다.
- mhaksa 응답의 다른 열(주민등록번호, 연락처, 사진, 비밀번호 해시 등)은 [src/student.ts](src/student.ts)의 허용 목록에서 걸러져 어디에도 전달되지 않는다.
- SP별로 요청할 수 있는 scope는 `CLIENTS[].scopes`로 제한한다.

## SP 등록과 관리

| 방법 | 누가 | 상태 |
| --- | --- | --- |
| `wrangler.jsonc`의 `CLIENTS` (정적 SP) | 저장소에 커밋하고 배포하는 개발자 | 항상 활성, 관리 화면에서는 읽기만 |
| 관리 화면 `/admin/clients/new` | 관리자 | 바로 활성, 검토 완료 |
| `POST /register` (RFC 7591) | 관리자가 발급한 등록 토큰을 받은 SP 개발자 | `student`/`sohakoe`를 요청하면 승인 대기, 아니면 활성(미검토) |

- 열린 등록은 없다. `/register`에는 관리 화면에서 발급한 initial access token(사용 횟수, 유효 기간 제한)이 있어야 한다.
- `student`, `sohakoe`는 학생 정보를 넘기는 민감한 scope다. 관리자가 승인하기 전에는 그 SP로 로그인할 수 없다.
  승인한 뒤 SP가 RFC 7592로 민감한 scope를 더 늘리면 다시 승인 대기가 된다.
- 관리자가 검토하지 않은 SP는 동의 화면에 경고를 띄운다. 모든 SP의 동의 화면에는 이동할 주소(redirect_uri 출처)가 나온다.
- 관리 화면에서 할 수 있는 일: 승인, 중지·재개, 정보 수정, client_secret 재발급, 삭제, 등록 토큰 발급·폐기, 감사 로그 보기.
- 비밀값(client_secret, registration_access_token, 등록 토큰)은 발급할 때 한 번만 보여주고 SHA-256 해시만 저장한다.

## 개발

```sh
pnpm install
cp .dev.vars.example .dev.vars   # pnpm keys, pnpm client:secret 출력으로 채운다
pnpm db:migrate:local
pnpm dev                          # http://localhost:8787
pnpm test
pnpm typecheck
```

화면은 IBM Carbon(`@carbon/styles`)을 쓰는 서버 렌더링이다. 스크립트는 없고, 다크 모드는 `prefers-color-scheme`을 따른다.
스타일 원본은 [src/styles/app.scss](src/styles/app.scss)이고, `pnpm build:css`가 `public/assets/app.css`로 컴파일한다. 이 파일은 커밋하지 않는다.
`pnpm dev`와 `pnpm run deploy`는 먼저 CSS를 빌드한다. `wrangler`를 직접 실행하려면 `pnpm build:css`를 먼저 실행한다.

`DEV_FAKE_LOGIN=true`이면 Google 대신 이메일 입력 화면이 나오고 가짜 학생 정보를 쓴다. `ISSUER`가 localhost일 때만 켤 수 있다.
이때 `admin@ajou.ac.kr`이 관리자로 자동 추가되므로 http://localhost:8787/admin 에 바로 들어갈 수 있다.

## 구조

```
src/
  index.ts         fetch, scheduled(사용한 코드 기록 정리)
  app.ts           라우트 등록
  env.ts           환경 변수 검증
  clients.ts       SP 저장소(정적 + D1), RFC 7591 메타데이터 검증, 승인 규칙
  initial-access-tokens.ts  등록 토큰
  admin-session.ts 관리 화면 세션(암호화 쿠키)
  audit.ts         감사 로그
  keys.ts          id_token 서명, 쿠키·코드·액세스 토큰 암호화
  google.ts        Google OAuth 클라이언트
  student.ts       mhaksa 조회와 클레임 허용 목록
  scopes.ts        scope 정의
  flow.ts          암호화한 흐름 쿠키
  routes/oidc.tsx  discovery, jwks, authorize, token, userinfo
  routes/login.tsx Google 콜백, 동의 화면, 개발용 로그인
  routes/register.ts  RFC 7591/7592
  routes/admin.tsx 관리 화면
  views.tsx, admin-views.tsx  화면 (Carbon 클래스)
  styles/app.scss  Carbon 스타일과 간격 조정
migrations/        D1 스키마
scripts/           키, client_secret 생성
```
