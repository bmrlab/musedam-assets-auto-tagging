import { getDetectionLabelTokenUpperBound } from "@/lib/detection-label";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/ai/provider", () => ({ llm: vi.fn() }));
vi.mock("ai", () => ({ generateObject: vi.fn() }));

let buildProductDetectionLabelText: typeof import("@/lib/product/detection-prompt").buildProductDetectionLabelText;

beforeAll(async () => {
  ({ buildProductDetectionLabelText } = await import("@/lib/product/detection-prompt"));
});

const identityTranslation = async (text: string) => text;

describe("product detection prompt", () => {
  it("uses names and categories while the detailed prompt fits", async () => {
    const summarize = vi.fn();
    const result = await buildProductDetectionLabelText(
      [{ name: "Acme Runner", generalCategory: "shoe" }],
      { translate: identityTranslation, summarize },
    );

    expect(result).toBe("acme runner . shoe .");
    expect(summarize).not.toHaveBeenCalled();
  });

  it("drops product names before asking the LLM to summarize categories", async () => {
    const summarize = vi.fn();
    const result = await buildProductDetectionLabelText(
      [
        { name: "x".repeat(300), generalCategory: "shoe" },
        { name: "y".repeat(300), generalCategory: "bag" },
      ],
      { translate: identityTranslation, summarize },
    );

    expect(result).toBe("shoe . bag .");
    expect(summarize).not.toHaveBeenCalled();
  });

  it("summarizes an oversized category-only prompt", async () => {
    const summarize = vi.fn().mockResolvedValue(["wearable", "electronics"]);
    const result = await buildProductDetectionLabelText(
      [
        { name: "first", generalCategory: "a".repeat(140) },
        { name: "second", generalCategory: "b".repeat(140) },
      ],
      { translate: identityTranslation, summarize },
    );

    expect(summarize).toHaveBeenCalledTimes(1);
    expect(result).toBe("wearable . electronics .");
  });

  it("hard-truncates as the last fallback when the summary is still oversized", async () => {
    const result = await buildProductDetectionLabelText(
      [{ name: "first", generalCategory: "a".repeat(300) }],
      {
        translate: identityTranslation,
        summarize: async () => ["z".repeat(400)],
      },
    );

    expect(getDetectionLabelTokenUpperBound(result)).toBeLessThanOrEqual(256);
    expect(result.endsWith(" .")).toBe(true);
  });
});
