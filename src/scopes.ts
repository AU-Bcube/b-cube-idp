/**
 * scope 정의. SP가 받을 수 있는 정보는 여기 나열한 클레임뿐이다.
 */
export const SCOPES = ["openid", "email", "profile", "student", "sohakoe"] as const;
export type Scope = (typeof SCOPES)[number];

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

/** 동의 화면에 보여줄 이름. openid는 로그인 자체라 따로 묻지 않는다. */
export const SCOPE_LABELS: Record<Exclude<Scope, "openid">, string> = {
  email: "이메일 주소",
  profile: "Google 계정 이름",
  student: "학적 정보 (학번, 이름, 소속, 학년, 학적 상태)",
  sohakoe: "소학회 가입 내역",
};

/** mhaksa 조회가 필요한 scope */
export const MHAKSA_SCOPES: ReadonlySet<Scope> = new Set(["student", "sohakoe"]);

export const CLAIMS_SUPPORTED = [
  "sub",
  "iss",
  "aud",
  "exp",
  "iat",
  "auth_time",
  "nonce",
  "email",
  "email_verified",
  "name",
  "student",
  "sohakoe_memberships",
] as const;

/** scope 문자열을 공백으로 나눠 알려진 값만 순서대로 남긴다. */
export function parseScopes(raw: string | undefined): Scope[] {
  const seen = new Set<Scope>();
  for (const s of (raw ?? "").split(" ")) {
    if (isScope(s)) seen.add(s);
  }
  return SCOPES.filter((s) => seen.has(s));
}
