import { getAuthSession } from "@/app/(auth)/requestAuth";
import { isDebugPageEnabled } from "@/lib/brand/env";
import { redirect } from "next/navigation";
import { fetchBrandLibraryPageData } from "../actions";
import BrandClassifyClient from "./BrandClassifyClient";

export default async function BrandClassifyPage() {
  if (!isDebugPageEnabled()) {
    redirect("/tagging/brand");
  }

  const session = await getAuthSession();

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const result = await fetchBrandLibraryPageData();
  if (!result.success) {
    throw new Error(result.message || "Failed to load brand classify page data");
  }

  return <BrandClassifyClient initialData={result.data} />;
}
