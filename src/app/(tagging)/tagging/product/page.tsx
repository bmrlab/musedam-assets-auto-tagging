import { getAuthSession } from "@/app/(auth)/requestAuth";
import { isDebugPageEnabled } from "@/lib/brand/env";
import { redirect } from "next/navigation";
import { fetchProductLibraryInitialData } from "./actions";
import ProductLibraryClient from "./ProductLibraryClient";

export default async function ProductPage() {
  const session = await getAuthSession();

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const result = await fetchProductLibraryInitialData();

  if (!result.success) {
    throw new Error(result.message || "Failed to fetch Product library data");
  }

  return <ProductLibraryClient initialData={result.data} debugPageEnabled={isDebugPageEnabled()} />;
}
