# IdP 운영 매뉴얼

IdP 운영자(관리자)가 직접 해야 하는 일을 순서대로 적는다. 완료하면 체크한다.
SP 쪽 연동 작업은 SP 개발자에게 [SP_MIGRATION_PROMPT.md](SP_MIGRATION_PROMPT.md)를 넘긴다. 이 문서에는 적지 않는다.

## 0. 먼저 알아둘 것

- 이 저장소는 public이지만 의존성 `ajou-internal-id-federation`은 private 저장소다.
  `pnpm install`은 그 저장소에 접근할 수 있는 GitHub SSH 키가 있어야 성공한다. 외부 기여자는 설치할 수 없다.
- 비밀값(`SIGNING_KEY`, `ENCRYPTION_SECRET`, `GOOGLE_CLIENT_SECRET`, SP의 `client_secret`)은 저장소, 이슈, PR, 채팅에 붙여 넣지 않는다.
  `wrangler secret put`과 로컬 `.dev.vars`(gitignore됨)에만 둔다.
- SP는 모두 D1에 있다. 관리 화면이나 동적 등록(RFC 7591)으로만 만들고, `client_secret`은 IdP가 만들어 한 번만 보여준다.

## 1. 로컬 개발 환경

- [ ] GitHub SSH 키로 `AU-Bcube/ajou-internal-id-federation`에 접근할 수 있는지 확인한다.
- [ ] pnpm은 SSH 주소도 HTTPS로 조회한다. SSH 키로만 접근할 수 있으면 아래 설정을 추가한다.
  ```sh
  git config --global url."git@github.com:".insteadOf "https://github.com/"
  ```
- [ ] `pnpm install`
- [ ] `cp .dev.vars.example .dev.vars` 후 `pnpm keys` 출력의 두 줄(`SIGNING_KEY`, `ENCRYPTION_SECRET`)을 붙여 넣는다.
- [ ] `pnpm db:migrate:local && pnpm dev` 후 http://localhost:8787/.well-known/openid-configuration 이 열리는지 확인한다.
- [ ] 로컬에서 SP 연동을 시험하려면 http://localhost:8787/admin/clients/new 에서 SP를 만든다(`DEV_FAKE_LOGIN=true`이면 바로 들어간다).

## 2. Google OAuth 클라이언트

- [ ] Google Cloud Console에서 프로젝트를 고른다(SP와 같은 프로젝트여도 되지만 OAuth 클라이언트는 따로 만든다).
- [ ] OAuth 동의 화면: User type을 **Internal**로 둔다(ajou.ac.kr Workspace 조직 계정으로 만들어야 고를 수 있다).
  Internal로 만들 수 없으면 External + 테스트 사용자 또는 앱 게시가 필요하다. 이 경우에도 IdP가 `hd=ajou.ac.kr`을 검사하므로 외부 계정은 로그인할 수 없다.
- [ ] scope는 `openid`, `email`, `profile`만 추가한다.
- [ ] 사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션을 만든다.
  - 승인된 리디렉션 URI: `https://id.b-cube.kr/callback/google`
  - 로컬에서 실제 Google 로그인을 시험하려면 `http://localhost:8787/callback/google`도 추가한다.
- [ ] 클라이언트 ID와 비밀번호를 3단계에서 secret으로 넣는다.

## 3. Cloudflare 배포

- [ ] `pnpm wrangler login`
- [ ] D1 생성 후 출력된 `database_id`를 `wrangler.jsonc`의 `d1_databases[0].database_id`에 넣는다.
  ```sh
  pnpm wrangler d1 create b-cube-idp
  pnpm db:migrate:remote
  ```
- [ ] 운영용 키를 새로 만든다. 로컬 키를 재사용하지 않는다.
  ```sh
  pnpm keys
  pnpm wrangler secret put SIGNING_KEY        # pnpm keys 출력의 JSON 한 줄
  pnpm wrangler secret put ENCRYPTION_SECRET
  pnpm wrangler secret put GOOGLE_CLIENT_ID
  pnpm wrangler secret put GOOGLE_CLIENT_SECRET
  pnpm wrangler secret put ADMIN_EMAILS       # 관리자 학교 이메일, 쉼표 구분
  ```
- [ ] 마이그레이션을 추가할 때마다(`migrations/`에 파일이 늘면) 배포 전에 `pnpm db:migrate:remote`를 실행한다.
- [ ] `b-cube.kr` 존이 이 Cloudflare 계정에 있는지 확인한다. `routes`의 custom domain(`id.b-cube.kr`)은 배포할 때 DNS 레코드와 인증서가 자동으로 만들어진다.
- [ ] `pnpm run deploy`
- [ ] https://id.b-cube.kr/health 와 https://id.b-cube.kr/.well-known/openid-configuration 을 확인한다.
  설정 오류가 있으면 모든 요청이 500이고, 원인은 `pnpm wrangler tail`의 `[config]` 로그에 나온다.

## 4. 운영 환경에서 mhaksa 연결 확인

로컬 workerd에서는 mhaksa(`https://mhaksa.ajou.ac.kr:30443`) 조회가 되는 것을 확인했다. Cloudflare 엣지에서는 아직 확인하지 않았다.

- [ ] 배포 후 학생 계정으로 `student` scope를 요청하는 SP 로그인을 한 번 해 본다.
- [ ] "학사 시스템에 연결할 수 없습니다"(502)가 나오면 `pnpm wrangler tail`에서 `[mhaksa] unavailable` 로그를 확인한다.
  - 학교 방화벽이 해외·Cloudflare IP를 막는지, 30443 포트의 TLS 인증서 체인이 완전한지 확인한다.
  - 엣지에서 접근할 수 없으면 국내 프록시를 두거나 조회 부분을 다른 곳으로 옮겨야 한다. 이 경우 담당자와 상의한다.

## 5. 학적 필드 의미 확인

`student`, `sohakoe` 클레임은 mhaksa 열 이름을 보고 고른 것이다. 실제 응답으로 의미를 확인하지 못했다.
[src/student.ts](../src/student.ts)의 `toStudentClaim`, `toSohakoeClaim`을 실제 값과 비교한다.

| 클레임 | mhaksa 열 | 확인할 것 |
| --- | --- | --- |
| `student.name` | `korNm` | 한글 이름인지 |
| `student.college` | `colgCdNm` | 단과대학 이름인지 |
| `student.department` | `sustCdNm` | 학과 이름인지 |
| `student.major` | `mjCdNm` | 전공 이름인지, 비어 있는 경우가 많은지 |
| `student.grade` | `shyrCd` | 학년 숫자인지(코드값이면 `shyrCdNm`으로 바꾼다) |
| `student.status` | `shregStNm` | 재학/휴학 같은 학적 상태 이름인지 |
| `sohakoe_memberships[].name` | `unSubmattNm` | 소학회 이름인지 |
| `sohakoe_memberships[].year`, `semester` | `yy`, `shtmCd` | 연도, 학기 코드인지 |
| `sohakoe_memberships[].from`, `to` | `unSubmattFrDt`, `unSubmattToDt` | 활동 기간인지 |

- [ ] 위 표를 실제 응답으로 확인하고, 다르면 코드와 README의 클레임 표를 고친다.
- [ ] 허용 목록에 열을 더할 때는 민감한 정보(주민등록번호, 연락처, 주소, 사진, 비밀번호 관련 열)가 아닌지 확인한다.
- [ ] 학생이 아닌 계정(교직원 등)은 `student`, `sohakoe` scope 요청 시 "학생 정보를 찾을 수 없습니다"로 막힌다. 이 동작이 맞는지 정한다.

## 6. SP 등록과 관리

SP를 만드는 방법은 두 가지다. 어느 쪽이든 `client_secret`은 화면이나 응답에 한 번만 나오고 IdP에는 해시만 남는다.

| 방법 | 언제 |
| --- | --- |
| 관리 화면에서 추가 | 관리자가 SP 담당자에게 받은 정보로 대신 등록할 때 |
| 동적 등록 (RFC 7591) | SP 개발자가 스스로 등록하고 RFC 7592로 계속 관리할 때 |

관리 화면에서 추가:

- [ ] SP 담당자에게 서비스 이름, redirect_uri 목록, 필요한 scope를 받는다.
- [ ] `/admin/clients/new`에서 SP를 만든다. 관리자가 만든 SP는 바로 활성이고 검토 완료로 표시된다.
- [ ] 화면에 한 번 나오는 `client_id`, `client_secret`을 SP 담당자에게 안전한 경로로 전달한다.

동적 등록:

- [ ] `/admin/tokens`에서 등록 토큰을 발급한다. 용도에 받는 사람을 적고, 사용 횟수는 1, 유효 기간은 짧게 둔다.
- [ ] 토큰을 SP 개발자에게 안전한 경로로 전달한다. 토큰은 화면에 한 번만 나온다. 등록 방법은 SP_MIGRATION_PROMPT.md에 있다.
- [ ] `student`나 `sohakoe`를 요청한 SP는 승인 대기로 `/admin`에 나온다. 내용을 확인하고 승인한다.
- [ ] 학생 정보가 필요 없는 SP(`openid email profile`만)는 바로 쓸 수 있지만 동의 화면에 "검토하지 않은 서비스" 경고가 나온다. 확인했으면 승인해 경고를 없앤다.

승인 전에 확인할 것:

- 서비스 이름이 실제 운영 주체와 맞는지
- `redirect_uris`의 도메인이 그 서비스 것인지. https만 허용되고(localhost는 http 허용) 글자 하나까지 일치해야 한다
- 학생 정보(`student`, `sohakoe`)가 정말 필요한지. 승인한 SP가 RFC 7592로 민감한 scope를 늘리면 다시 승인 대기가 된다

문제가 생겼을 때:

- 문제가 생긴 SP는 `/admin`에서 바로 중지한다. 중지하면 새 로그인과 토큰 교환이 모두 막힌다.
- `client_secret`이 유출되면 SP 상세에서 재발급한다. 이전 값은 바로 무효가 되므로 SP 담당자가 곧바로 바꿔야 한다.

할 일:

- [ ] subdomain-lending(`domain.b-cube.kr`)을 관리 화면에서 등록한다. redirect_uri는 `https://domain.b-cube.kr/auth/callback`,
  scope는 `openid email profile student`. `client_id`, `client_secret`과 SP_MIGRATION_PROMPT.md를 담당자에게 전달한다.

## 7. 정기 작업

- [ ] **ajou-internal-id-federation 버전 올리기**: 새 커밋 해시로 `pnpm-workspace.yaml`의 `allowBuilds` 키와 `package.json`의 의존성을 함께 바꾼다.
  ```sh
  pnpm add git+ssh://git@github.com/AU-Bcube/ajou-internal-id-federation.git#<새 커밋 해시>
  ```
  허용 키가 틀리면 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`가 나오고, 메시지에 정확한 키가 있다.
- [ ] **서명 키 교체**(유출이 의심될 때): `pnpm keys`로 새 `SIGNING_KEY`를 만들어 `wrangler secret put` 한다.
  토큰 수명이 5분이고 SP는 id_token을 받자마자 검증하므로, 교체 순간 진행 중이던 로그인 몇 건만 실패한다.
  SP는 새 `kid`를 만나면 JWKS를 다시 받아야 한다. 교체 전에 SP 담당자에게 알린다.
- [ ] **암호화 키 교체**: `ENCRYPTION_SECRET`을 바꾸면 진행 중인 로그인(최대 10분)과 발급된 access_token(최대 5분)이 무효가 된다.
- [ ] **SP client_secret 교체**: SP 담당자와 시간을 맞춰 SP 상세에서 재발급하고 바로 전달한다. 담당자가 바꿀 때까지 그 SP 로그인이 실패하므로 사용이 적은 시간에 한다.
- [ ] **관리자 바꾸기**: `pnpm wrangler secret put ADMIN_EMAILS`. 목록에서 빠진 관리자는 이미 열린 세션도 다음 요청부터 막힌다.
- [ ] **감사 로그 확인**: `/admin/audit`에서 SP 등록·변경을 주기적으로 본다. 감사 로그는 지우지 않으므로 오래 쌓이면 D1에서 직접 정리한다.

## 8. 남아 있는 제한

- 동의 기록을 저장하지 않으므로 로그인할 때마다 동의 화면이 나온다.
- 로그아웃 엔드포인트가 없다. IdP는 자체 세션을 만들지 않으므로 SP 세션만 끊으면 된다. 다만 Google 세션은 남는다.
- mhaksa 조회는 요청 사이에 `MHAKSA_INTERVAL_MS`(기본 3000ms)를 기다린다. `student` scope는 약 3초, `sohakoe`까지 요청하면 약 6초가 로그인에 더해진다.
- 화면은 IBM Plex Sans KR과 D2Coding을 jsDelivr에서 받는다. jsDelivr에 접근할 수 없으면 시스템 글꼴로 표시된다. 동작에는 영향이 없다.
- 동적 SP의 client_secret은 만료되지 않는다(`client_secret_expires_at: 0`).
- 동시에 두 탭에서 로그인하면 흐름 쿠키가 하나라 먼저 시작한 쪽이 "로그인 요청이 만료" 오류를 낸다.
