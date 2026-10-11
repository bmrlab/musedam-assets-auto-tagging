import { getAuthSession } from "@/app/(auth)/requestAuth";
import { isDebugPageEnabled } from "@/lib/brand/env";
import { redirect } from "next/navigation";
import { fetchPersonLibraryInitialData } from "./actions";
import PersonLibraryClient from "./PersonLibraryClient";

export default async function PersonPage() {
  const session = await getAuthSession();

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const result = await fetchPersonLibraryInitialData();

  if (!result.success) {
    throw new Error(result.message || "Failed to fetch Person library data");
  }

  return <PersonLibraryClient initialData={result.data} debugPageEnabled={isDebugPageEnabled()} />;
}
