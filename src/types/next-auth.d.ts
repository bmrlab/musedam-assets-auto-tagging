import "next-auth";

declare module "next-auth" {
  interface User {
    id: number;
    slug: string;
    teamId: number;
    teamSlug: string;
  }
  interface Session {
    team?: {
      id: number;
      slug: string;
    };
    user?: {
      id: number;
      slug: string;
    };
    expires: ISODateString;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: number;
    tid: number;
    slug: string;
    tslug: string;
  }
}
