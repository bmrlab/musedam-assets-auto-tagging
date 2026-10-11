import { getAuthSession } from "@/app/(auth)/requestAuth";
import { isDebugPageEnabled } from "@/lib/brand/env";
import { redirect } from "next/navigation";
import { fetchProductLibraryPageData } from "../actions";
import ProductClassifyClient from "./ProductClassifyClient";

export default async function ProductClassifyPage() {
  if (!isDebugPageEnabled()) {
    redirect("/tagging/product");
  }

  const session = await getAuthSession();

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const result = await fetchProductLibraryPageData();
  if (!result.success) {
    throw new Error(result.message || "Failed to load Product classify page data");
  }

  return <ProductClassifyClient initialData={result.data} />;
}
