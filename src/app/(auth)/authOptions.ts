import "server-only";

import prisma from "@/prisma/prisma";
import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
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
        const userSlug = `u/${payload.user.id}`;
        const user = await prisma.user.upsert({
          where: { slug: userSlug },
          create: {
            name: payload.user.name,
            slug: userSlug,
          },
          update: {
            name: payload.user.name,
          },
        });
        const teamSlug = `t/${payload.team.id}`;
        const team = await prisma.team.upsert({
          where: { slug: teamSlug },
          create: {
            name: payload.team.name,
            slug: teamSlug,
          },
          update: {
            name: payload.team.name,
          },
        });
        prisma.membership.upsert({
          where: {
            userId_teamId: {
              userId: user.id,
              teamId: team.id,
            },
          },
          create: {
            userId: user.id,
            teamId: team.id,
          },
          update: {},
        });
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
