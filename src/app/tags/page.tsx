import { getAuthSession } from "@/app/(auth)/requestAuth";
import { redirect } from "next/navigation";
import TagsClient from "./TagsClient";
import { fetchTeamTags } from "./actions";

export default async function TagsPage() {
  const session = await getAuthSession();

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
