import { LucideIcon } from "lucide-react";
import { IconProps, SvgIcon } from "./icon";

// 重新导出SvgIcon和IconProps
export { SvgIcon, type IconProps } from "./icon";

// 自动定义Icon文件夹中的所有图标
const iconFiles = [
  "Dashboard.svg",
  "folders.svg",
  "Monitor.svg",
  "Setting.svg",
  "TagAI.svg",
  "Tags.svg",
  "Team.svg",
] as const;

// 手动定义图标名称类型，确保类型安全
export type IconName = "dashboard" | "folders" | "monitor" | "setting" | "tag-ai" | "tags" | "team";

// 图标路径映射 - 自动生成
export const iconPaths = iconFiles.reduce(
  (acc, file) => {
    const name = file.replace(".svg", "").toLowerCase();
    const iconName = name === "tagai" ? "tag-ai" : name;
    acc[iconName as IconName] = `/Icon/${file}`;
    return acc;
  },
  {} as Record<IconName, string>,
);

// 图标viewBox映射 - 可以根据需要添加特定图标的viewBox
export const iconViewBoxes: Partial<Record<IconName, string>> = {
  dashboard: "0 0 37 36",
  folders: "0 0 37 36",
  monitor: "0 0 37 36",
  setting: "0 0 37 36",
  "tag-ai": "0 0 37 36",
  tags: "0 0 37 36",
  team: "0 0 37 36",
};

export interface NamedIconProps extends IconProps {
  name: IconName;
}

/**
 * 通过名称使用图标的组件
 */
export const Icon = ({ name, ...props }: NamedIconProps) => {
  const src = iconPaths[name as keyof typeof iconPaths];
  const viewBox = iconViewBoxes[name as keyof typeof iconViewBoxes];

  if (!src) {
    console.warn(`Icon "${name}" not found`);
    return null;
  }

  return <SvgIcon src={src} viewBox={viewBox} {...props} />;
};

// 图标名称常量
const ICON_NAMES = {
  DASHBOARD: "dashboard" as const,
  FOLDERS: "folders" as const,
  MONITOR: "monitor" as const,
  SETTING: "setting" as const,
  TAG_AI: "tag-ai" as const,
  TAGS: "tags" as const,
  TEAM: "team" as const,
} as const;

// 导出所有图标组件，直接使用SvgIcon组件
export function DashboardIcon(props: IconProps) {
  return <SvgIcon src="/Icon/Dashboard.svg" viewBox="0 0 37 36" {...props} />;
}

export function FoldersIcon(props: IconProps) {
  return <SvgIcon src="/Icon/folders.svg" viewBox="0 0 37 36" {...props} />;
}

export function MonitorIcon(props: IconProps) {
  return <SvgIcon src="/Icon/Monitor.svg" viewBox="0 0 37 36" {...props} />;
}

export function DoubleLeftIcon(props: IconProps) {
  return <SvgIcon src="/Icon/DoubleLeft.svg" viewBox="0 0 37 36" {...props} />;
}

export function SettingIcon(props: IconProps) {
  return <SvgIcon src="/Icon/Setting.svg" viewBox="0 0 37 36" {...props} />;
}

export function FileImageIcon(props: IconProps) {
  return <SvgIcon src="/Icon/FileImage.svg" viewBox="0 0 37 36" {...props} />;
}


export function VimIcon(props: IconProps) {
  return <SvgIcon src="/Icon/Vim.svg" viewBox="0 0 37 36" {...props} />;
}

export function TagAIIcon(props: IconProps) {
  return <SvgIcon src="/Icon/TagAI.svg" viewBox="0 0 37 36" {...props} />;
}

export function TagsIcon(props: IconProps) {
  return <SvgIcon src="/Icon/Tags.svg" viewBox="0 0 37 36" {...props} />;
}

export function TeamIcon(props: IconProps) {
  return <SvgIcon src="/Icon/Team.svg" viewBox="0 0 37 36" {...props} />;
}

export function ClockCircleIcon(props: IconProps) {
  return <SvgIcon src="/Icon/ClockCircle.svg" viewBox="0 0 37 36" {...props} />;
}

/**
 * 统一的图标组件，支持自定义SVG和Lucide图标
 */
export interface UnifiedIconProps extends IconProps {
  /**
   * 使用Lucide图标
   */
  lucide?: LucideIcon;
  /**
   * 使用自定义SVG文件
   */
  src?: string;
  /**
   * 使用预定义的图标名称
   */
  name?: IconName;
}

export const UnifiedIcon = ({ lucide: LucideComponent, src, name, ...props }: UnifiedIconProps) => {
  // 优先使用Lucide图标
  if (LucideComponent) {
    return <LucideComponent {...props} />;
  }

  // 使用自定义SVG文件
  if (src) {
    return <SvgIcon src={src} {...props} />;
  }

  // 使用预定义图标
  if (name) {
    return <Icon name={name} {...props} />;
  }

  console.warn("UnifiedIcon: 必须提供 lucide、src 或 name 属性之一");
  return null;
};
