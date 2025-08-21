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

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <TagsClient initialTags={tags} />
        </div>
      </div>
    </div>
  );
}
