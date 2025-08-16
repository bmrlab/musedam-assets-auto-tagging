"use server";

import { auth } from "@/app/(auth)/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import prisma from "@/prisma/prisma";

// 验证管理员权限
export async function requireAdmin() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user || session.user.role !== "admin") {
    redirect("/login");
  }

  return session;
}

// 重新验证页面缓存（用于客户端操作后刷新）
export async function revalidateAdminPages() {
  await requireAdmin();
  revalidatePath("/admin/organizations");
  revalidatePath("/admin/users");
}

// 检查用户是否有管理员权限（返回布尔值，不重定向）
export async function checkAdminPermission() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    return session?.user?.role === "admin";
  } catch {
    return false;
  }
}

// 直接添加用户到组织（使用Better Auth的addMember API）
export async function addMemberToOrganization(
  organizationId: string,
  userEmail: string,
  role: "owner" | "admin" | "member",
) {
  await requireAdmin();

  try {
    // 查找用户
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
    });

    if (!user) {
      throw new Error("用户不存在");
    }

    // 使用Better Auth的服务端addMember API
    const result = await auth.api.addMember({
      headers: await headers(),
      body: {
        userId: user.id,
        organizationId,
        role,
      },
    });

    revalidatePath("/admin/organizations");
    return { success: true, member: result };
  } catch (error) {
    console.error("添加用户到组织失败:", error);
    throw new Error(
      error instanceof Error ? error.message : "添加用户到组织失败",
    );
  }
}
