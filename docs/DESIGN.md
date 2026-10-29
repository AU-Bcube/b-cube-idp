### 기획

- 이 프로젝트는 사용자의 password를 저장하지 않는다.
  - `@ajou.ac.kr`의 구글 oauth를 사용한다.
- `/home/hyeonseungkang/projects/subdomain-lending` 은 b-cube-idp의 SP가 된다.
- 의존성으로 `git@github.com:AU-Bcube/ajou-internal-id-federation.git`를 갖는다.
- `ajou-internal-id-federation` 패키지로 조회한 학생 정보를 SP에 제공할지 동의 화면을 갖는다.
- cloudfalre wrangler로 배포한다.
- `b-cube-idp`는 public repo이다.
- nodejs 기반, pnpm 사용.

| 이 프로젝트를 위한 개발자가 해야 하는 일들을 별도로 `docs/MANUAL.md`에 남겨라.