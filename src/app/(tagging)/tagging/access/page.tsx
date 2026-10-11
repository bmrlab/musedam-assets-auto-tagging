import { getAuthSession } from "@/app/(auth)/requestAuth";
import { redirect } from "next/navigation";
import AccessClient from "./AccessClient";
import { fetchAccessPermissionsAction } from "./actions";

export default async function AccessPage() {
  const session = await getAuthSession();

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const permissionsResult = await fetchAccessPermissionsAction();

  if (!permissionsResult.success) {
    throw new Error("Failed to fetch access permissions");
  }

  const { permissions } = permissionsResult.data;

  return <AccessClient initialPermissions={permissions} />;
}
