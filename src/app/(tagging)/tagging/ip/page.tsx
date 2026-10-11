import { getAuthSession } from "@/app/(auth)/requestAuth";
import { isDebugPageEnabled } from "@/lib/brand/env";
import { redirect } from "next/navigation";
import { fetchIpLibraryInitialData } from "./actions";
import IpLibraryClient from "./IpLibraryClient";

export default async function IpPage() {
  const session = await getAuthSession();

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const result = await fetchIpLibraryInitialData();

  if (!result.success) {
    throw new Error(result.message || "Failed to fetch IP library data");
  }

  return <IpLibraryClient initialData={result.data} debugPageEnabled={isDebugPageEnabled()} />;
}
