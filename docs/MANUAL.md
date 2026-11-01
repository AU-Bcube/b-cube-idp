# IdP 운영 매뉴얼

IdP 운영자(관리자)가 직접 해야 하는 일을 순서대로 적는다. 완료하면 체크한다.
SP 쪽 연동 작업은 SP 개발자에게 [SP_MIGRATION_PROMPT.md](SP_MIGRATION_PROMPT.md)를 넘긴다. 이 문서에는 적지 않는다.

## 0. 먼저 알아둘 것

- 이 저장소는 public이지만 의존성 `ajou-internal-id-federation`은 private 저장소다.
  `pnpm install`은 그 저장소에 접근할 수 있는 GitHub SSH 키가 있어야 성공한다. 외부 기여자는 설치할 수 없다.
- 비밀값(`SIGNING_KEY`, `ENCRYPTION_SECRET`, `GOOGLE_CLIENT_SECRET`, SP의 `client_secret`)은 저장소, 이슈, PR, 채팅에 붙여 넣지 않는다.
  Netlify 사이트 환경 변수와 로컬 `.env`(gitignore됨)에만 둔다.
- SP는 모두 MongoDB에 있다. 관리 화면이나 동적 등록(RFC 7591)으로만 만들고, `client_secret`은 IdP가 만들어 한 번만 보여준다.
- 사용자의 동의 기록(Google `sub`, SP, 동의한 scope, 동의한 날, 기한)이 MongoDB `consents` 컬렉션에 1년간 남는다.
  학생 정보 값은 저장하지 않는다. 사용자는 `/consents`에서 직접 동의를 확인하고 철회한다(8단계).

## 1. 로컬 개발 환경

- [ ] GitHub SSH 키로 `AU-Bcube/ajou-internal-id-federation`에 접근할 수 있는지 확인한다.
- [ ] pnpm은 SSH 주소도 HTTPS로 조회한다. SSH 키로만 접근할 수 있으면 아래 설정을 추가한다.
  ```sh
  git config --global url."git@github.com:".insteadOf "https://github.com/"
  ```
- [ ] pnpm 12.16.1을 쓴다(`pnpm --version`). lockfile 형식이 pnpm 버전에 묶여 있어 다른 메이저 버전은 lockfile을 읽지 못하거나 다시 쓴다.
- [ ] `pnpm install`
- [ ] `cp .env.example .env` 후 개발용 MongoDB의 `DB_CONNECTION_STRING`, `DB_NAME`과 `pnpm keys` 출력의 두 줄(`SIGNING_KEY`, `ENCRYPTION_SECRET`)을 넣는다.
  운영 DB를 로컬에서 쓰지 않는다. DB 이름만 달라도 된다.
- [ ] `pnpm dev`(netlify dev) 후 http://localhost:8787/.well-known/openid-configuration 과 http://localhost:8787/health 가 열리는지 확인한다.
- [ ] 로컬에서 SP 연동을 시험하려면 http://localhost:8787/admin/clients/new 에서 SP를 만든다(`DEV_FAKE_LOGIN=true`이면 바로 들어간다).
- [ ] SP로 한 번 로그인해 동의한 뒤 http://localhost:8787/consents 에서 그 SP가 보이고 철회되는지 확인한다.

## 2. Google OAuth 클라이언트

- [ ] Google Cloud Console에서 프로젝트를 고른다(SP와 같은 프로젝트여도 되지만 OAuth 클라이언트는 따로 만든다).
- [ ] OAuth 동의 화면: User type을 **Internal**로 둔다(ajou.ac.kr Workspace 조직 계정으로 만들어야 고를 수 있다).
  Internal로 만들 수 없으면 External + 테스트 사용자 또는 앱 게시가 필요하다. 이 경우에도 IdP가 `hd=ajou.ac.kr`을 검사하므로 외부 계정은 로그인할 수 없다.
- [ ] scope는 `openid`, `email`, `profile`만 추가한다.
- [ ] 사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션을 만든다.
  - 승인된 리디렉션 URI: `https://id.b-cube.kr/callback/google`
  - 로컬에서 실제 Google 로그인을 시험하려면 `http://localhost:8787/callback/google`도 추가한다.
- [ ] 클라이언트 ID와 비밀번호를 4단계에서 환경 변수로 넣는다.

## 3. MongoDB

- [ ] 운영용 MongoDB(예: MongoDB Atlas)를 만들고, IdP 전용 DB 사용자를 둔다. 권한은 IdP DB 하나의 readWrite만 준다.
- [ ] Netlify Functions는 고정 IP가 없다. Atlas라면 Network Access에서 `0.0.0.0/0`을 열어야 하므로 DB 사용자 비밀번호를 길게 만든다.
- [ ] 연결 문자열(`mongodb+srv://...`)과 DB 이름을 4단계에서 환경 변수로 넣는다.
- 컬렉션과 인덱스는 IdP가 처음 연결할 때 만든다([src/db.ts](../src/db.ts)). 사용한 인가 코드 기록(`used_codes`)과 만료된 동의(`consents`)는 TTL 인덱스가 지우므로 정리 작업이 없다.

## 4. Netlify 배포

- [ ] Netlify에서 이 저장소를 연결해 사이트를 만든다. 빌드 설정은 [netlify.toml](../netlify.toml)을 따른다(빌드 `pnpm build:css`, 배포 폴더 `public`, 함수 `netlify/functions`).
  pnpm 버전도 `netlify.toml`의 `PNPM_VERSION`(12.16.1)으로 고정한다. 빠지면 Netlify 기본 pnpm 10이 설치 단계에서
  `ERR_PNPM_BROKEN_LOCKFILE`(문서가 둘인 lockfile)이나 `ERR_PNPM_INVALID_VERSION_UNION`(`allowBuilds`의 git 의존성 키)으로 실패한다.
- [ ] private 의존성 `ajou-internal-id-federation`을 설치할 수 있게 한다. 빌드가 의존성을 먼저 설치하므로 빌드 명령으로는 해결할 수 없다.
  1. GitHub fine-grained PAT를 만든다. Resource owner `AU-Bcube`, 저장소는 `ajou-internal-id-federation`만, 권한은 Contents read-only.
  2. Netlify 사이트 환경 변수에 아래 세 개를 넣는다. 범위(scope)는 **Builds**만, 토큰이 든 값은 secret으로 표시한다.
     git이 이 변수를 설정으로 읽어 의존성 주소에 토큰을 붙인다. 토큰은 저장소에 남지 않는다.
     | 이름 | 값 |
     | --- | --- |
     | `GIT_CONFIG_COUNT` | `1` |
     | `GIT_CONFIG_KEY_0` | `url.https://x-access-token:<PAT>@github.com/AU-Bcube/ajou-internal-id-federation.insteadOf` |
     | `GIT_CONFIG_VALUE_0` | `https://github.com/AU-Bcube/ajou-internal-id-federation` |
  3. PAT 만료일을 기록해 두고 만료 전에 바꾼다.
- [ ] 운영용 키를 새로 만든다. 로컬 키를 재사용하지 않는다(`pnpm keys`).
- [ ] Netlify 사이트 환경 변수에 아래 값을 넣는다. 범위는 **Functions**를 포함해야 한다. `netlify.toml`에 적은 값은 함수에 전달되지 않는다.
  | 이름 | 값 |
  | --- | --- |
  | `ISSUER` | `https://id.b-cube.kr` |
  | `DB_CONNECTION_STRING`, `DB_NAME` | 3단계의 값 (secret) |
  | `SIGNING_KEY` | `pnpm keys` 출력의 JSON 한 줄 (secret) |
  | `ENCRYPTION_SECRET` | `pnpm keys` 출력 (secret) |
  | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 2단계의 값 (secret) |
  | `ADMIN_EMAILS` | 관리자 학교 이메일, 쉼표 구분 |
  | `ALLOWED_EMAIL_DOMAIN` | 선택. 기본값 `ajou.ac.kr` |
- [ ] Domain management에서 `id.b-cube.kr`을 custom domain으로 추가하고, `b-cube.kr` DNS에 Netlify가 안내하는 CNAME을 만든다. HTTPS 인증서는 Netlify가 발급한다.
- [ ] 배포한 뒤 https://id.b-cube.kr/health 와 https://id.b-cube.kr/.well-known/openid-configuration 을 확인한다.
  https://id.b-cube.kr 에 안내 페이지가 나오고, https://id.b-cube.kr/consents 가 Google 로그인으로 넘어가는지도 확인한다.
  설정 오류가 있으면 모든 요청이 500이고, 원인은 Netlify의 함수 로그(Logs → Functions → `idp`)에 `[config]`로 나온다.

## 5. 운영 환경에서 mhaksa 연결 확인

로컬에서는 mhaksa(`https://mhaksa.ajou.ac.kr:30443`) 조회가 되는 것을 확인했다. Netlify Functions에서는 아직 확인하지 않았다.
Netlify Functions는 기본으로 미국 동부(Ohio) 리전에서 실행된다.

- [ ] 배포 후 학생 계정으로 `student` scope를 요청하는 SP 로그인을 한 번 해 본다.
- [ ] "학사 시스템에 연결할 수 없습니다"(502)가 나오면 Netlify 함수 로그에서 `[mhaksa] unavailable` 로그를 확인한다.
  - 학교 방화벽이 해외 IP를 막는지, 30443 포트의 TLS 인증서 체인이 완전한지 확인한다.
  - 함수 리전을 국내와 가까운 곳으로 바꿀 수 있는지 Netlify 설정(Functions → Region)을 확인한다.
  - 그래도 접근할 수 없으면 국내 프록시를 두거나 조회 부분을 다른 곳으로 옮겨야 한다. 이 경우 담당자와 상의한다.

## 6. 학적 필드 의미 확인

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

## 7. SP 등록과 관리

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

## 8. 사용자 동의 관리

사용자는 SP에 정보를 제공하기로 한 동의를 **https://id.b-cube.kr/consents** 에서 직접 확인하고 SP별로 철회한다.
https://id.b-cube.kr 첫 화면(안내 페이지)의 버튼과 동의 화면 하단의 링크도 같은 곳으로 간다. 사용 방법은 [README의 내 동의 확인과 철회](../README.md#내-동의-확인과-철회)에 있다.

- [ ] B-CUBE 공지, 개인정보 처리 안내 등 사용자가 보는 곳에 동의 확인·철회 주소(`https://id.b-cube.kr/consents`)를 알린다.
  기억하기 쉽게 `https://id.b-cube.kr`만 알려도 된다.
- [ ] SP 담당자에게 서비스의 개인정보 안내나 계정 화면에 같은 주소를 링크하도록 안내한다(SP_MIGRATION_PROMPT.md에 들어 있다).

동작:

- 동의는 동의한 날부터 1년간 저장되고, 그동안 같은 SP가 동의한 범위 안에서 요청하면 동의 화면을 생략한다. 기한은 동의 화면에 표시된다.
- SP가 더 넓은 scope를 요청하거나 기한이 지나면 다시 묻는다. 다시 동의하면 기한이 그날부터 1년으로 늘어난다.
- 철회하면 다음 로그인 때 다시 묻는다. 이미 SP에 전달된 정보는 IdP가 지울 수 없다.
- SP가 `prompt=consent`로 다시 물을 때 사용자가 거부해도 그 SP의 동의가 지워진다.
- 동의 기록은 감사 로그에 남기지 않는다. 만료된 기록은 TTL 인덱스가 지운다.

문의가 왔을 때:

- "동의를 철회하고 싶다": `/consents` 주소를 안내한다. 사용자가 직접 할 수 있다.
- "이미 넘어간 정보를 지워 달라": 해당 SP 담당자에게 넘긴다. IdP에는 학생 정보 값이 남아 있지 않다.
- 사용자가 직접 할 수 없는 사정이면 MongoDB `consents` 컬렉션에서 그 사용자(`sub`)와 SP(`client_id`)의 문서를 지운다.
  관리 화면에는 동의 기록을 보는 기능이 없다.
- SP를 삭제해도 그 SP에 대한 동의 기록은 기한까지 남고, 내 동의 관리에는 "삭제된 서비스 (client_id)"로 나온다. 사용자가 철회할 수 있다.

## 9. 정기 작업

- [ ] **ajou-internal-id-federation 버전 올리기**: 새 커밋 해시로 `pnpm-workspace.yaml`의 `allowBuilds` 키와 `package.json`의 의존성을 함께 바꾼다.
  ```sh
  pnpm add git+ssh://git@github.com/AU-Bcube/ajou-internal-id-federation.git#<새 커밋 해시>
  ```
  허용 키가 틀리면 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`가 나오고, 메시지에 정확한 키가 있다.
- [ ] **pnpm 버전 올리기**: 로컬 pnpm을 올려 lockfile을 다시 만들면 `netlify.toml`의 `PNPM_VERSION`도 같은 버전으로 바꾼다.
- [ ] **`ERR_PNPM_IGNORED_BUILDS`가 나오면**: 메시지에 나온 패키지의 install 스크립트를 확인하고 `pnpm-workspace.yaml`의 `allowBuilds`에 `true`/`false`로 적는다.
  `@carbon/*`, `@ibm/plex*`의 postinstall은 IBM 텔레메트리 전송(`ibmtelemetry`)뿐이라 `false`로 두었다. Carbon을 올려 패키지가 늘면 같은 방식으로 더한다.
- [ ] **서명 키 교체**(유출이 의심될 때): `pnpm keys`로 새 `SIGNING_KEY`를 만들어 Netlify 환경 변수를 바꾸고 다시 배포한다.
  환경 변수는 다시 배포해야 함수에 반영된다.
  토큰 수명이 5분이고 SP는 id_token을 받자마자 검증하므로, 교체 순간 진행 중이던 로그인 몇 건만 실패한다.
  SP는 새 `kid`를 만나면 JWKS를 다시 받아야 한다. 교체 전에 SP 담당자에게 알린다.
- [ ] **GitHub PAT 교체**: 4단계의 `GIT_CONFIG_KEY_0`에 든 PAT가 만료되기 전에 새 PAT로 바꾼다. 만료되면 빌드가 의존성 설치에서 실패한다.
- [ ] **암호화 키 교체**: `ENCRYPTION_SECRET`을 바꾸면 진행 중인 로그인(최대 10분), 발급된 access_token(최대 5분),
  관리 화면 세션, 내 동의 관리 세션(최대 30분)이 무효가 된다. 저장된 동의는 영향이 없다.
- [ ] **SP client_secret 교체**: SP 담당자와 시간을 맞춰 SP 상세에서 재발급하고 바로 전달한다. 담당자가 바꿀 때까지 그 SP 로그인이 실패하므로 사용이 적은 시간에 한다.
- [ ] **관리자 바꾸기**: Netlify 환경 변수 `ADMIN_EMAILS`를 바꾸고 다시 배포한다. 목록에서 빠진 관리자는 이미 열린 세션도 다음 요청부터 막힌다.
- [ ] **감사 로그 확인**: `/admin/audit`에서 SP 등록·변경을 주기적으로 본다. 감사 로그는 지우지 않으므로 오래 쌓이면 MongoDB `audit_logs` 컬렉션에서 직접 정리한다.

## 10. 남아 있는 제한

- 로그아웃 엔드포인트가 없다. IdP는 자체 세션을 만들지 않으므로 SP 세션만 끊으면 된다. 다만 Google 세션은 남는다.
- Netlify 함수 인스턴스가 새로 뜨면(cold start) MongoDB 연결 시간이 그 요청에 더해진다.
- mhaksa 요청 간격은 IdP가 정하지 않고 `ajou-internal-id-federation`의 기본값(현재 1000ms)을 따른다. `student` scope는 약 1초, `sohakoe`까지 요청하면 약 2초가 로그인에 더해진다.
  간격은 함수 인스턴스 안의 모든 요청이 공유한다. 같은 인스턴스에서 직전 로그인의 mhaksa 조회가 끝난 지 1초가 안 됐으면 남은 시간만큼 더 기다린다.
  패키지를 올릴 때 기본 간격이 바뀌었는지 확인한다.
- 화면은 IBM Plex Sans KR과 D2Coding을 jsDelivr에서 받는다. jsDelivr에 접근할 수 없으면 시스템 글꼴로 표시된다. 동작에는 영향이 없다.
- 동적 SP의 client_secret은 만료되지 않는다(`client_secret_expires_at: 0`).
- 내 동의 관리(`/consents`)에서 철회해도 이미 SP에 전달한 정보는 지워지지 않는다. 삭제는 각 SP가 처리해야 한다.
- 관리 화면에서 사용자의 동의 기록을 보거나 지울 수 없다. 필요하면 MongoDB `consents` 컬렉션에서 직접 처리한다.
- 한 브라우저에서 동시에 진행할 수 있는 로그인은 5개다. 6번째를 시작하면 가장 먼저 시작한 흐름이 "로그인 요청이 만료" 오류를 낸다.
