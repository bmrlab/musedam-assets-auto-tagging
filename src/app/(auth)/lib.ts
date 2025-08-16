import "server-only";

import { User } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { hash } from "bcryptjs";

export async function createPersonalUser({
  email,
  password,
}: {
  email: string;
  password?: string;
}) {
  email = email.toLowerCase();
  const name = email.split("@")[0];
  const hashedPassword = password ? await hash(password, 10) : "";

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password: _, ...user } = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
    },
  });

  return { ...user, email } as Omit<User, "email"> & { email: string };
}
