import authOptions from "@/app/(auth)/authOptions";
import { isDebugPageEnabled } from "@/lib/brand/env";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { fetchPersonLibraryPageData } from "./actions";
import PersonLibraryClient from "./PersonLibraryClient";

export default async function PersonPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const result = await fetchPersonLibraryPageData();

  if (!result.success) {
    throw new Error(result.message || "Failed to fetch Person library data");
  }

  return <PersonLibraryClient initialData={result.data} debugPageEnabled={isDebugPageEnabled()} />;
}
