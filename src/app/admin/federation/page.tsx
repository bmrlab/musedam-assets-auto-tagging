import { auth } from "@/app/(auth)/auth";
import { FederationTestPageClient } from "@/app/admin/federation/FederationTestPageClient";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function FederationTestPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user || session.user.role !== "admin") {
    redirect("/login");
  }

  return <FederationTestPageClient />;
}
