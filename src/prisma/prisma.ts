import "server-only";

import { Prisma, PrismaClient } from "./client/index";

const log: Prisma.LogLevel[] =
  process.env.LOG_LEVEL?.toLowerCase() === "debug"
    ? ["query", "info", "warn", "error"]
    : ["info", "warn", "error"];

function newPrismaClient() {
  return new PrismaClient({ log });
}

// 开发环境按 PrismaClient 类缓存：instrumentation 与页面是不同的 bundle，各自有一份生成的客户端模块。
// 若共用同一个实例，页面里的 Prisma.AnyNull / Prisma.sql 等与实例不是同一份类，会被当成普通 JSON 参数。
const globalForPrisma = global as unknown as {
  prismaByClient: Map<typeof PrismaClient, ReturnType<typeof newPrismaClient>> | undefined;
};

const prisma = globalForPrisma.prismaByClient?.get(PrismaClient) ?? newPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaByClient ??= new Map();
  globalForPrisma.prismaByClient.set(PrismaClient, prisma);
}

export default prisma;

/*
Prisma 文档有个提醒要注意下：
We recommend using a connection pooler (like Prisma Accelerate) to manage database connections efficiently.
If you choose not to use one, avoid instantiating PrismaClient globally in long-lived environments. Instead, create and dispose of the client per request to prevent exhausting your database connections.
*/
