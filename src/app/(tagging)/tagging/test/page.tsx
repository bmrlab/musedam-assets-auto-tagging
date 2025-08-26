import authOptions from "@/app/(auth)/authOptions";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import TestClient from "./TestClient";

export default async function TestPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  return <TestClient />;
}
