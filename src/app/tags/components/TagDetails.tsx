"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TagNode } from "../types";

// 临时内联TagDetails组件
export function TagDetails({
  selectedTag,
}: {
  selectedTag: { tag: TagNode; level: number } | null;
}) {
  if (!selectedTag) {
    return (
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-lg">标签详情</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-center py-8">请选择一个标签查看详情</p>
        </CardContent>
      </Card>
    );
  }

  const { tag, level } = selectedTag;
  const getLevelText = (level: number) => {
    switch (level) {
      case 1:
        return "标签组";
      case 2:
        return "二级标签";
      case 3:
        return "三级标签";
      default:
        return "标签";
    }
  };

  return (
    <div className="w-[18rem] bg-background border rounded-md flex flex-col items-stretch overflow-hidden">
      <div className="border-b px-4 py-2 font-medium">标签详情</div>
      <div className="flex-1 overflow-y-scroll scrollbar-thin space-y-4 p-4">
        <h3 className="font-medium mb-2">基本信息</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">标签名称：</span>
            <span className="font-medium">{tag.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">标签类型：</span>
            <span>{getLevelText(level)}</span>
          </div>
          {tag.slug && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">ID：</span>
              <span className="font-mono text-xs">{tag.slug}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
