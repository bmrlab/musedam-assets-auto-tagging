import "server-only";

import { Prisma, PrismaClient } from "./client";

const log: Prisma.LogLevel[] =
  process.env.LOG_LEVEL?.toLowerCase() === "debug"
    ? ["query", "info", "warn", "error"]
    : ["info", "warn", "error"];

function newPrismaClient() {
  return new PrismaClient({ log });
}

const globalForPrisma = global as unknown as {
  prisma: ReturnType<typeof newPrismaClient> | undefined;
};

const prisma = globalForPrisma.prisma || newPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;

/*
Prisma 文档有个提醒要注意下：
We recommend using a connection pooler (like Prisma Accelerate) to manage database connections efficiently.
If you choose not to use one, avoid instantiating PrismaClient globally in long-lived environments. Instead, create and dispose of the client per request to prevent exhausting your database connections.
*/
