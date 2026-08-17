import type { Metadata } from "next";
import StoreInspectionDemo from "./StoreInspectionDemo";

const TITLE = "门店巡检 Agent 演示";

export const metadata: Metadata = {
  title: TITLE,
};

export default function StoreInspectionPage() {
  return <StoreInspectionDemo title={TITLE} />;
}
