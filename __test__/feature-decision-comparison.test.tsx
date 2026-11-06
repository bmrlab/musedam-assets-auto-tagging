import {
  FeatureClassificationContextInputs,
  FeatureDecisionComparison,
  FeatureDecisionPredictions,
  useFeatureDecisionComparison,
} from "@/app/(tagging)/tagging/components/FeatureDecisionDiagnosticsPanel";
import type { FeatureDecisionDiagnostics } from "@/lib/feature-decision/types";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
afterEach(cleanup);

function diagnostics(mode: "image" | "text"): FeatureDecisionDiagnostics {
  const total = mode === "image" ? 500 : 100;
  return {
    mode: "llm",
    decisionInputMode: mode,
    ocr: { status: "completed", segments: ["Model A"] },
    decision: {
      status: "completed",
      result: { outcome: "matched", matches: [] },
      call: {
        kind: "decision",
        model: "model",
        status: "completed",
        durationMs: 10,
        request: { model: "model", messages: [] },
        response: "{}",
        rawResponse: {},
        usage: {
          inputTokens: total - 10,
          outputTokens: 10,
          totalTokens: total,
          cachedInputTokens: null,
          reasoningTokens: null,
          imageTokens: mode === "image" ? 400 : 0,
        },
        costs: {
          currency: "USD",
          inputCost: null,
          outputCost: null,
          totalCost: null,
          inputPricePerMillion: null,
          cachedInputPricePerMillion: null,
          outputPricePerMillion: null,
        },
      },
    },
  };
}

function ComparisonHarness() {
  const { runs, recordRun, resetRuns } = useFeatureDecisionComparison();
  return (
    <>
      <button
        onClick={() => recordRun(diagnostics("image"), [{ name: "Image match", confidence: 95 }])}
      >
        Run image
      </button>
      <button
        onClick={() => recordRun(diagnostics("text"), [{ name: "Text match", confidence: 86 }])}
      >
        Run text
      </button>
      <button onClick={resetRuns}>Change source</button>
      <FeatureDecisionComparison runs={runs} />
    </>
  );
}

describe("decision input mode controls and comparison", () => {
  it("shows all low-confidence predictions and their limitations without labeling them automatically accepted", () => {
    const result = diagnostics("text");
    result.decision.result = {
      outcome: "matched",
      matches: [
        {
          candidateId: "product:a",
          confidence: 43,
          reason: "Plausible variant A",
          evidence: ["retrieval"],
          conflicts: [],
          specificityLimit: "Capacity unresolved",
        },
        {
          candidateId: "product:b",
          confidence: 0,
          reason: "Weak alternative B",
          evidence: ["ocr"],
          conflicts: ["Filename conflicts"],
          specificityLimit: null,
        },
      ],
    };
    render(
      <FeatureDecisionPredictions
        diagnostics={result}
        names={{ "product:a": "Variant A", "product:b": "Variant B" }}
        acceptedCandidateIds={[]}
      />,
    );
    expect(screen.getByText("Variant A")).toBeTruthy();
    expect(screen.getByText("Variant B")).toBeTruthy();
    expect(screen.getByText("llmConfidence: 43")).toBeTruthy();
    expect(screen.getByText("llmConfidence: 0")).toBeTruthy();
    expect(screen.getByText("specificityLimit: Capacity unresolved")).toBeTruthy();
    expect(screen.getByText("conflicts: Filename conflicts")).toBeTruthy();
    expect(screen.getAllByText("predictionOnly")).toHaveLength(2);
    expect(screen.queryByText("automaticAccepted")).toBeNull();
  });

  it("defaults to text-only and can switch to image inputs without disabling the decision layer", () => {
    function Inputs() {
      const [imageMode, setImageMode] = useState(false);
      return (
        <FeatureClassificationContextInputs
          imageMode={imageMode}
          onImageModeChange={setImageMode}
          fileName="file.jpg"
          folderPath="/catalog"
          onFileNameChange={() => {}}
          onFolderPathChange={() => {}}
          disabled={false}
        />
      );
    }
    render(<Inputs />);
    const toggle = screen.getByRole("switch", { name: "imageMode" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("imageModeHelp")).toBeTruthy();
  });

  it("retains both modes' confidence and usage until the source changes", () => {
    render(<ComparisonHarness />);
    fireEvent.click(screen.getByText("Run image"));
    expect(screen.getByText("comparisonPending")).toBeTruthy();
    fireEvent.click(screen.getByText("Run text"));
    expect(screen.queryByText("comparisonPending")).toBeNull();
    const comparison = screen.getByText("comparisonTitle").closest("section")!;
    expect(within(comparison).getByText("Image match · llmConfidence: 95")).toBeTruthy();
    expect(within(comparison).getByText("Text match · llmConfidence: 86")).toBeTruthy();
    expect(within(comparison).getAllByText("500")[0]).toBeTruthy();
    expect(within(comparison).getAllByText("100")[0]).toBeTruthy();
    fireEvent.click(screen.getByText("Change source"));
    expect(screen.queryByText("comparisonTitle")).toBeNull();
  });
});
