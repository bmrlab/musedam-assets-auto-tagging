import { getAuthSession } from "@/app/(auth)/requestAuth";
import { isDebugPageEnabled } from "@/lib/brand/env";
import { redirect } from "next/navigation";
import { fetchPersonLibraryPageData } from "../actions";
import PersonClassifyClient from "./PersonClassifyClient";

export default async function PersonClassifyPage() {
  if (!isDebugPageEnabled()) {
    redirect("/tagging/person");
  }

  const session = await getAuthSession();

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const result = await fetchPersonLibraryPageData();
  if (!result.success) {
    throw new Error(result.message || "Failed to load Person classify page data");
  }

  return <PersonClassifyClient initialData={result.data} />;
}
