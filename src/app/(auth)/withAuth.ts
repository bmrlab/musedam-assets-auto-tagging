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
    forbidden();
  }
  return action({ user: session.user, team: session.team });
}
