"use client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getFeatureRetryStatus, retryFeatures } from "../feature-retry-actions";

const RetryLayout = createContext<{ button: ReactNode; content: ReactNode } | null>(null);
export function FeatureRetryButton() {
  return useContext(RetryLayout)?.button ?? null;
}
export function FeatureRetryContent() {
  return useContext(RetryLayout)?.content ?? null;
}

type Status = "idle" | "submitting" | "pending" | "processing" | "unknown";
export function FeatureRetryControl({
  sourceId,
  disabled,
  onComplete,
  children,
}: {
  sourceId: number;
  disabled?: boolean;
  onComplete?: () => void;
  children?: ReactNode;
}) {
  const t = useTranslations("Tagging.Review");
  const [status, setStatus] = useState<Status>("idle");
  const [failed, setFailed] = useState(false);
  const [check, setCheck] = useState(0);
  const complete = useRef(onComplete);
  complete.current = onComplete;
  const submitting = useRef(false);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const poll = async () => {
      try {
        const response = await getFeatureRetryStatus(sourceId);
        if (disposed) return;
        failures = 0;
        const next = response.data?.status;
        if (next === "pending" || next === "processing") {
          setStatus(next);
          timer = setTimeout(poll, 3000);
        } else {
          setStatus("idle");
          setFailed(next === "failed");
          if (next === "completed") complete.current?.();
        }
      } catch {
        if (disposed) return;
        if (++failures < 3) timer = setTimeout(poll, 3000);
        else setStatus("unknown");
      }
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [sourceId, check]);
  const retry = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setStatus("submitting");
    setFailed(false);
    try {
      const response = await retryFeatures(sourceId);
      if (!response.success) throw Error(response.message);
      setStatus(response.data.status === "processing" ? "processing" : "pending");
      setCheck((value) => value + 1);
    } catch {
      setStatus("idle");
      setFailed(true);
    } finally {
      submitting.current = false;
    }
  };
  const retrying = status === "submitting" || status === "pending" || status === "processing";
  const button = (
    <Button
      variant="outline"
      size="sm"
      className="h-9 shrink-0 gap-2 rounded-md px-4 text-sm"
      disabled={disabled || retrying}
      onClick={() => (status === "unknown" ? setCheck((value) => value + 1) : void retry())}
    >
      <RefreshCwIcon className={retrying ? "size-4 animate-spin" : "size-4"} />
      {t(
        retrying
          ? "featureRetryRunning"
          : status === "unknown"
            ? "featureRetryCheck"
            : "featureRetryButton",
      )}
    </Button>
  );
  const content = (
    <div role="status" aria-live="polite">
      {status === "processing" ? (
        <div className="flex items-start gap-3 py-2" aria-label={t("featureRetryProcessing")}>
          <Skeleton className="size-10 shrink-0 rounded" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ) : !retrying ? (
        <p className="text-sm leading-[22px] text-basic-6">
          {t(
            status === "unknown"
              ? "featureRetryStatusUnknown"
              : failed
                ? "featureRetryFailed"
                : "featureRetryIncomplete",
          )}
        </p>
      ) : null}
    </div>
  );
  return (
    <RetryLayout.Provider value={{ button, content }}>
      {children ?? (
        <div className="flex flex-col gap-3">
          {button}
          {content}
        </div>
      )}
    </RetryLayout.Provider>
  );
}
