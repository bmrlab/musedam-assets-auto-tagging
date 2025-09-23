// 使用示例
import { DashboardIcon, FoldersIcon, Icon, MonitorIcon, UnifiedIcon } from "@/components/ui/icons";

// 方式1: 直接使用图标组件
function Example1() {
  return (
    <div className="flex gap-4">
      <DashboardIcon size="w-6 h-6" color="text-blue-500" />
      <FoldersIcon size="w-5 h-5" color="text-green-500" />
      <MonitorIcon size="w-4 h-4" color="text-red-500" />
    </div>
  );
}

// 方式2: 使用Icon组件通过名称
function Example2() {
  return (
    <div className="flex gap-4">
      <Icon name="dashboard" size="w-6 h-6" color="text-blue-500" />
      <Icon name="folders" size="w-5 h-5" color="text-green-500" />
      <Icon name="monitor" size="w-4 h-4" color="text-red-500" />
    </div>
  );
}

// 方式3: 使用UnifiedIcon组件
function Example3() {
  return (
    <div className="flex gap-4">
      <UnifiedIcon name="dashboard" size="w-6 h-6" color="text-blue-500" />
      <UnifiedIcon name="folders" size="w-5 h-5" color="text-green-500" />
      <UnifiedIcon name="monitor" size="w-4 h-4" color="text-red-500" />
    </div>
  );
}

export { Example1, Example2, Example3 };
