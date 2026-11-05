import { getAuthSession } from "@/app/(auth)/requestAuth";
import { redirect } from "next/navigation";
import { fetchMetadataContext } from "@/musedam/metadata";
import ReviewPageClient from "./ReviewPageClient";

export default async function ReviewPage() {
  const session = await getAuthSession();

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const capability = await fetchMetadataContext(session.team).catch(() => ({ enabled: false }));
  return <ReviewPageClient metadataAvailable={capability.enabled} />;
}
