"use client";

import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckIcon,
  CircleQuestionMarkIcon,
  ClockIcon,
  FolderIcon,
  ImageIcon,
  TagIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";

export interface TaggingResult {
  asset: {
    id: string;
    name: string;
    extension: string;
    size: number;
    thumbnail?: string;
    categories: string[];
    processingTime: number;
    materializedPath?: string;
    recognitionMode: string;
  };
  overallScore: number;
  effectiveTags: {
    tagPath: string[];
    matchingSource: string;
    confidence: number;
    score: number;
  }[];
  candidateTags: {
    tagPath: string[];
    matchingSource: string;
    confidence: number;
    score: number;
  }[];
  strategyAnalysis: {
    key: string;
    weight: number;
    score: number;
  }[];
}

interface TaggingResultDisplayProps {
  result: TaggingResult;
}

export function TaggingResultDisplay({ result }: TaggingResultDisplayProps) {
  const t = useTranslations("TaggingResultDisplay");

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="bg-background border rounded-lg p-6 space-y-6">
      {/* 文件信息头部 */}
      <div className="flex items-start gap-4">
        {/* 缩略图 */}
        <div className="shrink-0 w-20 h-20 relative bg-muted rounded-lg overflow-hidden">
          {result.asset.thumbnail ? (
            <Image
              src={result.asset.thumbnail}
              alt={result.asset.name}
              fill
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <ImageIcon className="w-8 h-8 text-basic-5" />
            </div>
          )}
        </div>

        {/* 文件信息 */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-lg truncate" title={result.asset.name}>
            {result.asset.name}
          </h3>
          <div className="flex items-center gap-2 text-sm text-basic-5 mt-1">
            <span>
              {result.asset.extension.toUpperCase()} · {formatFileSize(result.asset.size)}{" "}
            </span>
            {result.asset.materializedPath && (
              <span>
                · <FolderIcon className="size-[12px]" /> {result.asset.materializedPath}
              </span>
            )}
          </div>
          {/* <div className="text-sm text-basic-5 mt-1">
                        分类：{result.asset.categories.join(" / ")}
                    </div> */}
          <div className="flex items-center gap-4 text-sm text-basic-5 mt-2">
            <div className="flex items-center gap-1">
              <ClockIcon className="w-4 h-4" />
              <span>
                {t("processingTime")}: {result.asset.processingTime}s
              </span>
            </div>
            <div>
              {t("aiRecognitionMode")}: {result.asset.recognitionMode}
            </div>
          </div>
        </div>

        {/* 综合得分 */}
        <div className="shrink-0 text-right">
          <div className="text-3xl font-bold text-primary">{result.overallScore}</div>
          <div className="text-sm text-basic-5">{t("overallScore")}</div>
        </div>
      </div>

      {/* 生效标签 */}
      <div>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TagIcon className="w-4 h-4" />
            {t("effectiveTags")} ({result.effectiveTags.length})
            <span className="text-sm font-normal text-basic-5">
              {t("effectiveTagsDescription")}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-3">
            {result.effectiveTags.map((tag, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 bg-[#EDFFF3] border border-[#8CFAC7] rounded-lg"
              >
                <CheckIcon className="size-[14px] text-[#00E096] mr-2" />
                <div className="flex-1">
                  <div className="font-medium text-sm text-[#00B283] mb-1">
                    {tag.tagPath.join(" > ")}
                  </div>
                  <div className="text-xs text-[#00E096]">
                    {t("matchingSource")}: {tag.matchingSource}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-[#00B283]">
                    {t("confidence")}: {tag.confidence}%
                  </div>
                  <div className="text-xs text-[#00E096]">
                    {t("score")}: {tag.score}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </div>

      {/* 候选标签 */}
      <div>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CircleQuestionMarkIcon className="size-4" />
            {t("candidateTags")} ({result.candidateTags.length})
            <span className="text-sm font-normal text-basic-5 text">
              {t("candidateTagsDescription")}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-3">
            {result.candidateTags.map((tag, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 bg-[#FFF7E6] border border-[#FFC069] rounded-lg"
              >
                <CheckIcon className="size-[14px] text-[#FA8C16] mr-2" />
                <div className="flex-1">
                  <div className="font-medium text-sm text-[#D46B08] mb-1">
                    {tag.tagPath.join(" > ")}
                  </div>
                  <div className="text-xs text-[#FA8C16]">
                    {t("matchingSource")}: {tag.matchingSource}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-[#D46B08]">
                    {t("confidence")}: {tag.confidence}%
                  </div>
                  <div className="text-xs text-[#FA8C16]">
                    {t("score")}: {tag.score}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </div>

      {/* 策略分析详情 */}
      {/* <div>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <TagIcon className="size-4" />
                        策略分析详情
                    </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                    <div className="space-y-4">
                        {
                            [
                                { key: "materializedPath", label: "文件夹路径匹配" },
                                { key: "basicInfo", label: "素材名称匹配" },
                                { key: "contentAnalysis", label: "素材内容匹配" },
                                { key: "tagKeywords", label: "标签关键词匹配" },
                            ].map((strategy, index) => {
                                const currentStrategy = result.strategyAnalysis.find(s => s.key === strategy.key);
                                const isExclude = !currentStrategy?.score
                                return <div key={index} className={
                                    cn("flex items-center justify-between p-3 border rounded-lg",
                                        isExclude ? "bg-[#FFF2F2] border-[#FFA8B4] " : ""
                                    )
                                }>
                                    <div className="flex items-center gap-2">
                                        <span className={cn("font-medium text-sm", isExclude && 'text-[#FF3D71]')}>{strategy.label}</span>
                                        <div className="flex items-center gap-2">
                                            <span className={cn("text-sm", isExclude && 'text-[#FF708D]')}>
                                                权重: {currentStrategy?.weight || 0}% | 得分: {currentStrategy?.score || 0}
                                            </span>

                                            {isExclude && <div className="px-2 py-[3px] text-[#DB2C66] text-xs font-medium rounded-full bg-[#FFD6D9]">已排除</div>}
                                        </div>
                                    </div>
                                    <ArrowRight className="size-4 text-basic-5" />
                                </div>
                            })
                        }
                    </div>
                </CardContent>
            </div> */}
    </div>
  );
}
