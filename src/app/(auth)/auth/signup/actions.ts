"use server";
import { createPersonalUser } from "@/app/(auth)/lib";
import { ServerActionResult } from "@/lib/serverAction";
import prisma from "@/prisma/prisma";

export async function signUp({
  email,
  password,
}: {
  email: string;
  password: string;
}): Promise<ServerActionResult<{ id: number; email: string }>> {
  email = email.toLowerCase();

  const exists = await prisma.user.findUnique({
    where: { email },
  });

  if (exists) {
    return {
      success: false,
      message: "User already exists",
    };
  }

  const user = await createPersonalUser({ email, password });

  return {
    success: true,
    data: {
      id: user.id,
      email: user.email,
    },
  };
}
