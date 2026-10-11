import { getAuthSession } from "@/app/(auth)/requestAuth";
import { isDebugPageEnabled } from "@/lib/brand/env";
import { redirect } from "next/navigation";
import { fetchBrandLibraryInitialData } from "./actions";
import BrandLibraryClient from "./BrandLibraryClient";

export default async function BrandPage() {
  const session = await getAuthSession();

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const result = await fetchBrandLibraryInitialData();

  if (!result.success) {
    throw new Error(result.message || "Failed to fetch brand library data");
  }

  const debugPageEnabled = isDebugPageEnabled();

  return <BrandLibraryClient initialData={result.data} debugPageEnabled={debugPageEnabled} />;
}
