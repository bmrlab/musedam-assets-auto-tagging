import authOptions from "@/app/(auth)/authOptions";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { fetchBrandLibraryPageData } from "../actions";
import BrandClassifyClient from "./BrandClassifyClient";

export default async function BrandClassifyPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const result = await fetchBrandLibraryPageData();
  if (!result.success) {
    throw new Error(result.message || "Failed to load brand classify page data");
  }

  return <BrandClassifyClient initialData={result.data} />;
}
