import authOptions from "@/app/(auth)/authOptions";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";
import { fetchDashboardStats, fetchProcessingTasks } from "./actions";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const [statsResult, tasksResult] = await Promise.all([
    fetchDashboardStats(),
    fetchProcessingTasks(1, 20),
  ]);

  if (!statsResult.success) {
    throw new Error("Failed to fetch dashboard stats");
  }

  if (!tasksResult.success) {
    throw new Error("Failed to fetch processing tasks");
  }

  const { stats } = statsResult.data;
  const { tasks } = tasksResult.data;

  return <DashboardClient initialStats={stats} initialTasks={tasks} />;
}
