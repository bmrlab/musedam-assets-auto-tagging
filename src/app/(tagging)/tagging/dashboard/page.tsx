import { getAuthSession } from "@/app/(auth)/requestAuth";
import { redirect } from "next/navigation";
import { fetchDashboardStats, fetchProcessingTasks } from "./actions";
import { DASHBOARD_INITIAL_PAGE_SIZE } from "./constants";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const session = await getAuthSession();

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const [statsResult, tasksResult] = await Promise.all([
    fetchDashboardStats(),
    // 与 DashboardClient 首屏的分页参数保持一致，客户端直接复用这份数据
    fetchProcessingTasks(1, DASHBOARD_INITIAL_PAGE_SIZE, "all"),
  ]);

  if (!statsResult.success) {
    throw new Error("Failed to fetch dashboard stats");
  }

  if (!tasksResult.success) {
    throw new Error("Failed to fetch processing tasks");
  }

  const { stats } = statsResult.data;
  const { tasks, total } = tasksResult.data;

  return <DashboardClient initialStats={stats} initialTasks={tasks} initialTotal={total} />;
}
