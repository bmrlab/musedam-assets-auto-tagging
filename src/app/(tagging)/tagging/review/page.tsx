import { getAuthSession } from "@/app/(auth)/requestAuth";
import { redirect } from "next/navigation";
import ReviewPageClient from "./ReviewPageClient";

export default async function ReviewPage() {
  const session = await getAuthSession();

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  return <ReviewPageClient />;
}
