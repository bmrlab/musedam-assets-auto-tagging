import { auth } from "@/app/(auth)/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { UsersPageClient } from "./UsersPageClient";

export default async function AdminPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session?.user || session.user.role !== "admin") {
    redirect("/login");
  }
  return <UsersPageClient />;
}
