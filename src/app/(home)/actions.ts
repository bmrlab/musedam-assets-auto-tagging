"use server";
import { withAuth } from "@/app/(auth)/withAuth";
import { ServerActionResult } from "@/lib/serverAction";
import { Team, User } from "@/prisma/client";
import prisma from "@/prisma/prisma";

export async function fetchUserAndTeam(): Promise<
  ServerActionResult<{
    user: User;
    team: Team;
  }>
> {
  return withAuth(async ({ user: { id: userId }, team: { id: teamId } }) => {
    const [user, team] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.team.findUniqueOrThrow({ where: { id: teamId } }),
    ]);
    return {
      success: true,
      data: { user, team },
    };
  });
}
