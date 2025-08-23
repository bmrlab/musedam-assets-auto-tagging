import authOptions from "@/app/(auth)/authOptions";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import TagsClient from "./TagsClient";
import { fetchTeamTags } from "./actions";

export default async function TagsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const result = await fetchTeamTags();

  if (!result.success) {
    throw new Error("Failed to fetch tags");
  }

  const { tags } = result.data;

  return <TagsClient initialTags={tags} />;
}
