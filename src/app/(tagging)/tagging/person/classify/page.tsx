import authOptions from "@/app/(auth)/authOptions";
import { isDebugPageEnabled } from "@/lib/brand/env";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { fetchPersonLibraryPageData } from "../actions";
import PersonClassifyClient from "./PersonClassifyClient";

export default async function PersonClassifyPage() {
  if (!isDebugPageEnabled()) {
    redirect("/tagging/person");
  }

  const session = await getServerSession(authOptions);

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const result = await fetchPersonLibraryPageData();
  if (!result.success) {
    throw new Error(result.message || "Failed to load Person classify page data");
  }

  return <PersonClassifyClient initialData={result.data} />;
}
