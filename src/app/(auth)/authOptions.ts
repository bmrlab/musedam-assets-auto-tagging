import "server-only";

import { rootLogger } from "@/lib/logging";
import { idToSlug } from "@/lib/slug";
import prisma from "@/prisma/prisma";
import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { createUserAndTeam } from "./lib";
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
        let [user, team] = await Promise.all([
          prisma.user.findUnique({ where: { slug: userSlug }, select: { id: true } }),
          prisma.team.findUnique({ where: { slug: teamSlug }, select: { id: true } }),
        ]);
        if (!user || !team) {
          rootLogger.info(`First time seeing user ${userSlug} for team ${teamSlug}, initializing`);
          ({ user, team } = await createUserAndTeam({
            user: { name: payload.user.name, slug: userSlug },
            team: { id: team?.id, name: payload.team.name, slug: teamSlug },
          }));
        }
        return {
          id: user.id,
          teamId: team.id,
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
        },
        team: {
          ...session.team,
          id: parseInt(token._tid + ""),
        },
      };
    },
    jwt: ({ token, user }) => {
      if (user) {
        return {
          ...token,
          id: parseInt(user.id + ""),
          _tid: parseInt(user.teamId + ""),
        };
      }
      return token;
    },
  },
};

export default authOptions;
