import { allowsLogoFolderMatch, logoFolderAlias } from "@/lib/feature-decision/path-candidates";
import { rethresholdFeatures } from "@/lib/tagging/rethreshold-features";
import { describe, expect, it } from "vitest";

describe("explicit logo folder inclusion", () => {
  it("recognizes bilingual catalog aliases without inventing a vector score", () => {
    const name = "雪花秀/SULWHASOO LOGO(1)";
    expect(logoFolderAlias(name, "amore/雪花秀-琉光系列/成分&质地")).toBe("雪花秀");
    expect(logoFolderAlias(name, "amore/Sulwhasoo/texture")).toBe("SULWHASOO");
    expect(logoFolderAlias(name, "amore/other/texture")).toBeNull();
    expect(logoFolderAlias("吕/RYO LOGO(1)", "amore/embryo")).toBeNull();
    expect(allowsLogoFolderMatch("素材画面和文件夹名称包含SULWHASOO的都需要打出该特征")).toBe(true);
    expect(allowsLogoFolderMatch("不论颜色，包含LANEIGE都打上该标签")).toBe(false);
    expect(allowsLogoFolderMatch("不要根据文件夹名称包含品牌来判断")).toBe(false);
  });
  it("preserves the explicit path gate when review thresholds are recomputed", () => {
    const result = {
      brandRecommendation: {
        matches: [],
        noConfidentMatch: true,
        bestMatch: null,
        recommendedTags: [],
      },
      featureDecision: {
        folderMatchedLogoIds: ["snow"],
        decisionInputMode: "text",
        ocr: { status: "empty", segments: [] },
        decision: {
          status: "completed",
          result: {
            outcome: "matched",
            matches: [
              {
                candidateId: "logo:snow",
                confidence: 94,
                evidence: ["path"],
                reason: "文件夹匹配",
                conflicts: [],
                specificityLimit: null,
              },
              {
                candidateId: "logo:other",
                confidence: 94,
                evidence: ["path"],
                reason: "未配置",
                conflicts: [],
                specificityLimit: null,
              },
            ],
          },
        },
      },
    };
    const output = rethresholdFeatures(result, { brand: 60, product: 60, ip: 60, person: 60 });
    expect(output.brandRecommendation?.matches?.map((m) => m.assetLogoId)).toEqual(["snow"]);
    expect(
      rethresholdFeatures(result, { brand: 95, product: 60, ip: 60, person: 60 })
        .brandRecommendation?.matches,
    ).toEqual([]);
  });
});
