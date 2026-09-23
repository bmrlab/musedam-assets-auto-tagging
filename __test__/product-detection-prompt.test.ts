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
  it("uses only visual categories even when catalog names would fit", async () => {
    const translate = vi.fn(identityTranslation);
    const summarize = vi.fn();
    const result = await buildProductDetectionLabelText(
      [
        { name: "Acme Runner", generalCategory: "shoe" },
        { name: "Breeze Runner", generalCategory: " SHOE " },
        { name: "Acme Tote", generalCategory: "bag" },
      ],
      { translate, summarize },
    );

    expect(result).toBe("shoe . bag .");
    expect(translate).toHaveBeenCalledExactlyOnceWith("shoe . bag");
    expect(summarize).not.toHaveBeenCalled();
  });

  it("does not include catalog names when categories are missing", async () => {
    const summarize = vi.fn();
    const result = await buildProductDetectionLabelText(
      [{ name: "Acme Runner", generalCategory: "  " }],
      { translate: identityTranslation, summarize },
    );

    expect(result).toBe("product .");
    expect(summarize).not.toHaveBeenCalled();
  });

  it("translates non-English categories before checking the token budget", async () => {
    const translate = vi.fn().mockResolvedValue("bottle . bag");
    const result = await buildProductDetectionLabelText(
      [
        { name: "品牌 A", generalCategory: "瓶子" },
        { name: "品牌 B", generalCategory: "包" },
      ],
      { translate },
    );

    expect(translate).toHaveBeenCalledExactlyOnceWith("瓶子 . 包");
    expect(result).toBe("bottle . bag .");
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

  it("still enforces the token budget when category summarization fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await buildProductDetectionLabelText(
        [{ name: "first", generalCategory: "a".repeat(400) }],
        {
          translate: identityTranslation,
          summarize: async () => {
            throw new Error("summary unavailable");
          },
        },
      );

      expect(getDetectionLabelTokenUpperBound(result)).toBeLessThanOrEqual(256);
      expect(result.endsWith(" .")).toBe(true);
      expect(warning).toHaveBeenCalledOnce();
    } finally {
      warning.mockRestore();
    }
  });
});
