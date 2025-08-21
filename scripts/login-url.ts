import { encryptText } from "@/lib/cipher";
import { loadEnvConfig } from "@next/env";

// import PrismaClient 会自动加载 .env，用这种方式来读取环境变量，方便点
// import { PrismaClient } from "@/prisma/client";
// const prisma = new PrismaClient();

async function main() {
  // load env config from .env file
  loadEnvConfig(process.cwd());
  const args = process.argv.slice(2);
  let [musedamUserId, musedamUserName, musedamTeamId, musedamTeamName] = args;

  if (!musedamUserId || !musedamUserName || !musedamTeamId || !musedamTeamName) {
    console.log("ℹ️ 未提供参数，使用默认值");
    console.log("用法: tsx scripts/generate-auth-token.ts <userId> <userName> <teamId> <teamName>");
    console.log("示例: tsx scripts/generate-auth-token.ts user123 'John Doe' team456 'My Team'");
    [musedamUserId, musedamUserName, musedamTeamId, musedamTeamName] = [
      "test-user-id",
      "Test User",
      "test-team-id",
      "Test Team",
    ];
  }

  const now = Date.now();
  const expiresAt = now + 24 * 60 * 60 * 1000; // Convert hours to milliseconds

  const payload = {
    user: {
      id: musedamUserId,
      name: musedamUserName,
    },
    team: {
      id: musedamTeamId,
      name: musedamTeamName,
    },
    timestamp: now,
    expiresAt,
  };

  const token = encryptText(JSON.stringify(payload));
  console.log(`http://localhost:3000/auth/${encodeURIComponent(token)}`);
}

if (require.main === module) {
  main();
}
