import "next-auth";

declare module "next-auth" {
  interface User {
    id: number;
    teamId: number;
  }
  interface Session {
    team?: {
      id: number;
    };
    user?: {
      id: number;
    };
    expires: ISODateString;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: number;
    _tid: number;
  }
}
