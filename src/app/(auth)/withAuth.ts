import "server-only";

import authOptions from "@/app/(auth)/authOptions";
import { Session } from "next-auth";
import { getServerSession } from "next-auth/next";
import { forbidden } from "next/navigation";

export async function withAuth<T>(
  action: (args: {
    user: NonNullable<Session["user"]>;
    team: NonNullable<Session["team"]>;
  }) => Promise<T>,
): Promise<T> {
  const session = await getServerSession(authOptions);
  if (!session?.user || !session?.team) {
    console.log("withAuth: session check", {
      hasSession: !!session,
      hasUser: !!session?.user,
      hasTeam: !!session?.team,
      userId: session?.user?.id,
      teamId: session?.team?.id,
    });
    console.error("withAuth: 认证失败，缺少 user 或 team");
    forbidden();
  }
  return action({ user: session.user, team: session.team });
}
