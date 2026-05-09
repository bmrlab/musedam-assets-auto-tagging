import authOptions from "@/app/(auth)/authOptions";
import { isDebugPageEnabled } from "@/lib/brand/env";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { fetchProductLibraryPageData } from "./actions";
import ProductLibraryClient from "./ProductLibraryClient";

export default async function ProductPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const result = await fetchProductLibraryPageData();

  if (!result.success) {
    throw new Error(result.message || "Failed to fetch Product library data");
  }

  return <ProductLibraryClient initialData={result.data} debugPageEnabled={isDebugPageEnabled()} />;
}
