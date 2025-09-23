import { cn } from "@/lib/utils";
import React from "react";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  /**
   * 图标大小 - 支持Tailwind CSS类名
   * @example "w-4 h-4" | "text-[14px]" | "w-[20px] h-[20px]"
   */
  size?: string;
  /**
   * 图标颜色 - 支持Tailwind CSS类名
   * @example "text-red-500" | "text-blue-600" | "fill-current"
   */
  color?: string;
  /**
   * 额外的CSS类名
   */
  className?: string;
}

export interface SvgIconProps extends IconProps {
  /**
   * SVG文件路径
   */
  src: string;
  /**
   * SVG的viewBox，如果不提供会自动从SVG文件中读取
   */
  viewBox?: string;
}

/**
 * 通用的SVG图标组件，可以直接使用SVG文件
 * 支持通过className控制大小和颜色
 */
export const SvgIcon = React.forwardRef<SVGSVGElement, SvgIconProps>(
  ({ size, color, className, src, viewBox, ...props }, ref) => {
    const [svgContent, setSvgContent] = React.useState<string>("");
    const [svgViewBox, setSvgViewBox] = React.useState<string>(viewBox || "0 0 24 24");

    React.useEffect(() => {
      fetch(src)
        .then((response) => response.text())
        .then((text) => {
          setSvgContent(text);
          // 尝试从SVG内容中提取viewBox
          const viewBoxMatch = text.match(/viewBox="([^"]+)"/);
          if (viewBoxMatch && !viewBox) {
            setSvgViewBox(viewBoxMatch[1]);
          }
        })
        .catch((error) => {
          console.error(`Failed to load SVG: ${src}`, error);
        });
    }, [src, viewBox]);

    if (!svgContent) {
      return (
        <svg
          ref={ref}
          viewBox={svgViewBox}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={cn(
            "inline-block",
            size || "w-5 h-5", // 默认大小
            color || "text-current", // 默认颜色
            className,
          )}
          {...props}
        >
          <rect width="100%" height="100%" fill="currentColor" opacity="0.1" />
        </svg>
      );
    }

    // 解析SVG内容并提取path等元素
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, "image/svg+xml");
    const svgElement = doc.querySelector("svg");

    if (!svgElement) {
      return null;
    }

    const paths = Array.from(
      svgElement.querySelectorAll("path, circle, rect, line, polyline, polygon"),
    );

    return (
      <svg
        ref={ref}
        viewBox={svgViewBox}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn(
          "inline-block",
          size || "size-4", // 默认大小
          color || "text-current", // 默认颜色
          className,
        )}
        {...props}
      >
        {paths.map((path, index) => {
          const element = path.cloneNode(true) as SVGElement;
          // 移除原有的fill和stroke属性，让CSS类名控制颜色
          // element.removeAttribute("fill");
          // element.removeAttribute("stroke");
          // 移除fill-opacity，避免半透明显示
          // element.removeAttribute("fill-opacity");
          // 设置默认的fill为currentColor，确保图标有颜色
          // element.setAttribute("fill", "currentColor");
          return <g key={index} dangerouslySetInnerHTML={{ __html: element.outerHTML }} />;
        })}
      </svg>
    );
  },
);

SvgIcon.displayName = "SvgIcon";
