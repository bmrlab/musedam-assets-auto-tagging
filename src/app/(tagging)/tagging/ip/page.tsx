import authOptions from "@/app/(auth)/authOptions";
import { isDebugPageEnabled } from "@/lib/brand/env";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { fetchIpLibraryPageData } from "./actions";
import IpLibraryClient from "./IpLibraryClient";

export default async function IpPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const result = await fetchIpLibraryPageData();

  if (!result.success) {
    throw new Error(result.message || "Failed to fetch IP library data");
  }

  return <IpLibraryClient initialData={result.data} debugPageEnabled={isDebugPageEnabled()} />;
}
