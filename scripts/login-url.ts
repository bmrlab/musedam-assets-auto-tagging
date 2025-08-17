import { encryptText } from "@/lib/cipher";

// import PrismaClient 会自动加载 .env，用这种方式来读取环境变量，方便点
import { PrismaClient } from "@/prisma/client";
const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const [musedamUserId, musedamUserName, musedamTeamId, musedamTeamName] = args;

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
