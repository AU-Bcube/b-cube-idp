import type { AccountSession } from "./account-session";
import type { AdminSession } from "./admin-session";
import type { Collections } from "./db";
import type { Config } from "./env";
import type { Scope } from "./scopes";
import type { MhaksaClaims } from "./student";

export interface HonoEnv {
  Bindings: {
    DB: Collections;
    /** Deploy Preview와 브랜치 배포의 주소. 오픈그래프에만 쓴다. OIDC 주소는 미리보기에서도 ISSUER다. */
    previewOrigin?: string;
  };
  Variables: {
    config: Config;
    /** /admin/* 에서만 설정된다. */
    admin: AdminSession;
    /** /consents/* 에서만 설정된다. */
    account: AccountSession;
    /** /admin/*, /consents/* POST에서 CSRF 검사를 마친 폼 본문 */
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
  /** prompt=consent: 기억한 동의가 있어도 동의 화면을 띄운다. */
  prompt_consent?: true | undefined;
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
 * 흐름 쿠키 내용. SP 로그인이면 req, 관리 화면 로그인이면 admin, 동의 관리 화면 로그인이면 account가 있다.
 * Google 로그인 단계에는 google, 동의 단계에는 user와 csrf가 있다.
 */
export interface FlowPayload {
  req?: AuthRequest;
  admin?: true;
  account?: true;
  google?: { state: string; nonce: string; verifier: string };
  user?: AuthenticatedUser;
  csrf?: string;
}
