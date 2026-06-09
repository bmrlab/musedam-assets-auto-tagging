import authOptions from "@/app/(auth)/authOptions";
import { isDebugPageEnabled } from "@/lib/brand/env";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { fetchBrandLibraryPageData } from "./actions";
import BrandLibraryClient from "./BrandLibraryClient";

export default async function BrandPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const result = await fetchBrandLibraryPageData();

  if (!result.success) {
    throw new Error(result.message || "Failed to fetch brand library data");
  }

  const debugPageEnabled = isDebugPageEnabled();

  return <BrandLibraryClient initialData={result.data} debugPageEnabled={debugPageEnabled} />;
}
