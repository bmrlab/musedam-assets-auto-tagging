import messages from "@/app/(tagging)/messages/zh-CN.json";
import { MetadataResults } from "@/app/(tagging)/tagging/components/MetadataResults";
import { metadataDisplayValues } from "@/lib/metadata/display";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { prediction } from "../development/metadata-preview/actions";

describe("metadata review display", () => {
  it("keeps false and zero but excludes empty values and record internals", () => {
    expect(
      metadataDisplayValues({
        materialId: 1,
        recordId: "r",
        __metadata: {},
        Checked: false,
        Number: 0,
        Empty: "",
        Null: null,
        Choices: [],
      }),
    ).toEqual([
      { name: "Checked", value: false },
      { name: "Number", value: 0 },
    ]);
  });
  it("resolves cascade node IDs using the field snapshot", () => {
    expect(
      metadataDisplayValues({
        Category: ["node-1"],
        __metadata: { fields: [{ name: "Category", options: [{ id: "node-1", label: "海报" }] }] },
      }),
    ).toEqual([{ name: "Category", value: ["海报"] }]);
  });
  it("shows field counts, separate candidate status, sources and confidence in test results", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="zh-CN" messages={messages}>
        <MetadataResults
          testResult
          predictions={[
            prediction,
            { ...prediction, fieldId: "b", score: 76, effective: false, checked: false },
            { ...prediction, fieldId: "c", score: 50 },
          ]}
        />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("元数据字段 (2)");
    expect(html).toContain("未勾选");
    expect(html).toContain("候选");
    expect(html).toContain("置信度：中 · 76%");
    expect(html).toContain("基础信息匹配");
    expect(html).not.toContain("50%");
  });
});
