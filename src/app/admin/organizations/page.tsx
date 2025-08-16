import { auth } from "@/app/(auth)/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OrganizationsPageClient } from "./OrganizationsPageClient";

export default async function OrganizationsPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user || session.user.role !== "admin") {
    redirect("/login");
  }

  return <OrganizationsPageClient />;
}
