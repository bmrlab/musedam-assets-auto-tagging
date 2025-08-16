import "server-only";

import { User } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { compare } from "bcryptjs";
import { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { verifyImpersonationLoginToken } from "./impersonationLogin";

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
      id: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      /**
       * 前端需要调用 signin/actions.ts 里的 signInWithEmail 方法不要直接调用 next-auth/react 自带的 signIn
       * signInWithEmail 可以更好的处理错误，并且在 EMAIL_NOT_VERIFIED 的时候跳转
       */
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("INVALID_CREDENTIALS");
        }
        const email = credentials.email.toLowerCase().trim();
        let user: User | null;
        try {
          user = await prisma.user.findUnique({ where: { email } });
        } catch (error) {
          throw new Error("SERVER_ERROR");
        }
        if (!user) {
          throw new Error("USER_NOT_FOUND");
        }
        const isPasswordValid = await compare(credentials.password, user.password);
        if (!isPasswordValid) {
          throw new Error("INVALID_PASSWORD");
        }
        return {
          id: user.id,
          name: user.name,
          email: user.email!,
          userType: "Personal",
        };
      },
    }),
    CredentialsProvider({
      id: "impersonation-login",
      credentials: {
        token: { label: "Token", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.token) {
          throw new Error("TOKEN_REQUIRED");
        }
        // Verify the impersonation login token
        const payload = verifyImpersonationLoginToken(credentials.token);
        if (!payload) {
          throw new Error("INVALID_TOKEN");
        }
        const user = await prisma.user.upsert({
          where: { slug: payload.musedamUserId.toString() },
          create: {
            name: `MuseDAM-User-${payload.musedamUserId}`,
            slug: payload.musedamUserId.toString(),
            password: "",
          },
          update: {},
        });
        const team = await prisma.team.upsert({
          where: { slug: payload.musedamTeamId.toString() },
          create: {
            name: `MuseDAM-Team-${payload.musedamTeamId}`,
            slug: payload.musedamTeamId.toString(),
          },
          update: {},
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
          name: user.name,
          email: user.email!,
          userType: "TeamMember",
          teamId: team.id,
        };
      },
    }),
  ],
  callbacks: {
    session: ({ session, token }) => {
      const invalidSession = { ...session, user: undefined, userType: undefined, team: undefined };
      const validSession = {
        ...session,
        user: {
          ...session.user,
          id: parseInt(token.id + ""),
        },
      };
      if (token._ut === 0) {
        validSession.userType = "Personal";
      } else if (token._ut === 1) {
        if (!token._tid) {
          return invalidSession;
        }
        validSession.userType = "TeamMember";
        validSession.team = { id: token._tid };
      } else {
        return invalidSession;
      }

      return validSession;
    },
    jwt: ({ token, user }) => {
      if (user) {
        const validToken = {
          ...token,
          id: parseInt(user.id + ""),
        };
        if (user.userType === "Personal") {
          validToken._ut = 0;
        } else if (user.userType === "TeamMember") {
          if (!user.teamId) {
            throw new Error("INVALID_TEAM_ID");
          }
          validToken._ut = 1;
          validToken._tid = parseInt(user.teamId + "");
        } else {
          throw new Error("INVALID_USER_TYPE");
        }
        return validToken;
      }
      return token;
    },
  },
};

export default authOptions;
