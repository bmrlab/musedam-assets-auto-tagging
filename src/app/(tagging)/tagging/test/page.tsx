import { getAuthSession } from "@/app/(auth)/requestAuth";
import { redirect } from "next/navigation";
import TestClient from "./TestClient";

export default async function TestPage() {
  const session = await getAuthSession();

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  return <TestClient />;
}
