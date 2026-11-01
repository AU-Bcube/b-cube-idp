### 기획

- 이 프로젝트는 사용자의 password를 저장하지 않는다.
  - `@ajou.ac.kr`의 구글 oauth를 사용한다.
- `/home/hyeonseungkang/projects/subdomain-lending` 은 b-cube-idp의 SP가 된다.
- 의존성으로 `git@github.com:AU-Bcube/ajou-internal-id-federation.git`를 갖는다.
- `ajou-internal-id-federation` 패키지로 조회한 학생 정보를 SP에 제공할지 동의 화면을 갖는다.
  - 동의는 동의한 날부터 1년간 저장하고, 그 기한을 동의 화면에 표시한다. 저장 기간에는 같은 SP의 같은 범위 요청에 다시 묻지 않는다.
  - 사용자는 `/consents`에서 SP별로 제공하는 개인정보 항목을 보고 SP별로 동의를 철회할 수 있다.
- 한 브라우저의 여러 탭에서 동시에 로그인할 수 있도록 로그인 흐름 상태는 흐름(탭)마다 따로 둔다.
- Netlify로 배포하고 MongoDB에 저장한다.
- `b-cube-idp`는 public repo이다.
- nodejs 기반, pnpm 사용.

| 이 프로젝트를 위한 개발자가 해야 하는 일들을 별도로 `docs/MANUAL.md`에 남겨라.