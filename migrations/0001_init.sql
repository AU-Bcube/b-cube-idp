-- 인가 코드는 암호화된 자기 완결형 토큰이다. 한 번만 쓰이도록 사용한 코드의 jti만 기록한다.
-- 학생 정보나 사용자 정보는 저장하지 않는다.
CREATE TABLE used_codes (
  jti TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX used_codes_expires_at ON used_codes (expires_at);
