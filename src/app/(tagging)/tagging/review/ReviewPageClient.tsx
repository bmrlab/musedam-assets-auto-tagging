"use client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { File, Loader2Icon, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AssetWithAuditItems, fetchAssetsWithAuditItems } from "./actions";
import { ReviewItem } from "./ReviewItem";

type TaggingAuditStatus = "pending" | "approved" | "rejected";

export default function ReviewPageClient() {
  const [assets, setAssets] = useState<AssetWithAuditItems[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<TaggingAuditStatus | "all">("all");
  const [confidenceFilter, setConfidenceFilter] = useState<"all" | "high" | "medium" | "low">(
    "all",
  );
  const [searchQuery, setSearchQuery] = useState("");

  const refreshData = useCallback(async () => {
    setIsLoading(true);
    try {
      const assetsResult = await fetchAssetsWithAuditItems(
        1,
        5,
        statusFilter === "all" ? undefined : statusFilter,
        confidenceFilter === "all" ? undefined : confidenceFilter,
        searchQuery || undefined,
      );
      if (assetsResult.success) {
        setAssets(assetsResult.data.assets);
      }
    } catch (error) {
      console.error("刷新数据失败:", error);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, confidenceFilter, searchQuery]);

  useEffect(() => {
    refreshData();
  }, []);

  const handleFilterChange = useCallback(() => {
    refreshData();
  }, [refreshData]);

  return (
    <div className="space-y-6">
      {/* 筛选器和搜索 */}
      <div className="flex flex-col sm:flex-row justify-end gap-4 py-2 px-3 bg-background border rounded-md">
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter(value as TaggingAuditStatus | "all");
            setTimeout(handleFilterChange, 100);
          }}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="pending">待审核</SelectItem>
            <SelectItem value="approved">已采纳</SelectItem>
            <SelectItem value="rejected">已调整</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={confidenceFilter}
          onValueChange={(value) => {
            setConfidenceFilter(value as "all" | "high" | "medium" | "low");
            setTimeout(handleFilterChange, 100);
          }}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="全部置信度" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部置信度</SelectItem>
            <SelectItem value="high">精准 (≥80%)</SelectItem>
            <SelectItem value="medium">平衡 (60-79%)</SelectItem>
            <SelectItem value="low">宽泛 (&lt;60%)</SelectItem>
          </SelectContent>
        </Select>

        <Select disabled>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="打标发起时间" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部时间</SelectItem>
            <SelectItem value="today">今天</SelectItem>
            <SelectItem value="week">本周</SelectItem>
            <SelectItem value="month">本月</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1 max-w-md relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索名称或标签"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleFilterChange();
              }
            }}
            className="pl-10"
          />
        </div>
      </div>

      {/* 右侧主要内容 */}
      {isLoading ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            <Loader2Icon className="size-8 animate-spin mx-auto mb-4" />
            <p>加载中...</p>
          </CardContent>
        </Card>
      ) : assets.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            <File className="h-12 w-12 mx-auto mb-4" />
            <p>暂无待审核的素材</p>
          </CardContent>
        </Card>
      ) : (
        assets.map((asset) => <ReviewItem key={asset.id} asset={asset} />)
      )}
    </div>
  );
}
