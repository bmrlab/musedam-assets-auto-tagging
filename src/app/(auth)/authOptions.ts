import "server-only";

import { rootLogger } from "@/lib/logging";
import { idToSlug } from "@/lib/slug";
import prisma from "@/prisma/prisma";
import { getServerSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { checkUserPermission, createUserAndTeam } from "./lib";
import { verifyTokenLoginCredential } from "./tokenLogin";

const authOptions: NextAuthOptions = {
  pages: {
    signIn: "/auth/signin",
  },
  session: {
    strategy: "jwt",
  },
  cookies: {
    sessionToken: {
      name: "next-auth.session-token",
      options: { httpOnly: true, sameSite: "none", path: "/", secure: true },
    },
    callbackUrl: {
      name: "next-auth.callback-url",
      options: { sameSite: "none", path: "/", secure: true },
    },
    csrfToken: {
      name: "next-auth.csrf-token",
      options: { httpOnly: true, sameSite: "none", path: "/", secure: true },
    },
  },
  providers: [
    CredentialsProvider({
      id: "token-login",
      credentials: {
        token: { label: "Token", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.token) {
          throw new Error("TOKEN_REQUIRED");
        }
        // Verify the impersonation login token
        const payload = verifyTokenLoginCredential(credentials.token);
        if (!payload) {
          throw new Error("INVALID_TOKEN");
        }
        const userSlug = idToSlug("user", payload.user.id);
        const teamSlug = idToSlug("team", payload.team.id);
        const session = await getServerSession(authOptions);
        // Check if the user is already logged in and the team is the same
        if (userSlug === session?.user?.slug && teamSlug === session?.team?.slug) {
          return {
            id: session.user.id,
            slug: session.user.slug,
            teamId: session.team.id,
            teamSlug: session.team.slug,
          };
        }
        let [user, team] = await Promise.all([
          prisma.user.findUnique({ where: { slug: userSlug }, select: { id: true, slug: true } }),
          prisma.team.findUnique({ where: { slug: teamSlug }, select: { id: true, slug: true } }),
        ]);
        if (!user || !team) {
          rootLogger.info(`First time seeing user ${userSlug} for team ${teamSlug}, initializing`);
          ({ user, team } = await createUserAndTeam({
            user: { name: payload.user.name, slug: userSlug },
            team: { id: team?.id, name: payload.team.name, slug: teamSlug },
          }));
        }
        try {
          await checkUserPermission({ user, team });
        } catch (error) {
          console.log(error);
          throw error;
        }
        return {
          id: user.id,
          slug: userSlug,
          teamId: team.id,
          teamSlug: teamSlug,
        };
      },
    }),
  ],
  callbacks: {
    session: ({ session, token }) => {
      return {
        ...session,
        user: {
          ...session.user,
          id: parseInt(token.id + ""),
          slug: token.slug,
        },
        team: {
          ...session.team,
          id: parseInt(token.tid + ""),
          slug: token.tslug,
        },
      };
    },
    jwt: ({ token, user }) => {
      if (user) {
        return {
          ...token,
          id: parseInt(user.id + ""),
          slug: user.slug,
          tid: parseInt(user.teamId + ""),
          tslug: user.teamSlug,
        };
      }
      return token;
    },
  },
};

export default authOptions;
