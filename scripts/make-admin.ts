// #!/usr/bin/env tsx

// import { PrismaClient } from "@/prisma/client";

// const prisma = new PrismaClient();

// interface MakeAdminOptions {
//   email: string;
// }

// async function makeUserAdmin(options: MakeAdminOptions) {
//   const { email } = options;

//   try {
//     // 检查用户是否存在
//     const existingUser = await prisma.user.findUnique({
//       where: { email },
//       select: {
//         id: true,
//         email: true,
//         name: true,
//       },
//     });

//     if (!existingUser) {
//       console.error(`❌ 用户 ${email} 不存在`);
//       console.log("💡 提示: 请先让用户注册账户，然后再提升为管理员");
//       return null;
//     }

//     const adminUser = await prisma.adminUser.upsert({
//       where: { userId: existingUser.id },
//       create: {
//         userId: existingUser.id,
//       },
//       update: {},
//     });

//     console.log(`✅ 用户提升为管理员成功:`);
//     console.log(`   邮箱: ${email}`);

//     return adminUser;
//   } catch (error) {
//     console.error("❌ 提升用户为管理员失败:", error);
//     throw error;
//   }
// }

// async function main() {
//   const args = process.argv.slice(2);

//   if (args.length < 1) {
//     console.log("🔐 提升用户为管理员工具\n");
//     console.log("使用方法: tsx scripts/make-admin.ts <email>");
//     console.log("   或者: pnpm make-admin <email>\n");
//     console.log("示例: tsx scripts/make-admin.ts user@example.com");
//     console.log("     pnpm make-admin user@example.com\n");
//     console.log("📋 说明:");
//     console.log("   - 用户必须已经注册（通过注册页面或管理员面板创建）");
//     console.log("   - 只能提升现有用户的权限");
//     console.log("   - 被封禁的用户无法提升为管理员");
//     process.exit(1);
//   }

//   const [email] = args;

//   if (!email.includes("@")) {
//     console.error("❌ 请提供有效的邮箱地址");
//     process.exit(1);
//   }

//   try {
//     const result = await makeUserAdmin({ email });
//     if (!result) {
//       process.exit(1);
//     }
//   } catch (error) {
//     process.exit(1);
//   } finally {
//     await prisma.$disconnect();
//   }
// }

// if (require.main === module) {
//   main();
// }

// export { makeUserAdmin };
