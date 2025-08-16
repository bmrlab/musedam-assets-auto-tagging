import { encryptText } from "@/lib/cipher";
import { PrismaClient } from "@/prisma/client";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const [musedamUserId, musedamTeamId] = args;

  const now = Date.now();
  const expiresAt = now + 24 * 60 * 60 * 1000; // Convert hours to milliseconds

  const payload = {
    musedamUserId,
    musedamTeamId,
    timestamp: now,
    expiresAt,
  };

  const token = encryptText(JSON.stringify(payload));
  console.log(`http://localhost:3000/auth/impersonation-login?token=${encodeURIComponent(token)}`);
}

if (require.main === module) {
  main();
}
