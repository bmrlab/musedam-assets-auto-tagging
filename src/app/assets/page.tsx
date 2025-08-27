import authOptions from "@/app/(auth)/authOptions";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import AssetsClient from "./AssetsClient";
import { fetchTeamAssets } from "./actions";

export default async function AssetsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const result = await fetchTeamAssets();

  if (!result.success) {
    throw new Error("Failed to fetch assets");
  }

  const { assets } = result.data;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-2xl font-bold">MuseDAM 资产管理</h1>
              <p className="text-sm text-muted-foreground mt-1">查看和管理团队的资产文件</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <AssetsClient initialAssets={assets} />
        </div>
      </div>
    </div>
  );
}
