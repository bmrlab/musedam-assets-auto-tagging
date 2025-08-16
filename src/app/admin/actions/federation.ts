"use server";

import { auth } from "@/app/(auth)/auth";
import { decryptText, encryptText } from "@/lib/cipher";
import prisma from "@/prisma/prisma";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

// 验证管理员权限
async function requireAdmin() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user || session.user.role !== "admin") {
    throw new Error("需要管理员权限");
  }

  return session;
}

// 生成随机ID
function generateId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// MuseDAM联合登录 - 创建登录链接
export async function createMuseDAMLoginLink({
  museDAMUserId,
  museDAMOrgId,
  userInfo,
  orgInfo,
}: {
  museDAMUserId: string;
  museDAMOrgId: string;
  userInfo?: {
    name?: string;
    email?: string;
    role?: string;
    organizationRole?: string;
  };
  orgInfo?: {
    name?: string;
    logo?: string;
  };
}) {
  await requireAdmin();

  try {
    // 创建包含登录信息的JSON
    const loginData = {
      museDAMUserId,
      museDAMOrgId,
      userInfo: userInfo || {},
      orgInfo: orgInfo || {},
      timestamp: Date.now(),
      // 添加10分钟过期时间
      expiresAt: Date.now() + 10 * 60 * 1000,
    };

    // 加密登录数据
    const encryptedData = encryptText(JSON.stringify(loginData));

    // 生成登录链接
    const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
    const loginUrl = `${baseUrl}/admin/federation/login?token=${encryptedData}`;

    return {
      success: true,
      data: {
        loginUrl,
        expiresAt: new Date(loginData.expiresAt).toISOString(),
      },
    };
  } catch (error) {
    console.error("MuseDAM联合登录错误:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "创建登录链接失败",
    };
  }
}

// 处理MuseDAM联合登录
export async function handleMuseDAMLogin(token: string) {
  if (!token) {
    redirect("/login?error=invalid_token");
  }

  // 解密登录数据
  let loginData;
  try {
    const decryptedText = decryptText(token);
    loginData = JSON.parse(decryptedText);
  } catch (error) {
    console.error("解密失败:", error);
    redirect("/login?error=invalid_token");
  }

  // 检查过期时间
  if (Date.now() > loginData.expiresAt) {
    redirect("/login?error=token_expired");
  }

  const { museDAMUserId, museDAMOrgId, userInfo, orgInfo } = loginData;

  const federationEmail = `musedam-user-${museDAMUserId}@federation.local`;
  const federationPassword = process.env.FEDERATION_LOGIN_PASSWORD;
  if (!federationPassword) {
    console.error("FEDERATION_LOGIN_PASSWORD environment variable is not set");
    redirect("/login?error=config_error");
  }

  // 1. 查找或创建MuseDAM组织
  let museDAMOrg = await prisma.museDAMOrganization.findUnique({
    where: { id: museDAMOrgId },
    include: { organization: true },
  });

  if (!museDAMOrg) {
    // 直接数据库创建Organization
    const orgName = orgInfo.name || `MuseDAM组织-${museDAMOrgId}`;
    const orgSlug = `musedam-org-${museDAMOrgId}`;

    const organization = await prisma.organization.create({
      data: {
        id: generateId(),
        name: orgName,
        slug: orgSlug,
        logo: orgInfo.logo || null,
        createdAt: new Date(),
      },
    });

    // 创建MuseDAMOrganization关联
    museDAMOrg = await prisma.museDAMOrganization.create({
      data: {
        id: museDAMOrgId,
        organizationId: organization.id,
      },
      include: { organization: true },
    });
  }

  // 2. 查找或创建MuseDAM用户
  let museDAMUser = await prisma.museDAMUser.findUnique({
    where: { id: museDAMUserId },
    include: { user: true },
  });

  if (!museDAMUser) {
    // 使用Better Auth API创建用户
    const userName = userInfo.name || `MuseDAM用户-${museDAMUserId}`;
    const userEmail = `musedam-user-${museDAMUserId}@federation.local`;

    const createUserResult = await auth.api.signUpEmail({
      body: {
        name: userName,
        email: userEmail,
        password: federationPassword,
      },
      headers: await headers(),
    });

    if (!createUserResult) {
      throw new Error("创建用户失败");
    }

    // 创建MuseDAMUser关联
    museDAMUser = await prisma.museDAMUser.create({
      data: {
        id: museDAMUserId,
        userId: createUserResult.user.id,
      },
      include: { user: true },
    });
  }

  // 3. 确保用户是组织成员
  const existingMembership = await prisma.organizationMembership.findFirst({
    where: {
      userId: museDAMUser.userId,
      organizationId: museDAMOrg.organizationId,
    },
  });

  if (!existingMembership) {
    // 直接数据库添加成员
    await prisma.organizationMembership.create({
      data: {
        id: generateId(),
        userId: museDAMUser.userId,
        organizationId: museDAMOrg.organizationId,
        role: userInfo.organizationRole || "member",
        createdAt: new Date(),
      },
    });
  }

  const result = {
    userId: museDAMUser.userId,
    organizationId: museDAMOrg.organizationId,
  };
  // 5. 使用Better Auth登录
  const loginResult = await auth.api.signInEmail({
    body: {
      email: federationEmail,
      password: federationPassword,
    },
    headers: await headers(),
  });

  if (!loginResult) {
    console.error("Better Auth登录失败");
    redirect("/login?error=login_failed");
  }

  // 6. 使用Better Auth API设置活跃组织
  // try {
  //   await auth.api.setActiveOrganization({
  //     body: {
  //       organizationId: result.organizationId,
  //     },
  //     headers: await headers(),
  //   });
  // } catch (error) {
  //   console.error("设置活跃组织失败:", error);
  //   // 即使设置失败也继续登录流程
  // }

  // 重定向到主页
  redirect("/");
}
