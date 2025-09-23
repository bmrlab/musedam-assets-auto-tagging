# 图标系统使用说明

## 概述

这个图标系统已经实现了自动引入 `public/Icon/` 文件夹中的所有 SVG 文件，无需手动添加每个图标。

## 当前支持的图标

- `DashboardIcon` - 仪表板图标
- `FoldersIcon` - 文件夹图标
- `MonitorIcon` - 监控图标
- `SettingIcon` - 设置图标
- `TagAIIcon` - AI标签图标
- `TagsIcon` - 标签图标
- `TeamIcon` - 团队图标

## 使用方法

### 方式1: 直接使用图标组件（推荐）

```tsx
import { DashboardIcon, FoldersIcon, MonitorIcon } from "@/components/ui/icons";

function MyComponent() {
  return (
    <div className="flex gap-4">
      <DashboardIcon size="w-6 h-6" color="text-blue-500" />
      <FoldersIcon size="w-5 h-5" color="text-green-500" />
      <MonitorIcon size="w-4 h-4" color="text-red-500" />
    </div>
  );
}
```

### 方式2: 使用Icon组件通过名称

```tsx
import { Icon } from "@/components/ui/icons";

function MyComponent() {
  return (
    <div className="flex gap-4">
      <Icon name="dashboard" size="w-6 h-6" color="text-blue-500" />
      <Icon name="folders" size="w-5 h-5" color="text-green-500" />
      <Icon name="monitor" size="w-4 h-4" color="text-red-500" />
    </div>
  );
}
```

### 方式3: 使用UnifiedIcon组件

```tsx
import { UnifiedIcon } from "@/components/ui/icons";

function MyComponent() {
  return (
    <div className="flex gap-4">
      <UnifiedIcon name="dashboard" size="w-6 h-6" color="text-blue-500" />
      <UnifiedIcon name="folders" size="w-5 h-5" color="text-green-500" />
      <UnifiedIcon name="monitor" size="w-4 h-4" color="text-red-500" />
    </div>
  );
}
```

## 添加新图标

当你在 `public/Icon/` 文件夹中添加新的 SVG 文件时，需要：

1. 将 SVG 文件放入 `public/Icon/` 文件夹
2. 在 `src/components/ui/icons.tsx` 中的 `iconFiles` 数组中添加文件名
3. 在 `IconName` 类型中添加对应的名称
4. 在 `iconPaths` 和 `iconViewBoxes` 中添加映射
5. 添加对应的图标组件导出

### 示例：添加新图标

假设添加了 `NewIcon.svg` 文件：

```tsx
// 1. 在 iconFiles 数组中添加
const iconFiles = [
  "Dashboard.svg",
  "folders.svg",
  "Monitor.svg",
  "Setting.svg",
  "TagAI.svg",
  "Tags.svg",
  "Team.svg",
  "NewIcon.svg", // 新增
] as const;

// 2. 在 IconName 类型中添加
export type IconName =
  | "dashboard"
  | "folders"
  | "monitor"
  | "setting"
  | "tag-ai"
  | "tags"
  | "team"
  | "new-icon"; // 新增

// 3. 在 iconPaths 中会自动生成映射

// 4. 在 iconViewBoxes 中添加（如果需要）
export const iconViewBoxes: Partial<Record<IconName, string>> = {
  // ... 其他图标
  "new-icon": "0 0 37 36", // 新增
};

// 5. 添加图标组件导出
export function NewIcon(props: IconProps) {
  return <SvgIcon src="/Icon/NewIcon.svg" viewBox="0 0 37 36" {...props} />;
}
```

## 属性说明

所有图标组件都支持以下属性：

- `size`: 图标大小，支持 Tailwind CSS 类名，如 `"w-4 h-4"`、`"text-[14px]"` 等
- `color`: 图标颜色，支持 Tailwind CSS 类名，如 `"text-red-500"`、`"text-blue-600"` 等
- `className`: 额外的 CSS 类名
- 其他 SVG 属性

## 注意事项

- 所有图标都使用相同的 viewBox `"0 0 37 36"`，如果需要不同的 viewBox，请在 `iconViewBoxes` 中单独设置
- 图标路径统一使用 `/Icon/` 前缀
- 图标名称遵循 kebab-case 命名规范
