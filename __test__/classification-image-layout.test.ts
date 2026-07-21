import {
  clampClassificationBox,
  getClassificationBoxPercentages,
  getClassificationImageFrameStyle,
} from "@/app/(tagging)/tagging/components/classification-image-layout";
import { describe, expect, it } from "vitest";

describe("classification image layout", () => {
  it("projects server coordinates independently of preview resolution", () => {
    expect(
      getClassificationBoxPercentages(
        { xMin: 320, yMin: 160, xMax: 960, yMax: 640 },
        { width: 1280, height: 800 },
      ),
    ).toEqual({
      left: 25,
      top: 20,
      width: 50,
      height: 60,
    });
  });

  it("clamps detector boxes in the server image coordinate system", () => {
    expect(
      clampClassificationBox(
        { xMin: -10, yMin: 20, xMax: 1400, yMax: 900, label: "product" },
        { width: 1280, height: 800 },
      ),
    ).toEqual({
      xMin: 0,
      yMin: 20,
      xMax: 1280,
      yMax: 800,
      label: "product",
    });
  });

  it("creates a 720px-high frame for a tall preview", () => {
    expect(getClassificationImageFrameStyle({ width: 640, height: 1280 })).toMatchObject({
      width: "360px",
      maxWidth: "100%",
      aspectRatio: "640 / 1280",
    });
  });
});
