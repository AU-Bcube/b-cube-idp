import type { AdminSession } from "./admin-session";
import type { Config } from "./env";
import type { Scope } from "./scopes";
import type { MhaksaClaims } from "./student";

export interface HonoEnv {
  Bindings: Env;
  Variables: {
    config: Config;
    /** /admin/* 에서만 설정된다. */
    admin: AdminSession;
    /** /admin/* POST에서 CSRF 검사를 마친 폼 본문 */
    form: Record<string, unknown>;
  };
}

/** /authorize에서 검증을 마친 SP 요청 */
export interface AuthRequest {
  client_id: string;
  redirect_uri: string;
  scopes: Scope[];
  state: string;
  nonce?: string | undefined;
  code_challenge: string;
}

/** 인증을 마치고 동의를 기다리는 사용자. 저장하지 않고 암호화한 흐름 쿠키에만 담는다. */
export interface AuthenticatedUser {
  sub: string;
  email: string;
  name?: string | undefined;
  auth_time: number;
  mhaksa: MhaksaClaims;
}

/**
 * 흐름 쿠키 내용. SP 로그인이면 req, 관리 화면 로그인이면 admin이 있다.
 * Google 로그인 단계에는 google, 동의 단계에는 user와 csrf가 있다.
 */
export interface FlowPayload {
  req?: AuthRequest;
  admin?: true;
  google?: { state: string; nonce: string; verifier: string };
  user?: AuthenticatedUser;
  csrf?: string;
}
