import authOptions from "@/app/(auth)/authOptions";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import ReviewClient from "./ReviewClient";
import { fetchAssetsWithAuditItems, fetchReviewStats } from "./actions";

export default async function ReviewPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const [statsResult, assetsResult] = await Promise.all([
    fetchReviewStats(),
    fetchAssetsWithAuditItems(1, 20),
  ]);

  if (!statsResult.success) {
    throw new Error("Failed to fetch review stats");
  }

  if (!assetsResult.success) {
    throw new Error("Failed to fetch assets with audit items");
  }

  const { stats } = statsResult.data;
  const { assets } = assetsResult.data;

  return <ReviewClient initialStats={stats} initialAssets={assets} />;
}
