/**
 * ajou-internal-id-federation으로 학생 정보를 조회하고 SP에 줄 클레임으로 바꾼다.
 *
 * mhaksa 응답에는 주민등록번호, 비밀번호 해시, 연락처 같은 민감한 열이 함께 온다.
 * 여기서 허용 목록에 있는 열만 골라내고, 나머지는 어디에도 남기지 않는다.
 */
import { Student, type BaseInfo, type SohakoeMembership } from "ajou-internal-id-federation";
import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import type { Config } from "./env";
import type { Scope } from "./scopes";

export interface StudentClaim {
  id: string;
  name?: string;
  college?: string;
  department?: string;
  major?: string;
  grade?: string;
  status?: string;
}

export interface SohakoeClaim {
  name?: string;
  year?: string;
  semester?: string;
  from?: string;
  to?: string;
}

export interface MhaksaClaims {
  student?: StudentClaim;
  sohakoe_memberships?: SohakoeClaim[];
}

/** 학생 정보를 확인할 수 없는 경우. message는 로그용이다. */
export class StudentLookupError extends Error {
  override name = "StudentLookupError";
  constructor(
    readonly reason: "not_found" | "mismatch" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const v = String(value).trim();
  return v === "" ? undefined : v;
}

/** 값이 있는 키만 남긴다. */
function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

export function toStudentClaim(studentId: number, info: BaseInfo): StudentClaim {
  return compact({
    id: String(studentId),
    name: text(info.korNm),
    college: text(info.colgCdNm),
    department: text(info.sustCdNm),
    major: text(info.mjCdNm),
    grade: text(info.shyrCd),
    status: text(info.shregStNm),
  });
}

export function toSohakoeClaim(row: SohakoeMembership): SohakoeClaim {
  return compact({
    name: text(row.unSubmattNm),
    year: text(row.yy),
    semester: text(row.shtmCd),
    from: text(row.unSubmattFrDt),
    to: text(row.unSubmattToDt),
  });
}

export type StudentLookup = (config: Config, email: string, scopes: readonly Scope[]) => Promise<MhaksaClaims>;

let appliedProxyUrl = "";

/**
 * mhaksa 요청에 프록시를 건다. 패키지에 프록시 옵션이 없어, 패키지의 axios.create가 물려받는 기본값에 agent를 넣는다.
 * package.json의 axios가 패키지와 같은 인스턴스로 풀려야 한다. test/mhaksa-proxy.test.ts가 이를 확인한다.
 */
function applyMhaksaProxy(proxyUrl: string): void {
  if (proxyUrl === appliedProxyUrl) return;
  appliedProxyUrl = proxyUrl;
  if (!proxyUrl) {
    delete axios.defaults.httpsAgent;
    delete axios.defaults.proxy;
    return;
  }
  axios.defaults.httpsAgent = proxyUrl.startsWith("socks") ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);
  // axios가 HTTPS_PROXY 환경 변수의 프록시를 agent 위에 겹쳐 쓰지 않게 한다.
  axios.defaults.proxy = false;
}

/**
 * 로그인한 학교 계정의 학생 정보를 조회한다.
 * 이메일 local part를 포털 ID로 쓰고, 조회 결과의 학교 이메일이 로그인 이메일과 같은지 다시 확인한다.
 */
export const lookupStudent: StudentLookup = async (config, email, scopes) => {
  applyMhaksaProxy(config.mhaksaProxyUrl);
  const username = email.slice(0, email.lastIndexOf("@"));
  let student;
  try {
    // 요청 간격은 패키지 기본값을 따른다. 패키지가 모든 조회에 걸쳐 간격을 지킨다.
    student = await new Student().byUsername(username).build();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 패키지는 조회 결과가 없을 때 "no ..." 메시지로 던진다. 그 외는 네트워크나 mhaksa 오류다.
    const reason = /^no /.test(message) ? "not_found" : "unavailable";
    throw new StudentLookupError(reason, `mhaksa 조회 실패 (${username}): ${message}`);
  }

  const { baseInfo, userRole } = student.mhaksa;
  const schoolEmail = text(baseInfo.schEmail)?.toLowerCase();
  if (text(userRole.userId)?.toLowerCase() !== username.toLowerCase() || (schoolEmail && schoolEmail !== email)) {
    throw new StudentLookupError("mismatch", `mhaksa 조회 결과가 로그인 계정과 다름 (${username})`);
  }

  const claims: MhaksaClaims = {};
  if (scopes.includes("student")) claims.student = toStudentClaim(student.studentId, baseInfo);
  if (scopes.includes("sohakoe")) {
    try {
      claims.sohakoe_memberships = (await student.mhaksa.getSohakoeMemberships()).map(toSohakoeClaim);
    } catch (err) {
      throw new StudentLookupError("unavailable", `소학회 조회 실패 (${username}): ${String(err)}`);
    }
  }
  return claims;
};

/** 개발용 가짜 로그인에서 쓰는 조회 결과 */
export const fakeStudentLookup: StudentLookup = async (_config, email, scopes) => {
  const claims: MhaksaClaims = {};
  if (scopes.includes("student")) {
    claims.student = {
      id: "202600001",
      name: `테스트학생 (${email})`,
      college: "소프트웨어융합대학",
      department: "소프트웨어학과",
      grade: "2",
      status: "재학",
    };
  }
  if (scopes.includes("sohakoe")) {
    claims.sohakoe_memberships = [{ name: "B-Cube", year: "2026", semester: "10" }];
  }
  return claims;
};
