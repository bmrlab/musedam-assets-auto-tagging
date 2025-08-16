import { auth } from "@/app/(auth)/auth";
import { AdminPageClient } from "./AdminPageClient";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function AdminPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session?.user || session.user.role !== "admin") {
    redirect("/login");
  }
  return <AdminPageClient />;
}
