import { getAuthSession } from "@/app/(auth)/requestAuth";
import { isDebugPageEnabled } from "@/lib/brand/env";
import { redirect } from "next/navigation";
import DetectionDebugClient from "./DetectionDebugClient";

export default async function DetectionDebugPage() {
  if (!isDebugPageEnabled()) {
    redirect("/tagging/brand");
  }

  const session = await getAuthSession();

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  return <DetectionDebugClient />;
}
