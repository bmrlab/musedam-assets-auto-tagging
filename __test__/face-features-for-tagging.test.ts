import { buildFaceFeaturesPromptSection } from "@/app/(tagging)/face-features";
import { describe, expect, it } from "vitest";

describe("buildFaceFeaturesPromptSection", () => {
  it("omits the section when face features are unavailable", () => {
    expect(buildFaceFeaturesPromptSection(undefined)).toBe("");
  });

  it("includes face count and found flag for the model", () => {
    const section = buildFaceFeaturesPromptSection({ faceCount: 3, found: true });
    expect(section).toContain("检测到的人脸数量：3");
    expect(section).toContain("是否检测到人脸：是");
  });

  it("reports no faces when detection found none", () => {
    const section = buildFaceFeaturesPromptSection({ faceCount: 0, found: false });
    expect(section).toContain("检测到的人脸数量：0");
    expect(section).toContain("是否检测到人脸：否");
  });
});
