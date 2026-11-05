/* eslint-disable @next/next/no-img-element */
"use client";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type {
  FeatureDecisionDiagnostics,
  FeatureDecisionInputMode,
  FeatureLlmCallDiagnostics,
} from "@/lib/feature-decision/types";
import { useTranslations } from "next-intl";
import { useState } from "react";

type ComparisonRun = {
  diagnostics: FeatureDecisionDiagnostics;
  matches: Array<{ name: string; confidence: number }>;
};
type ComparisonRuns = Partial<Record<FeatureDecisionInputMode, ComparisonRun>>;

/** Show every LLM prediction, independently of the automatic-application gate. */
export function FeatureDecisionPredictions({
  diagnostics,
  names,
  acceptedCandidateIds,
}: {
  diagnostics: FeatureDecisionDiagnostics;
  names: Record<string, string>;
  acceptedCandidateIds: string[];
}) {
  const t = useTranslations("Tagging.FeatureDecisionDiagnostics");
  const predictions = diagnostics.decision.result?.matches ?? [];
  const accepted = new Set(acceptedCandidateIds);
  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm leading-6 text-basic-5">{t("predictionHelp")}</p>
      {predictions.length ? (
        predictions.map((prediction) => (
          <div
            key={prediction.candidateId}
            className={`space-y-2 rounded-lg border p-4 ${accepted.has(prediction.candidateId) ? "border-success-4 bg-success-1" : "border-warning-4 bg-warning-1"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-basic-8">
              <span className="font-semibold">
                {names[prediction.candidateId] ?? prediction.candidateId}
              </span>
              <span>
                {t("llmConfidence")}: {prediction.confidence}
              </span>
            </div>
            <p className="text-xs font-medium text-basic-5">
              {t(accepted.has(prediction.candidateId) ? "automaticAccepted" : "predictionOnly")}
            </p>
            <p className="text-sm text-basic-8">{prediction.reason}</p>
            {prediction.specificityLimit ? (
              <p className="text-sm text-basic-5">
                {t("specificityLimit")}: {prediction.specificityLimit}
              </p>
            ) : null}
            {prediction.conflicts.length ? (
              <p className="text-sm text-basic-5">
                {t("conflicts")}: {prediction.conflicts.join("; ")}
              </p>
            ) : null}
          </div>
        ))
      ) : (
        <p className="text-sm text-basic-5">{t("noPredictions")}</p>
      )}
    </div>
  );
}

/** Keep the latest run in each mode for the current source and metadata. */
export function useFeatureDecisionComparison() {
  const [runs, setRuns] = useState<ComparisonRuns>({});
  return {
    runs,
    resetRuns: () => setRuns({}),
    recordRun: (diagnostics: FeatureDecisionDiagnostics, matches: ComparisonRun["matches"]) => {
      const mode = diagnostics.decisionInputMode;
      if (diagnostics.mode !== "legacy" && mode) {
        setRuns((current) => ({ ...current, [mode]: { diagnostics, matches } }));
      }
    },
  };
}

export function FeatureDecisionComparison({ runs }: { runs: ComparisonRuns }) {
  const t = useTranslations("Tagging.FeatureDecisionDiagnostics");
  if (!runs.image && !runs.text) return null;
  const count = (value: number | null | undefined) =>
    value == null ? t("unavailable") : value.toLocaleString();
  return (
    <section className="space-y-4 rounded-lg border border-basic-3 bg-background p-6">
      <h3 className="text-lg font-semibold text-basic-8">{t("comparisonTitle")}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {(["image", "text"] as const).map((mode) => {
          const run = runs[mode];
          const call = run?.diagnostics.decision.call;
          return (
            <div
              key={mode}
              className="min-w-0 space-y-3 rounded-lg border border-basic-3 p-4 text-sm text-basic-8"
            >
              <h4 className="font-semibold">
                {t(mode === "image" ? "imageMode" : "textOnlyMode")}
              </h4>
              {run ? (
                <>
                  <p>
                    {t("decisionStatus")}: {t(`status.${run.diagnostics.decision.status}`)}
                  </p>
                  {run.matches.length ? (
                    <ul className="space-y-1">
                      {run.matches.map((match, index) => (
                        <li key={index}>
                          {match.name} · {t("llmConfidence")}: {match.confidence}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-basic-5">{t("noPredictions")}</p>
                  )}
                  <dl className="grid grid-cols-2 gap-2">
                    <dt>{t("inputTokens")}</dt>
                    <dd>{count(call?.usage.inputTokens)}</dd>
                    <dt>{t("outputTokens")}</dt>
                    <dd>{count(call?.usage.outputTokens)}</dd>
                    <dt>{t("totalTokens")}</dt>
                    <dd>{count(call?.usage.totalTokens)}</dd>
                    <dt>{t("ocrTotalTokens")}</dt>
                    <dd>{count(run.diagnostics.ocr.call?.usage.totalTokens)}</dd>
                  </dl>
                  <details>
                    <summary className="cursor-pointer font-medium">{t("runDetails")}</summary>
                    <div className="mt-4">
                      <FeatureDecisionDiagnosticsPanel diagnostics={run.diagnostics} />
                    </div>
                  </details>
                </>
              ) : (
                <p className="text-basic-5">{t("comparisonPending")}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function FeatureClassificationContextInputs({
  imageMode,
  onImageModeChange,
  fileName,
  folderPath,
  onFileNameChange,
  onFolderPathChange,
  disabled,
}: {
  imageMode: boolean;
  onImageModeChange: (enabled: boolean) => void;
  fileName: string;
  folderPath: string;
  onFileNameChange: (value: string) => void;
  onFolderPathChange: (value: string) => void;
  disabled: boolean;
}) {
  const t = useTranslations("Tagging.FeatureDecisionDiagnostics");
  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center justify-between gap-4 rounded-lg border border-basic-3 p-4 text-sm text-basic-8">
        <span className="flex flex-col gap-1">
          <span className="font-medium">{t("imageMode")}</span>
          <span className="text-xs text-basic-5">{t("imageModeHelp")}</span>
        </span>
        <Switch
          checked={imageMode}
          onCheckedChange={onImageModeChange}
          disabled={disabled}
          aria-label={t("imageMode")}
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium text-basic-8">
        {t("fileName")}
        <Input
          value={fileName}
          onChange={(event) => onFileNameChange(event.target.value)}
          maxLength={1000}
          disabled={disabled}
        />
      </label>
      <label className="flex flex-col gap-2 text-sm font-medium text-basic-8">
        {t("folderPath")}
        <Input
          value={folderPath}
          onChange={(event) => onFolderPathChange(event.target.value)}
          placeholder={t("folderPathPlaceholder")}
          maxLength={4000}
          disabled={disabled}
        />
      </label>
      <p className="text-xs leading-4 text-basic-5">{t("contextHelp")}</p>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[480px] overflow-auto rounded-lg border border-basic-3 bg-basic-1 p-4 text-xs leading-5 break-words whitespace-pre-wrap text-basic-8">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

function CallDiagnostics({ call }: { call: FeatureLlmCallDiagnostics }) {
  const t = useTranslations("Tagging.FeatureDecisionDiagnostics");
  const count = (value: number | null) =>
    value === null ? t("unavailable") : value.toLocaleString();
  const cost = (value: number | null) =>
    value === null ? t("notConfigured") : `USD ${value.toFixed(8)}`;
  const metrics = [
    [t("inputTokens"), count(call.usage.inputTokens)],
    [t("outputTokens"), count(call.usage.outputTokens)],
    [t("totalTokens"), count(call.usage.totalTokens)],
    [t("cachedTokens"), count(call.usage.cachedInputTokens)],
    [t("reasoningTokens"), count(call.usage.reasoningTokens)],
    [t("imageTokens"), count(call.usage.imageTokens)],
    [t("inputCost"), cost(call.costs.inputCost)],
    [t("outputCost"), cost(call.costs.outputCost)],
    [t("totalCost"), cost(call.costs.totalCost)],
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-lg border border-basic-3 bg-background p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-basic-8">
        <h4 className="font-semibold">{call.kind === "ocr" ? t("ocrCall") : t("decisionCall")}</h4>
        <span>{call.model}</span>
        <span className="rounded border border-basic-3 bg-basic-1 px-2 py-1 text-xs">
          {t(`status.${call.status}`)}
        </span>
        <span className="text-basic-5">{call.durationMs.toLocaleString()} ms</span>
        {call.id ? (
          <span className="text-xs text-basic-5">
            {t("callId")}: {call.id}
          </span>
        ) : null}
      </div>
      {call.error ? <p className="text-sm text-danger-6">{call.error}</p> : null}
      {call.persistenceError ? (
        <p className="text-sm text-danger-6">
          {t("persistenceError")}: {call.persistenceError}
        </p>
      ) : null}
      <dl className="flex flex-wrap gap-4 text-sm">
        {metrics.map(([label, value]) => (
          <div key={label} className="flex min-w-32 flex-col gap-1">
            <dt className="text-basic-5">{label}</dt>
            <dd className="font-medium text-basic-8">{value}</dd>
          </div>
        ))}
      </dl>
      <details className="flex flex-col gap-4">
        <summary className="cursor-pointer text-sm font-medium text-basic-8">
          {t("request")}
        </summary>
        <div className="flex flex-col gap-4 pt-4">
          {call.request.messages.map((message, index) => (
            <div
              key={index}
              className="flex min-w-0 flex-col gap-3 rounded-lg border border-basic-3 p-4"
            >
              <p className="text-sm font-semibold text-basic-8">
                {index + 1}. {message.role}
              </p>
              {typeof message.content === "string" ? (
                <JsonBlock value={message.content} />
              ) : (
                message.content.map((part, partIndex) =>
                  part.type === "text" ? (
                    <JsonBlock key={partIndex} value={part.text} />
                  ) : (
                    <figure key={partIndex} className="flex flex-col gap-2">
                      <img
                        src={part.image_url.url}
                        alt={t("requestImage", { index: partIndex + 1 })}
                        className="max-h-80 max-w-full self-start rounded-lg border border-basic-3 bg-basic-1 object-contain"
                        loading="lazy"
                      />
                      <figcaption className="text-xs text-basic-5">
                        {t("requestImage", { index: partIndex + 1 })}
                      </figcaption>
                    </figure>
                  ),
                )
              )}
            </div>
          ))}
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-basic-8">
          {t("response")}
        </summary>
        <div className="pt-4">
          <JsonBlock value={call.response ?? t("unavailable")} />
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-basic-8">
          {t("rawResponse")}
        </summary>
        <div className="pt-4">
          <JsonBlock value={call.rawResponse} />
        </div>
      </details>
    </div>
  );
}

export function FeatureDecisionDiagnosticsPanel({
  diagnostics,
}: {
  diagnostics: FeatureDecisionDiagnostics;
}) {
  const t = useTranslations("Tagging.FeatureDecisionDiagnostics");
  const calls = [diagnostics.ocr.call, diagnostics.decision.call].filter(
    (call): call is FeatureLlmCallDiagnostics => Boolean(call),
  );

  return (
    <section className="flex min-w-0 flex-col gap-6 rounded-lg border border-basic-3 bg-background p-6">
      <h3 className="text-lg font-semibold text-basic-8">{t("title")}</h3>
      {diagnostics.mode === "legacy" ? (
        <p className="rounded-lg border border-warning-4 bg-warning-1 p-4 text-sm text-basic-8">
          {t("legacyNotice")}
        </p>
      ) : null}
      {diagnostics.mode !== "legacy" && diagnostics.decisionInputMode ? (
        <p className="text-sm font-medium text-basic-8">
          {t("decisionInputMode")}:{" "}
          {t(diagnostics.decisionInputMode === "image" ? "imageMode" : "textOnlyMode")}
        </p>
      ) : null}
      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold text-basic-8">
          {t("ocrResults")} · {t(`status.${diagnostics.ocr.status}`)}
        </h4>
        {diagnostics.ocr.error ? (
          <p className="text-sm text-danger-6">{diagnostics.ocr.error}</p>
        ) : null}
        {diagnostics.ocr.segments.length ? (
          <ol className="list-inside list-decimal text-sm leading-6 text-basic-8">
            {diagnostics.ocr.segments.map((segment, index) => (
              <li key={index} className="whitespace-pre-wrap">
                {segment}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-basic-5">{t("emptyOcr")}</p>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold text-basic-8">
          {t("decisionStatus")} · {t(`status.${diagnostics.decision.status}`)}
        </h4>
        {diagnostics.decision.error ? (
          <p className="text-sm text-danger-6">{diagnostics.decision.error}</p>
        ) : null}
        {diagnostics.decision.result ? <JsonBlock value={diagnostics.decision.result} /> : null}
        <p className="text-xs leading-4 text-basic-5">
          {t(diagnostics.mode === "legacy" ? "legacyConfidenceHelp" : "confidenceHelp")}
        </p>
      </div>
      {"retrieval" in diagnostics ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-basic-8">
            {t("retrievalEvidence")}
          </summary>
          <div className="pt-4">
            <JsonBlock value={diagnostics.retrieval} />
          </div>
        </details>
      ) : null}
      {calls.map((call, index) => (
        <CallDiagnostics key={`${call.kind}-${index}`} call={call} />
      ))}
    </section>
  );
}
