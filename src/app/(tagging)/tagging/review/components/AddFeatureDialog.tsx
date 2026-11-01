"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useFeatureLibraryFeatures } from "@/hooks/use-feature-library";
import { isFeatureTypeEnabled } from "@/lib/feature-library";
import { cn } from "@/lib/utils";
import { CheckIcon, Loader2Icon, SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { searchReviewFeaturesAction } from "../actions";
import {
  featureKey,
  type ReviewFeatureSearchResult,
  type ReviewFeatureType,
} from "../feature-review";
import { FeatureThumbnail } from "./FeatureThumbnail";

const FEATURE_TYPES: ReviewFeatureType[] = ["brand", "ip", "product", "person"];
const SEARCH_DEBOUNCE_MS = 300;

export function AddFeatureDialog({
  open,
  onOpenChange,
  addedKeys,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Features already on this review card (AI-recognized or manually added). */
  addedKeys: Set<string>;
  onConfirm: (features: ReviewFeatureSearchResult[]) => void;
}) {
  const t = useTranslations("Tagging.Review");
  const tResult = useTranslations("TaggingResultDisplay");
  const featureLibraryFeatures = useFeatureLibraryFeatures();
  const enabledTypes = FEATURE_TYPES.filter((type) =>
    isFeatureTypeEnabled(featureLibraryFeatures, type),
  );
  const [featureType, setFeatureType] = useState<ReviewFeatureType | "all">("all");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReviewFeatureSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Map<string, ReviewFeatureSearchResult>>(new Map());
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const requestId = ++requestIdRef.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const result = await searchReviewFeaturesAction({
          query,
          featureType: featureType === "all" ? undefined : featureType,
        });
        if (requestId !== requestIdRef.current) return;
        setResults(result.success ? result.data : []);
      } catch (error) {
        console.error(error);
        if (requestId === requestIdRef.current) setResults([]);
      } finally {
        if (requestId === requestIdRef.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, query, featureType]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setQuery("");
      setFeatureType("all");
      setSelected(new Map());
      setResults([]);
    }
    onOpenChange(next);
  };

  const toggle = (feature: ReviewFeatureSearchResult) => {
    const key = featureKey(feature.featureType, feature.id);
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(key)) next.delete(key);
      else next.set(key, feature);
      return next;
    });
  };

  const featureClassLabel = (type: ReviewFeatureType) =>
    tResult(
      (
        {
          brand: "featureClassBrand",
          ip: "featureClassIp",
          product: "featureClassProduct",
          person: "featureClassPerson",
        } as const
      )[type],
    );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-4 sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("addFeatureTitle")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {(["all", ...enabledTypes] as const).map((type) => (
            <button
              key={type}
              type="button"
              className={cn(
                "rounded-[6px] border px-3 py-1 text-xs transition-colors",
                featureType === type
                  ? "border-primary-6 bg-primary-1 text-primary-6"
                  : "border-basic-3 text-basic-7 hover:border-primary-5",
              )}
              onClick={() => setFeatureType(type)}
            >
              {type === "all" ? t("addFeatureAllTypes") : featureClassLabel(type)}
            </button>
          ))}
        </div>

        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-basic-5" />
          <Input
            autoFocus
            value={query}
            placeholder={t("addFeatureSearchPlaceholder")}
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="-mx-1 min-h-[240px] flex-1 space-y-2 overflow-y-auto px-1">
          {searching && results.length === 0 ? (
            <div className="flex h-[240px] items-center justify-center text-basic-5">
              <Loader2Icon className="size-5 animate-spin" />
            </div>
          ) : !searching && results.length === 0 ? (
            <div className="flex h-[240px] items-center justify-center text-sm text-basic-5">
              {t("addFeatureNoResults")}
            </div>
          ) : (
            results.map((feature) => {
              const key = featureKey(feature.featureType, feature.id);
              const alreadyAdded = addedKeys.has(key);
              const isSelected = selected.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  disabled={alreadyAdded}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                    // 新一轮搜索返回前，旧结果置灰，避免被当成本次的搜索结果
                    searching && "opacity-50",
                    isSelected
                      ? "border-primary-6 bg-primary-1"
                      : "border-basic-3 bg-background hover:border-primary-5",
                  )}
                  onClick={() => toggle(feature)}
                >
                  <div className="relative size-10 shrink-0 overflow-hidden rounded bg-basic-2">
                    <FeatureThumbnail
                      featureType={feature.featureType}
                      featureId={feature.id}
                      alt={feature.name}
                      className="h-full w-full"
                      initialImage={feature.thumbnail}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium leading-[18px]">
                      {feature.name}
                    </div>
                    <div className="mt-1 truncate text-xs text-basic-5">
                      {featureClassLabel(feature.featureType)} &gt; {feature.typeName || "-"}
                    </div>
                    {feature.tags.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {feature.tags.map((tag) => (
                          <span
                            key={tag.assetTagId}
                            className="inline-flex items-center rounded-sm border bg-background px-1.5 py-0.5 text-[10px] text-basic-5"
                          >
                            {tag.tagPath.join(" > ")}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 pt-0.5 text-xs">
                    {alreadyAdded ? (
                      <span className="text-basic-5">{t("addFeatureAlreadyAdded")}</span>
                    ) : isSelected ? (
                      <CheckIcon className="size-4 text-primary-6" />
                    ) : null}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t("rejectConfirmCancel")}
          </Button>
          <Button
            disabled={selected.size === 0}
            onClick={() => {
              onConfirm([...selected.values()]);
              handleOpenChange(false);
            }}
          >
            {t("addFeatureConfirm", { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
