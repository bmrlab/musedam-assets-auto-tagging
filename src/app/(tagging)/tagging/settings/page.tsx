import { getAuthSession } from "@/app/(auth)/requestAuth";
import { redirect } from "next/navigation";
import { fetchSettings } from "./actions";
import SettingsClient from "./SettingsClient";

export default async function SettingsPage() {
  const session = await getAuthSession();

  if (!session?.user || !session?.team) {
    redirect("/auth/signin");
  }

  const settingsResult = await fetchSettings();

  if (!settingsResult.success) {
    throw new Error("Failed to fetch settings");
  }

  const { settings } = settingsResult.data;

  return <SettingsClient initialSettings={settings} />;
}
