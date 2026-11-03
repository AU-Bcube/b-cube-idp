![Netlify Status](https://api.netlify.com/api/v1/badges/ec7d438c-aa8f-4435-bcfe-08d0e3eec963/deploy-status)

# B-CUBE-IDP

<img src="assets/b-cube-idp-ko-logo.png" height="84" style="margin-right: 32;">
<img src="assets/b-cube-idp-en-logo.png" height="84">

B-CUBE 서비스(SP)들이 함께 쓰는 OpenID Connect IdP. Netlify Functions(Node)에서 동작하고 MongoDB에 저장한다.

- 사용자 인증은 `@ajou.ac.kr` Google Workspace 계정으로만 한다. 비밀번호를 받거나 저장하지 않는다.
- 조회한 정보는 동의 화면에 그대로 보여주고, 사용자가 동의한 경우에만 SP에 전달한다.
- 사용자 정보와 학생 정보는 저장하지 않는다. MongoDB에는 SP 등록 정보, 등록 토큰 해시, 관리 감사 로그, 이미 사용한 인가 코드의 ID,
  동의 기록(Google `sub`, SP, 동의한 scope, 기한)만 남는다.
- SP는 모두 MongoDB에 있고, 관리 화면이나 동적 등록(RFC 7591/7592)으로 만든다.

동의를 확인하거나 철회하려는 사용자는 [내 동의 확인과 철회](#내-동의-확인과-철회)를 본다.
설치, 배포, SP 등록·승인 같은 IdP 운영 절차는 [docs/MANUAL.md](docs/MANUAL.md)에 있다.
SP 저장소에서 Claude Code로 기존 인증을 이 IdP로 옮길 때는 [docs/SP_MIGRATION_PROMPT.md](docs/SP_MIGRATION_PROMPT.md)를 쓴다.

## 내 동의 확인과 철회

B-CUBE 인증 플랫폼으로 서비스(SP)에 정보를 제공하기로 동의한 내용은 **https://id.b-cube.kr/consents** 에서 확인하고 철회한다.
https://id.b-cube.kr 첫 화면의 "내 동의 관리" 버튼이나 동의 화면 하단의 "내 동의 관리" 링크로도 들어갈 수 있다.

1. https://id.b-cube.kr/consents 에 접속해 학교 Google 계정(`@ajou.ac.kr`)으로 로그인한다.
2. 동의한 서비스마다 아래 내용이 나온다.
   - 서비스 이름과 주소
   - 동의한 날과 동의 기한(동의한 날부터 1년)
   - 제공하는 정보: 이메일 주소, Google 계정 이름, 학적 정보(학번, 이름, 소속, 학년, 학적 상태), 소학회 가입 내역 중 동의한 항목.
     학적 정보와 소학회 가입 내역은 IdP가 저장하지 않고 로그인할 때마다 학사 시스템에서 조회해 전달하므로 값은 보여주지 않는다.
3. 철회할 서비스의 "동의 철회" 버튼을 누른다. 서비스마다 따로 철회한다.
4. 다 봤으면 "로그아웃"을 누른다. 첫 화면(안내 페이지)으로 돌아간다. 로그아웃하지 않아도 30분이 지나면 다시 로그인해야 한다.

- 철회하면 그 서비스에 다음에 로그인할 때 동의 화면이 다시 나온다. 거부하면 그 서비스에 로그인할 수 없다.
- 철회는 앞으로의 제공을 멈출 뿐이다. 이미 그 서비스에 전달된 정보의 삭제는 해당 서비스에 요청해야 한다.
- 서비스가 `prompt=consent`로 동의를 다시 물을 때 "거부"를 눌러도 그 서비스에 대한 동의가 철회된다.
- 기한이 지난 동의는 목록에서 사라지고, 다음 로그인 때 다시 묻는다.

## 흐름

```
SP ──/authorize──▶ IdP ──▶ Google 로그인 ──▶ /callback/google
                                               │ 학교 계정 확인 (email_verified, hd)
                                               │ mhaksa 조회 (student, sohakoe scope일 때만)
                                               ▼
SP ◀──code────── /consent (동의 화면) ◀────────┘
                  (1년 안에 동의한 scope면 생략)
SP ──/token (client_secret + PKCE)──▶ id_token (ES256), access_token
```

로그인 중간 상태(SP 요청, Google state·nonce·PKCE, 조회한 학생 정보)는 서버에 두지 않고
암호화한 `__Host-idp_flow_<흐름 id>` 쿠키(10분)에 담는다. 쿠키는 로그인 흐름마다 따로 있어 여러 탭에서 동시에 로그인해도
서로 덮어쓰지 않는다. 흐름 id는 Google `state`(`<흐름 id>.<랜덤>`)와 동의 화면 주소(`/consent?flow=<흐름 id>`)로 전달되고,
흐름 쿠키는 최대 5개까지 두고 넘으면 오래된 것부터 지운다. 인가 코드도 암호화한 자기 완결형 토큰(60초)이다.

## 엔드포인트

| 경로 | 설명 |
| --- | --- |
| `GET /` | 안내 페이지. 서비스 소개, 내 동의 관리 버튼, 개발자용 discovery·소스 코드 링크 |
| `GET /.well-known/openid-configuration` | Discovery |
| `GET /jwks.json` | id_token 서명 공개 키 (ES256) |
| `GET /authorize` | 인가 요청. `response_type=code`, PKCE `S256`, `state` 필수(1280자 이하) |
| `POST /token` | `authorization_code` 교환. `client_secret_basic` 또는 `client_secret_post` |
| `GET, POST /userinfo` | `Authorization: Bearer <access_token>` |
| `POST /register` | 동적 등록 (RFC 7591). `Authorization: Bearer <initial access token>` 필수 |
| `GET, PUT, DELETE /register/{client_id}` | 등록 정보 관리 (RFC 7592). `Authorization: Bearer <registration_access_token>` |
| `/admin` | 관리 화면 (`ADMIN_EMAILS` 계정만) |
| `GET /consents` | 내 동의 관리. 학교 Google 계정으로 로그인해 동의한 SP별 제공 정보를 보고 SP별로 동의를 철회한다 |
| `GET /consents/login` | 내 동의 관리 로그인 시작 (Google) |
| `POST /consents/revoke` | SP 하나의 동의 철회 (`client_id`, CSRF 토큰) |
| `POST /consents/logout` | 내 동의 관리 로그아웃. 세션을 지우고 안내 페이지(`/`)로 보낸다 |
| `GET, POST /consent?flow=<흐름 id>` | SP 로그인 중 동의 화면 |
| `GET /health` | 상태 확인 |

- 동의는 1년간 기억한다. 같은 SP가 동의한 scope 안에서 요청하면 Google 로그인 뒤 동의 화면 없이 코드를 준다.
  더 넓은 scope를 요청하거나 기한이 지나면 다시 묻고, 동의하면 기한이 그날부터 다시 1년이 된다. 동의 화면에 기한을 표시한다.
- 사용자는 `/consents`에서 동의를 철회할 수 있다([내 동의 확인과 철회](#내-동의-확인과-철회)). 동의 화면에도 링크가 있다.
  철회하면 다음 로그인부터 다시 묻는다. 이미 SP에 전달한 정보는 IdP가 지울 수 없으므로 화면에 SP에 요청하라고 안내한다.
- 내 동의 관리 세션은 암호화한 `__Host-idp_account` 쿠키(30분)에 담는다. 동의 기록은 Google `sub`로 찾으므로 본인 것만 보인다.
- `prompt=consent`면 기억한 동의가 있어도 다시 묻는다. 이때 거부해도 기억한 동의를 지운다.
- IdP는 로그인 세션을 두지 않으므로 매번 Google 로그인이 필요하다. `prompt=none`은 `login_required`로 거절한다.
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
- SP별로 요청할 수 있는 scope는 등록할 때 정한 scope로 제한한다.

## SP 등록과 관리

| 방법 | 누가 | 상태 |
| --- | --- | --- |
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
cp .env.example .env   # MongoDB 정보와 pnpm keys 출력으로 채운다
pnpm dev               # netlify dev, http://localhost:8787
pnpm test
pnpm typecheck
```

화면은 IBM Carbon(`@carbon/styles`)을 쓰는 서버 렌더링이다. 스크립트는 없고, 다크 모드는 `prefers-color-scheme`을 따른다.
스타일 원본은 [src/styles/app.scss](src/styles/app.scss)이고, `pnpm build:css`가 `public/assets/app.css`로 컴파일하고 로고, 파비콘, 오픈그래프 이미지를 `assets/`에서 `public/assets/`로 복사한다. `public/assets/`는 커밋하지 않는다.
`pnpm dev`와 Netlify 빌드는 먼저 CSS를 빌드한다.
MongoDB 인덱스는 처음 연결할 때 코드가 만든다([src/db.ts](src/db.ts)). 따로 마이그레이션할 것은 없다.
테스트는 mongodb-memory-server로 메모리 MongoDB를 띄운다. 처음 실행할 때 mongod 바이너리를 내려받는다.

`DEV_FAKE_LOGIN=true`이면 Google 대신 이메일 입력 화면이 나오고 가짜 학생 정보를 쓴다. `ISSUER`가 localhost일 때만 켤 수 있다.
이때 `admin@ajou.ac.kr`이 관리자로 자동 추가되므로 http://localhost:8787/admin 에 바로 들어갈 수 있다.
내 동의 관리는 http://localhost:8787/consents 에서 같은 가짜 로그인으로 시험한다. 가짜 로그인의 `sub`는 `dev-<email>`이다.

## 구조

```
src/
  server.ts        요청 처리 진입점(플랫폼 무관)
  app.ts           라우트 등록
  env.ts           환경 변수 검증
  db.ts            MongoDB 연결, 컬렉션, 인덱스(사용한 코드와 만료된 동의는 TTL 인덱스로 정리)
  clients.ts       SP 저장소, RFC 7591 메타데이터 검증, 승인 규칙
  consents.ts      기억한 동의(1년)
  initial-access-tokens.ts  등록 토큰
  admin-session.ts 관리 화면 세션(암호화 쿠키)
  account-session.ts  내 동의 관리 세션(암호화 쿠키, 30분)
  audit.ts         감사 로그
  keys.ts          id_token 서명, 쿠키·코드·액세스 토큰 암호화
  google.ts        Google OAuth 클라이언트
  student.ts       mhaksa 조회와 클레임 허용 목록
  scopes.ts        scope 정의
  flow.ts          암호화한 흐름 쿠키(흐름 id별)
  routes/oidc.tsx  discovery, jwks, authorize, token, userinfo
  routes/login.tsx Google 콜백, 동의 화면, 개발용 로그인
  routes/register.ts  RFC 7591/7592
  routes/admin.tsx 관리 화면
  routes/consents.tsx  내 동의 관리
  views.tsx, admin-views.tsx  화면 (Carbon 클래스)
  styles/app.scss  Carbon 스타일과 간격 조정
netlify/functions/idp.mts  Netlify Function. public/의 정적 파일이 없는 경로를 모두 받는다
scripts/           키 생성, CSS 빌드
```

## 라이선스

Copyright (C) 2026 아주대학교 경영대학 소학회 비큐브(B-CUBE)  
Copyright (C) 2026 B-CUBE, School of Business, Ajou University

[GNU Affero General Public License v3.0](LICENSE) 이상(AGPL-3.0-or-later)으로 배포한다. 수정한 코드로 네트워크 서비스를 제공하면 그 서비스 이용자에게 수정한 소스 코드를 공개해야 한다.
안내 페이지(`/`)에 소스 코드 링크가 있다. 주소는 환경 변수 `SOURCE_URL`로 넣는다. 포크해서 운영하면 자기 저장소 주소를 넣는다.
