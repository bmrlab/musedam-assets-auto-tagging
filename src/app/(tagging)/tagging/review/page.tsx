import authOptions from "@/app/(auth)/authOptions";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import ReviewPageClient from "./ReviewPageClient";

// 设置 Server Action 最大执行时间为 60 秒
export const maxDuration = 60;

export default async function ReviewPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  return <ReviewPageClient />;
}
