"use client";

import { BrandIcon, IpIcon, TagAIIcon, VimIcon } from "@/components/ui";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CheckIcon, CircleQuestionMarkIcon, ClockIcon, FolderIcon, ImageIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
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
  brandRecognition: {
    noConfidentMatch: boolean;
    logoName: string | null;
    confidence: number | null;
    similarity: number | null;
    recommendedTags: {
      tagPath: string[];
    }[];
  } | null;
  ipRecognition: {
    noConfidentMatch: boolean;
    ipName: string | null;
    confidence: number | null;
    similarity: number | null;
    imageSimilarity: number | null;
    descriptionSimilarity: number | null;
    recommendedTags: {
      tagPath: string[];
    }[];
  } | null;
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

function getBrandGuidance(locale: string, noConfidentMatch: boolean) {
  const normalizedLocale = locale.toLowerCase();

  if (normalizedLocale === "zh-tw") {
    return noConfidentMatch
      ? {
          metricNote: "僅供參考",
          explanation:
            "目前已識別到可能品牌，但尚未達到可靠命中條件。以下關聯標籤僅供參考，暫不會進入生效標籤；常見原因是分數不足，或與其他候選品牌差距不夠大。",
        }
      : {
          metricNote: "參與生效",
          explanation: "目前品牌結果已通過可靠性校驗，以下關聯標籤會參與生效標籤計算。",
        };
  }

  if (normalizedLocale.startsWith("zh")) {
    return noConfidentMatch
      ? {
          metricNote: "仅供参考",
          explanation:
            "当前已识别到可能品牌，但尚未达到可靠命中条件。以下关联标签仅供参考，暂不会进入生效标签；常见原因是分数不足，或与其他候选品牌差距不够大。",
        }
      : {
          metricNote: "参与生效",
          explanation: "当前品牌结果已通过可靠性校验，以下关联标签会参与生效标签计算。",
        };
  }

  return noConfidentMatch
    ? {
        metricNote: "Reference only",
        explanation:
          "A possible brand was identified, but it did not pass the reliable-hit check. The linked tags below are for reference only and will not enter Effective Tags; common reasons are insufficient score or too little separation from other candidates.",
      }
    : {
        metricNote: "Included",
        explanation:
          "This brand result passed the reliability check, so the linked tags below are included in Effective Tags calculation.",
      };
}

function getIpGuidance(locale: string, noConfidentMatch: boolean) {
  const normalizedLocale = locale.toLowerCase();

  if (normalizedLocale === "zh-tw") {
    return noConfidentMatch
      ? {
          title: "IP 形象識別",
          metricNote: "僅供參考",
          entityLabel: "Winning IP",
          emptyText: "暫無 IP 形象識別結果",
          explanation:
            "目前已識別到可能 IP，但尚未達到可靠命中條件。以下關聯標籤僅供參考，暫不會進入生效標籤；常見原因是分數不足，或與其他候選 IP 差距不夠大。",
        }
      : {
          title: "IP 形象識別",
          metricNote: "參與生效",
          entityLabel: "Winning IP",
          emptyText: "暫無 IP 形象識別結果",
          explanation: "目前 IP 結果已通過可靠性校驗，以下關聯標籤會參與生效標籤計算。",
        };
  }

  if (normalizedLocale.startsWith("zh")) {
    return noConfidentMatch
      ? {
          title: "IP 形象识别",
          metricNote: "仅供参考",
          entityLabel: "Winning IP",
          emptyText: "暂无 IP 形象识别结果",
          explanation:
            "当前已识别到可能 IP，但尚未达到可靠命中条件。以下关联标签仅供参考，暂不会进入生效标签；常见原因是分数不足，或与其他候选 IP 差距不够大。",
        }
      : {
          title: "IP 形象识别",
          metricNote: "参与生效",
          entityLabel: "Winning IP",
          emptyText: "暂无 IP 形象识别结果",
          explanation: "当前 IP 结果已通过可靠性校验，以下关联标签会参与生效标签计算。",
        };
  }

  return noConfidentMatch
    ? {
        title: "IP Character Recognition",
        metricNote: "Reference only",
        entityLabel: "Winning IP",
        emptyText: "No IP character recognition result",
        explanation:
          "A possible IP character was identified, but it did not pass the reliable-hit check. The linked tags below are for reference only and will not enter Effective Tags; common reasons are insufficient score or too little separation from other candidates.",
      }
    : {
        title: "IP Character Recognition",
        metricNote: "Included",
        entityLabel: "Winning IP",
        emptyText: "No IP character recognition result",
        explanation:
          "This IP result passed the reliability check, so the linked tags below are included in Effective Tags calculation.",
      };
}

export function TaggingResultDisplay({ result }: TaggingResultDisplayProps) {
  const t = useTranslations("TaggingResultDisplay");
  const locale = useLocale();
  const ipGuidance = getIpGuidance(locale, result.ipRecognition?.noConfidentMatch ?? false);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="bg-background border border-basic-4 rounded-lg p-6 space-y-6">
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
          <div className="flex items-center gap-2 text-xs text-basic-5 mt-1 flex-nowrap overflow-hidden text-ellipsis">
            <span>
              {result.asset.extension.toUpperCase()} · {formatFileSize(result.asset.size)}{" "}
            </span>
            {result.asset.materializedPath && (
              <>
                · <FolderIcon className="size-[12px]" /> {result.asset.materializedPath}
              </>
            )}
          </div>
          {/* <div className="text-sm text-basic-5 mt-1">
                        分类：{result.asset.categories.join(" / ")}
                    </div> */}
          <div className="flex items-center gap-4 text-[13px] 5 mt-2">
            <div className="flex items-center gap-1">
              <ClockIcon className="size-[14px] text-primary" />
              <span>
                {t("processingTime")}: {result.asset.processingTime}s
              </span>
            </div>
            <div className="flex items-center gap-1">
              <VimIcon className="size-[14px] text-[#9254DE]" />
              <span>
                {" "}
                {t("aiRecognitionMode")}: {result.asset.recognitionMode}
              </span>
            </div>
          </div>
        </div>

        {/* 综合得分 */}
        <div className="shrink-0 text-right">
          <div className="text-3xl font-bold text-primary">{result.overallScore}</div>
          <div className="text-sm text-basic-5">{t("overallScore")}</div>
        </div>
      </div>

      <div>
        <CardHeader className="pb-2 px-0">
          <CardTitle className="text-sm flex items-center gap-2">
            <BrandIcon className="w-4 h-4" />
            {t("brandRecognition")}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 px-0">
          {result.brandRecognition?.logoName ? (
            (() => {
              const brandRecognition = result.brandRecognition!;
              const brandGuidance = getBrandGuidance(locale, brandRecognition.noConfidentMatch);
              const isReferenceOnly = brandRecognition.noConfidentMatch;

              return (
                <div
                  className={cn("rounded-md border p-4", {
                    "bg-[#FFF7E6] border-[#FFC069]": isReferenceOnly,
                    "bg-primary-1 border-primary-4": !isReferenceOnly,
                  })}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-basic-5">{t("classifiedLogo")}</div>
                      <div className="mt-1 text-base font-medium text-basic-8">
                        {brandRecognition.logoName}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {brandRecognition.confidence !== null ? (
                        <div
                          className={cn("text-sm font-medium", {
                            "text-[#D46B08]": isReferenceOnly,
                            "text-primary-6": !isReferenceOnly,
                          })}
                        >
                          {t("confidence")}: {brandRecognition.confidence}%
                        </div>
                      ) : null}
                      <div
                        className={cn("text-xs mt-1", {
                          "text-[#FA8C16]": isReferenceOnly,
                          "text-primary-5": !isReferenceOnly,
                        })}
                      >
                        {brandGuidance.metricNote}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
                        {
                          "bg-[#FFF1D6] text-[#D46B08]": isReferenceOnly,
                          "bg-primary-2 text-primary-6": !isReferenceOnly,
                        },
                      )}
                    >
                      {isReferenceOnly ? t("noConfidentMatch") : t("confidentMatch")}
                    </div>
                  </div>

                  <div
                    className={cn("mt-3 text-sm leading-6", {
                      "text-[#D46B08]": isReferenceOnly,
                      "text-primary-6": !isReferenceOnly,
                    })}
                  >
                    {brandGuidance.explanation}
                  </div>

                  <div className="mt-4">
                    <div className="text-xs text-basic-5">{t("linkedTags")}</div>
                    {brandRecognition.recommendedTags.length > 0 ? (
                      <div className="mt-2 space-y-3">
                        {brandRecognition.recommendedTags.map((tag, index) => (
                          <div
                            key={`${tag.tagPath.join(">")}-${index}`}
                            className={cn(
                              "flex items-center justify-between p-3 rounded-lg border",
                              {
                                "bg-[#FFFCF5] border-[#FFD591]": isReferenceOnly,
                                "bg-background border-primary-4": !isReferenceOnly,
                              },
                            )}
                          >
                            {isReferenceOnly ? (
                              <CircleQuestionMarkIcon className="size-[14px] text-[#FA8C16] mr-2" />
                            ) : (
                              <CheckIcon className="size-[14px] text-primary-5 mr-2" />
                            )}
                            <div className="flex-1">
                              <div
                                className={cn("font-medium text-sm mb-1", {
                                  "text-[#D46B08]": isReferenceOnly,
                                  "text-primary-6": !isReferenceOnly,
                                })}
                              >
                                {tag.tagPath.join(" > ")}
                              </div>
                              <div
                                className={cn("text-xs", {
                                  "text-[#FA8C16]": isReferenceOnly,
                                  "text-primary-5": !isReferenceOnly,
                                })}
                              >
                                {t("matchingSource")}: {t("brandRecognition")}
                              </div>
                            </div>
                            <div className="text-right shrink-0 pl-4">
                              <div
                                className={cn("text-sm font-medium", {
                                  "text-[#D46B08]": isReferenceOnly,
                                  "text-primary-6": !isReferenceOnly,
                                })}
                              >
                                {t("confidence")}: {brandRecognition.confidence ?? 0}%
                              </div>
                              <div
                                className={cn("text-xs", {
                                  "text-[#FA8C16]": isReferenceOnly,
                                  "text-primary-5": !isReferenceOnly,
                                })}
                              >
                                {brandGuidance.metricNote}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-basic-5">{t("noLinkedTags")}</div>
                    )}
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="text-sm text-basic-5">{t("noBrandResult")}</div>
          )}
        </CardContent>
      </div>

      <div>
        <CardHeader className="pb-2 px-0">
          <CardTitle className="text-sm flex items-center gap-2">
            <IpIcon className="w-4 h-4" />
            {ipGuidance.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 px-0">
          {result.ipRecognition?.ipName ? (
            (() => {
              const ipRecognition = result.ipRecognition!;
              const isReferenceOnly = ipRecognition.noConfidentMatch;

              return (
                <div
                  className={cn("rounded-md border p-4", {
                    "bg-[#FFF7E6] border-[#FFC069]": isReferenceOnly,
                    "bg-primary-1 border-primary-4": !isReferenceOnly,
                  })}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-basic-5">{ipGuidance.entityLabel}</div>
                      <div className="mt-1 text-base font-medium text-basic-8">
                        {ipRecognition.ipName}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {ipRecognition.confidence !== null ? (
                        <div
                          className={cn("text-sm font-medium", {
                            "text-[#D46B08]": isReferenceOnly,
                            "text-primary-6": !isReferenceOnly,
                          })}
                        >
                          {t("confidence")}: {ipRecognition.confidence}%
                        </div>
                      ) : null}
                      <div
                        className={cn("text-xs mt-1", {
                          "text-[#FA8C16]": isReferenceOnly,
                          "text-primary-5": !isReferenceOnly,
                        })}
                      >
                        {ipGuidance.metricNote}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
                        {
                          "bg-[#FFF1D6] text-[#D46B08]": isReferenceOnly,
                          "bg-primary-2 text-primary-6": !isReferenceOnly,
                        },
                      )}
                    >
                      {isReferenceOnly ? t("noConfidentMatch") : t("confidentMatch")}
                    </div>
                  </div>

                  <div
                    className={cn("mt-3 text-sm leading-6", {
                      "text-[#D46B08]": isReferenceOnly,
                      "text-primary-6": !isReferenceOnly,
                    })}
                  >
                    {ipGuidance.explanation}
                  </div>

                  <div className="mt-4">
                    <div className="text-xs text-basic-5">{t("linkedTags")}</div>
                    {ipRecognition.recommendedTags.length > 0 ? (
                      <div className="mt-2 space-y-3">
                        {ipRecognition.recommendedTags.map((tag, index) => (
                          <div
                            key={`${tag.tagPath.join(">")}-${index}`}
                            className={cn(
                              "flex items-center justify-between p-3 rounded-lg border",
                              {
                                "bg-[#FFFCF5] border-[#FFD591]": isReferenceOnly,
                                "bg-background border-primary-4": !isReferenceOnly,
                              },
                            )}
                          >
                            {isReferenceOnly ? (
                              <CircleQuestionMarkIcon className="size-[14px] text-[#FA8C16] mr-2" />
                            ) : (
                              <CheckIcon className="size-[14px] text-primary-5 mr-2" />
                            )}
                            <div className="flex-1">
                              <div
                                className={cn("font-medium text-sm mb-1", {
                                  "text-[#D46B08]": isReferenceOnly,
                                  "text-primary-6": !isReferenceOnly,
                                })}
                              >
                                {tag.tagPath.join(" > ")}
                              </div>
                              <div
                                className={cn("text-xs", {
                                  "text-[#FA8C16]": isReferenceOnly,
                                  "text-primary-5": !isReferenceOnly,
                                })}
                              >
                                {t("matchingSource")}: {ipGuidance.title}
                              </div>
                            </div>
                            <div className="text-right shrink-0 pl-4">
                              <div
                                className={cn("text-sm font-medium", {
                                  "text-[#D46B08]": isReferenceOnly,
                                  "text-primary-6": !isReferenceOnly,
                                })}
                              >
                                {t("confidence")}: {ipRecognition.confidence ?? 0}%
                              </div>
                              <div
                                className={cn("text-xs", {
                                  "text-[#FA8C16]": isReferenceOnly,
                                  "text-primary-5": !isReferenceOnly,
                                })}
                              >
                                {ipGuidance.metricNote}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-basic-5">{t("noLinkedTags")}</div>
                    )}
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="text-sm text-basic-5">{ipGuidance.emptyText}</div>
          )}
        </CardContent>
      </div>

      {/* 生效标签 */}
      <div>
        <CardHeader className="pb-2 px-0">
          <CardTitle className="text-sm flex items-center gap-2">
            <TagAIIcon className="w-4 h-4" />
            {t("effectiveTags")} ({result.effectiveTags.length})
            <span className="text-xs font-normal text-basic-5">
              {t("effectiveTagsDescription")}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 px-0">
          <div className="space-y-3">
            {result.effectiveTags.map((tag, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 bg-primary-1 border border-primary-4 rounded-md"
              >
                <CheckIcon className="size-[14px] text-primary-5 mr-2" />
                <div className="flex-1">
                  <div className="font-medium text-sm text-primary-6 mb-1">
                    {tag.tagPath.join(" > ")}
                  </div>
                  <div className="text-xs text-primary-5">
                    {t("matchingSource")}: {tag.matchingSource}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-primary-6">
                    {t("confidence")}: {tag.confidence}%
                  </div>
                  <div className="text-xs text-primary-5">
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
        <CardHeader className="pb-2 px-0">
          <CardTitle className="text-sm flex items-center gap-2 ">
            <CircleQuestionMarkIcon className="size-4" />
            {t("candidateTags")} ({result.candidateTags.length})
            <span className="text-xs font-normal text-basic-5 text">
              {t("candidateTagsDescription")}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 px-0">
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
