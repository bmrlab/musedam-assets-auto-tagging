import { UserType } from "@/prisma/client";
import "next-auth";

declare module "next-auth" {
  interface User {
    id: number;
    name: string;
    email: string;
    userType: UserType;
    teamId?: number;
  }
  interface Session {
    team?: {
      id: number;
    };
    user?: {
      id: number;
      name: string;
      email: string;
    };
    userType?: UserType;
    expires: ISODateString;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: number;
    _ut: 0 | 1; // 0 = Personal, 1 = TeamMember
    _tid?: number; // team id
  }
}
