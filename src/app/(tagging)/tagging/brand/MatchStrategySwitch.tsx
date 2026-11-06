"use client";

import { TriangleAlert } from "lucide-react";

export type LogoReferenceMatchStrategy = "highest" | "average";

type TranslationFunction = (key: string, values?: Record<string, string | number>) => string;

export function MatchStrategySwitch({
  value,
  onChange,
  disabled,
  t,
}: {
  value: LogoReferenceMatchStrategy;
  onChange: (value: LogoReferenceMatchStrategy) => void;
  disabled?: boolean;
  t: TranslationFunction;
}) {
  return (
    <div className="inline-flex rounded-[6px] bg-basic-2 p-0.5">
      {(["average", "highest"] as const).map((strategy) => (
        <button
          key={strategy}
          type="button"
          disabled={disabled}
          aria-pressed={value === strategy}
          onClick={() => onChange(strategy)}
          className={`h-7 rounded-[5px] px-3 text-[13px] transition-colors ${
            value === strategy
              ? "bg-primary-6 text-white shadow-sm"
              : "text-basic-7 hover:bg-basic-3 disabled:opacity-60"
          }`}
        >
          {t(`dialog.matchStrategy.${strategy}`)}
        </button>
      ))}
    </div>
  );
}

export function MatchStrategyHint({
  strategy,
  t,
}: {
  strategy: LogoReferenceMatchStrategy;
  t: TranslationFunction;
}) {
  return (
    <div className="flex items-start gap-[10px] rounded-[8px] border border-warning-3 bg-warning-1 px-3 py-[14px] text-[12px] leading-[16px] font-normal text-basic-8">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-7" aria-hidden="true" />
      <p className="text-[12px] leading-[16px] font-normal text-basic-8">
        <span className="font-semibold">{t(`dialog.matchStrategy.${strategy}`)}: </span>
        {t(`dialog.matchStrategyHint.${strategy}`)}
      </p>
    </div>
  );
}
