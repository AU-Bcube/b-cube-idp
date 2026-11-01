import { MongoMemoryServer } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

// 처음 실행할 때 mongod 바이너리를 내려받는다(~/.cache/mongodb-binaries).
export default async function setup(project: TestProject) {
  const server = await MongoMemoryServer.create();
  project.provide("mongoUri", server.getUri());
  return () => server.stop();
}
