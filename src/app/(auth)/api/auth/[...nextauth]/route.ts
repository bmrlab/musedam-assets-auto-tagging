import authOptions from "@/app/(auth)/authOptions";
import NextAuth from "next-auth";
import { NextRequest } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handler(req: NextRequest, context: any) {
  return await NextAuth(req, context, authOptions);
}

// // const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
