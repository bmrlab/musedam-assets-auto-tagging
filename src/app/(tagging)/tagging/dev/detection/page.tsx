import authOptions from "@/app/(auth)/authOptions";
import { isDebugPageEnabled } from "@/lib/brand/env";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import DetectionDebugClient from "./DetectionDebugClient";

export default async function DetectionDebugPage() {
  if (!isDebugPageEnabled()) {
    redirect("/tagging/brand");
  }

  const session = await getServerSession(authOptions);

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  return <DetectionDebugClient />;
}
