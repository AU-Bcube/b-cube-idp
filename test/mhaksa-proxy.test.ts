/**
 * MHAKSA_PROXY_URL이 패키지의 실제 요청에 적용되는지 확인한다.
 * 패키지와 앱의 axios 인스턴스가 갈라지면 프록시 없이 직접 연결되므로, nock 대신 로컬 프록시 서버로 받아 본다.
 */
import { createServer, type Server, type Socket } from "node:net";
import nock from "nock";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, parseConfig, type Config } from "../src/env";
import { lookupStudent, StudentLookupError } from "../src/student";

const MHAKSA_TARGET = "mhaksa.ajou.ac.kr:30443";

const servers: Server[] = [];

/** 임의 포트에서 프록시 서버를 띄우고 포트를 돌려준다. */
async function listen(onConnection: (socket: Socket) => void): Promise<number> {
  const server = createServer(onConnection);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}

/** CONNECT 요청을 기록하고 거절하는 HTTP 프록시 */
function httpProxy(requests: string[]): Promise<number> {
  return listen((socket) => {
    socket.once("data", (chunk) => {
      requests.push(chunk.toString());
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    });
  });
}

/** 인증 없이 인사를 받고, 연결 대상을 기록한 뒤 거절하는 SOCKS5 프록시 */
function socksProxy(targets: string[]): Promise<number> {
  return listen((socket) => {
    socket.once("data", () => {
      socket.write(Buffer.from([5, 0]));
      socket.once("data", (req) => {
        const hostLength = req[4]!;
        targets.push(`${req.subarray(5, 5 + hostLength).toString()}:${req.readUInt16BE(5 + hostLength)}`);
        socket.end(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 0]));
      });
    });
  });
}

function configWith(proxyUrl: string): Config {
  return parseConfig({ ...process.env, MHAKSA_PROXY_URL: proxyUrl });
}

async function expectUnavailable(config: Config) {
  const err = await lookupStudent(config, "hong@ajou.ac.kr", ["student"]).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(StudentLookupError);
  expect((err as StudentLookupError).reason).toBe("unavailable");
}

describe("mhaksa 프록시", () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
  });

  it("http 프록시로 mhaksa에 CONNECT한다", async () => {
    const requests: string[] = [];
    const port = await httpProxy(requests);
    await expectUnavailable(configWith(`http://user:p%40ss@127.0.0.1:${port}`));
    expect(requests[0]).toContain(`CONNECT ${MHAKSA_TARGET} HTTP/1.1`);
    expect(requests[0]).toContain(`Basic ${Buffer.from("user:p@ss").toString("base64")}`);
  });

  it("socks5h 프록시로 mhaksa에 연결한다", async () => {
    const targets: string[] = [];
    const port = await socksProxy(targets);
    await expectUnavailable(configWith(`socks5h://127.0.0.1:${port}`));
    expect(targets).toEqual([MHAKSA_TARGET]);
  });
});

describe("mhaksa 요청 로그", () => {
  const FIND_USER = "/com/com/cmmn/user/findUser.action";

  /** 조회를 한 번 하고 그동안 남은 로그를 한 줄씩 돌려준다. */
  async function logsOf(config: Config): Promise<string[]> {
    const lines: string[] = [];
    const record = (...args: unknown[]) => void lines.push(args.join(" "));
    const info = vi.spyOn(console, "info").mockImplementation(record);
    const warn = vi.spyOn(console, "warn").mockImplementation(record);
    await lookupStudent(config, "hong@ajou.ac.kr", ["student"]).catch(() => undefined);
    info.mockRestore();
    warn.mockRestore();
    return lines;
  }

  afterEach(async () => {
    nock.cleanAll();
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
  });

  it("응답을 받으면 기능 경로와 상태를 남기고 포털 ID는 남기지 않는다", async () => {
    nock("https://mhaksa.ajou.ac.kr:30443").post("/nt/cvt.do").reply(200, { secret: "응답값" });
    const lines = await logsOf(configWith(""));
    expect(lines[0]).toBe(`[mhaksa] 요청 시작 ${FIND_USER} 직접 연결`);
    expect(lines[1]).toMatch(new RegExp(`^\\[mhaksa\\] 요청 완료 ${FIND_USER} HTTP 200 \\d+ms$`));
    expect(lines.join("\n")).not.toContain("hong");
    expect(lines.join("\n")).not.toContain("응답값");
  });

  it("실패해도 남기고 프록시 계정은 남기지 않는다", async () => {
    const port = await httpProxy([]);
    const lines = await logsOf(configWith(`http://user:hunter2@127.0.0.1:${port}`));
    expect(lines[0]).toBe(`[mhaksa] 요청 시작 ${FIND_USER} 프록시`);
    expect(lines[1]).toMatch(new RegExp(`^\\[mhaksa\\] 요청 실패 ${FIND_USER} .+ \\d+ms$`));
    expect(lines.join("\n")).not.toContain("hunter2");
    expect(lines.join("\n")).not.toContain("hong");
  });
});

describe("MHAKSA_PROXY_URL 설정", () => {
  it("비어 있으면 직접 연결한다", () => {
    expect(configWith("  ").mhaksaProxyUrl).toBe("");
  });

  it("지원하지 않는 주소는 값을 드러내지 않고 거절한다", () => {
    for (const value of ["ftp://user:hunter2@proxy:21", "user:hunter2@proxy:8080", "http://"]) {
      let err: unknown;
      try {
        configWith(value);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).message).toContain("MHAKSA_PROXY_URL");
      expect((err as ConfigError).message).not.toContain("hunter2");
    }
  });
});
