import { getAuthSession } from "@/app/(auth)/requestAuth";
import { isDebugPageEnabled } from "@/lib/brand/env";
import { redirect } from "next/navigation";
import { fetchIpLibraryPageData } from "../actions";
import IpClassifyClient from "./IpClassifyClient";

export default async function IpClassifyPage() {
  if (!isDebugPageEnabled()) {
    redirect("/tagging/ip");
  }

  const session = await getAuthSession();

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const result = await fetchIpLibraryPageData();
  if (!result.success) {
    throw new Error(result.message || "Failed to load IP classify page data");
  }

  return <IpClassifyClient initialData={result.data} />;
}
