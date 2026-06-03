"use client";

import { TagOutlinedIcon, VimIcon } from "@/components/ui";
import { useFeatureLibraryEnabled } from "@/hooks/use-feature-library";
import {
  getFeatureConfidenceToneClass,
  meetsFeatureConfidenceThreshold,
  normalizeFeatureConfidence,
} from "@/lib/tagging/feature-confidence";
import { cn } from "@/lib/utils";
import {
  CheckIcon,
  CircleQuestionMarkIcon,
  ClockIcon,
  FolderIcon,
  ImageIcon,
  StarIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import type { ReactNode } from "react";
import { FeatureThumbnail } from "./FeatureThumbnail";

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
    logoTypeName: string | null;
    confidence: number | null;
    similarity: number | null;
    assetLogoId?: string;
    recommendedTags: {
      tagPath: string[];
    }[];
  } | null;
  ipRecognition: {
    noConfidentMatch: boolean;
    ipName: string | null;
    ipTypeName: string | null;
    confidence: number | null;
    similarity: number | null;
    imageSimilarity: number | null;
    descriptionSimilarity: number | null;
    assetIpId?: string;
    recommendedTags: {
      tagPath: string[];
    }[];
  } | null;
  productRecognition: {
    noConfidentMatch: boolean;
    productName: string | null;
    productTypeName: string | null;
    confidence: number | null;
    similarity: number | null;
    imageSimilarity: number | null;
    descriptionSimilarity: number | null;
    assetProductId?: string;
    recommendedTags: {
      tagPath: string[];
    }[];
  } | null;
  personRecognition: {
    noConfidentMatch: boolean;
    faceCount: number;
    faces: {
      detectionIndex: number;
      noConfidentMatch: boolean;
      personName: string | null;
      personTypeName: string | null;
      confidence: number | null;
      similarity: number | null;
      assetPersonId?: string;
      recommendedTags: {
        tagPath: string[];
      }[];
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

type DisplayTag = TaggingResult["effectiveTags"][number];
type ResultVariant = "effective" | "candidate";

interface RecognitionFeature {
  key: string;
  title: string;
  featureName: string;
  featureType: string;
  matchingSource: string;
  confidence: number;
  score: number;
  featureTypeId: "brand" | "ip" | "product" | "person";
  featureId: string;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeScore(score: number | null | undefined) {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function getVariantClasses(variant: ResultVariant) {
  if (variant === "candidate") {
    return {
      row: "bg-[#FFF7E6] border-[#FFC069]",
      icon: "text-[#FA8C16]",
      title: "text-[#D46B08]",
      meta: "text-[#FA8C16]",
    };
  }

  return {
    row: "bg-primary-1 border-primary-4",
    icon: "text-primary-5",
    title: "text-primary-6",
    meta: "text-primary-5",
  };
}

function SectionShell({
  icon,
  title,
  count,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  children: ReactNode;
}) {
  const t = useTranslations("TaggingResultDisplay");

  return (
    <section className="rounded-md border border-basic-4 p-5">
      <div className="mb-5 flex items-center gap-2 text-basic-8">
        {icon}
        <h4 className="text-base font-semibold">{title}</h4>
        <span className="text-sm text-basic-5">{t("totalItems", { count })}</span>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function ResultGroup({
  title,
  description,
  count,
  variant,
  children,
}: {
  title: string;
  description: string;
  count: number;
  variant: ResultVariant;
  children: ReactNode;
}) {
  const classes = getVariantClasses(variant);
  const Icon = variant === "effective" ? StarIcon : CircleQuestionMarkIcon;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Icon className={cn("size-4", classes.icon)} />
        <h5 className="text-sm font-semibold text-basic-8">
          {title} ({count})
        </h5>
        <span className="text-sm text-basic-5">{description}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function TagResultRow({ tag, variant }: { tag: DisplayTag; variant: ResultVariant }) {
  const t = useTranslations("TaggingResultDisplay");
  const classes = getVariantClasses(variant);

  return (
    <div
      className={cn("flex items-center justify-between gap-3 rounded-md border p-3", classes.row)}
    >
      <CheckIcon className={cn("size-[14px] shrink-0", classes.icon)} />
      <div className="min-w-0 flex-1">
        <div className={cn("mb-1 truncate text-sm font-medium", classes.title)}>
          {tag.tagPath.join(" > ")}
        </div>
        <div className={cn("text-xs", classes.meta)}>
          {t("matchingSource")}: {tag.matchingSource}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className={cn("text-sm font-medium", classes.title)}>
          {t("confidence")}: {tag.confidence}%
        </div>
        <div className={cn("text-xs", classes.meta)}>
          {t("score")}: {tag.score}
        </div>
      </div>
    </div>
  );
}

function FeatureResultRow({ feature }: { feature: RecognitionFeature }) {
  const t = useTranslations("TaggingResultDisplay");
  const toneClass = getFeatureConfidenceToneClass(feature.confidence);

  return (
    <div className={cn("flex items-center justify-between gap-3 rounded-md border p-3", toneClass)}>
      <CheckIcon className="size-[14px] shrink-0 text-current" />
      <div className="relative size-12 shrink-0 overflow-hidden rounded bg-background/70">
        <FeatureThumbnail
          featureType={feature.featureTypeId}
          featureId={feature.featureId}
          alt={feature.title}
          className="h-full w-full"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 truncate text-sm font-medium text-current">{feature.title}</div>
        <div
          className="mb-1 truncate text-xs text-current/75"
          title={`${feature.featureName} > ${feature.featureType}`}
        >
          {feature.featureName} &gt; {feature.featureType}
        </div>
        <div className="text-xs text-current/60">
          {t("matchingSource")}: {feature.matchingSource}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-medium text-current">
          {t("confidence")}: {feature.confidence}%
        </div>
        <div className="text-xs text-current/75">
          {t("score")}: {feature.score}
        </div>
      </div>
    </div>
  );
}

export function TaggingResultDisplay({ result }: TaggingResultDisplayProps) {
  const t = useTranslations("TaggingResultDisplay");
  const featureLibraryEnabled = useFeatureLibraryEnabled();

  const recognitionFeatures: RecognitionFeature[] = [];

  if (
    featureLibraryEnabled &&
    result.productRecognition?.productName &&
    result.productRecognition.assetProductId &&
    meetsFeatureConfidenceThreshold("product", result.productRecognition.confidence)
  ) {
    const score = normalizeFeatureConfidence(result.productRecognition.confidence);
    recognitionFeatures.push({
      key: "product",
      title: result.productRecognition.productName,
      featureName: t("featureClassProduct"),
      featureType: result.productRecognition.productTypeName || "-",
      matchingSource: t("productRecognition"),
      confidence: score,
      score,
      featureTypeId: "product",
      featureId: result.productRecognition.assetProductId,
    });
  }

  if (
    featureLibraryEnabled &&
    result.brandRecognition?.logoName &&
    result.brandRecognition.assetLogoId &&
    meetsFeatureConfidenceThreshold("brand", result.brandRecognition.confidence)
  ) {
    const score = normalizeFeatureConfidence(result.brandRecognition.confidence);
    recognitionFeatures.push({
      key: "brand",
      title: result.brandRecognition.logoName,
      featureName: t("featureClassBrand"),
      featureType: result.brandRecognition.logoTypeName || "-",
      matchingSource: t("brandRecognition"),
      confidence: score,
      score,
      featureTypeId: "brand",
      featureId: result.brandRecognition.assetLogoId,
    });
  }

  if (
    featureLibraryEnabled &&
    result.ipRecognition?.ipName &&
    result.ipRecognition.assetIpId &&
    meetsFeatureConfidenceThreshold("ip", result.ipRecognition.confidence)
  ) {
    const score = normalizeFeatureConfidence(result.ipRecognition.confidence);
    recognitionFeatures.push({
      key: "ip",
      title: result.ipRecognition.ipName,
      featureName: t("featureClassIp"),
      featureType: result.ipRecognition.ipTypeName || "-",
      matchingSource: t("ipRecognition"),
      confidence: score,
      score,
      featureTypeId: "ip",
      featureId: result.ipRecognition.assetIpId,
    });
  }

  if (featureLibraryEnabled) {
    result.personRecognition?.faces.forEach((face) => {
      if (
        !face.personName ||
        !face.assetPersonId ||
        !meetsFeatureConfidenceThreshold("person", face.confidence)
      ) {
        return;
      }

      const score = normalizeFeatureConfidence(face.confidence);
      recognitionFeatures.push({
        key: `person-${face.detectionIndex}`,
        title: face.personName,
        featureName: t("featureClassPerson"),
        featureType: face.personTypeName || "-",
        matchingSource: t("personRecognition"),
        confidence: score,
        score,
        featureTypeId: "person",
        featureId: face.assetPersonId,
      });
    });
  }

  recognitionFeatures.sort((left, right) => right.confidence - left.confidence);
  const visibleFeatureCount = recognitionFeatures.length;
  const tagCount = result.effectiveTags.length + result.candidateTags.length;

  return (
    <div className="space-y-6 rounded-lg border border-basic-4 bg-background p-6">
      <div className="flex items-start gap-4">
        <div className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-muted">
          {result.asset.thumbnail ? (
            <Image
              src={result.asset.thumbnail}
              alt={result.asset.name}
              fill
              sizes="80px"
              className="object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <ImageIcon className="size-8 text-basic-5" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold" title={result.asset.name}>
            {result.asset.name}
          </h3>
          <div className="mt-1 flex flex-nowrap items-center gap-2 overflow-hidden text-ellipsis text-xs text-basic-5">
            <span>
              {result.asset.extension.toUpperCase()} · {formatFileSize(result.asset.size)}
            </span>
            {result.asset.materializedPath ? (
              <>
                <span>·</span>
                <FolderIcon className="size-3 shrink-0" />
                <span className="truncate">{result.asset.materializedPath}</span>
              </>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
            <div className="flex items-center gap-1">
              <ClockIcon className="size-[14px] text-primary" />
              <span>
                {t("processingTime")}: {result.asset.processingTime}s
              </span>
            </div>
            <div className="flex items-center gap-1">
              <VimIcon className="size-[14px] text-[#9254DE]" />
              <span>
                {t("aiRecognitionMode")}: {result.asset.recognitionMode}
              </span>
            </div>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-3xl font-bold text-primary">{result.overallScore}</div>
          <div className="text-sm text-basic-5">{t("overallScore")}</div>
        </div>
      </div>

      <SectionShell
        icon={<TagOutlinedIcon className="size-5" />}
        title={t("recognizedTags")}
        count={tagCount}
      >
        <ResultGroup
          title={t("effectiveTags")}
          description={t("effectiveTagsDescription")}
          count={result.effectiveTags.length}
          variant="effective"
        >
          {result.effectiveTags.map((tag, index) => (
            <TagResultRow key={`${tag.tagPath.join(">")}-${index}`} tag={tag} variant="effective" />
          ))}
        </ResultGroup>

        <ResultGroup
          title={t("candidateTags")}
          description={t("candidateTagsDescription")}
          count={result.candidateTags.length}
          variant="candidate"
        >
          {result.candidateTags.map((tag, index) => (
            <TagResultRow key={`${tag.tagPath.join(">")}-${index}`} tag={tag} variant="candidate" />
          ))}
        </ResultGroup>

        {tagCount === 0 ? (
          <div className="text-sm text-basic-5">{t("noRecognizedTags")}</div>
        ) : null}
      </SectionShell>

      {featureLibraryEnabled ? (
        <SectionShell
          icon={<StarIcon className="size-5" />}
          title={t("recognizedFeatures")}
          count={visibleFeatureCount}
        >
          {recognitionFeatures.length > 0 ? (
            <div className="space-y-3">
              {recognitionFeatures.map((feature) => (
                <FeatureResultRow key={feature.key} feature={feature} />
              ))}
            </div>
          ) : (
            <div className="text-sm text-basic-5">{t("noRecognizedFeatures")}</div>
          )}
        </SectionShell>
      ) : null}
    </div>
  );
}
