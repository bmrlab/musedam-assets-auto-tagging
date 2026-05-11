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
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.team.findUnique({ where: { id: teamId } }),
    ]);

    if (!user || !team) {
      return {
        success: false,
        code: "not_found",
        message: "Session user or team no longer exists",
      };
    }

    return {
      success: true,
      data: { user, team },
    };
  });
}
