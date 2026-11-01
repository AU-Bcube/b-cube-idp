import type { Config } from "@netlify/functions";
import { handle } from "../../src/server";

export default (request: Request) => handle(request, process.env);

// public/의 정적 파일(/assets/*)이 있으면 그 파일을 먼저 준다. 나머지 경로는 모두 이 함수가 받는다.
export const config: Config = {
  path: "/*",
  preferStatic: true,
};
