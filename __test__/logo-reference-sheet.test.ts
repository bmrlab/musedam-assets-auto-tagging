import { prepareLogoReferenceSheet } from "@/lib/feature-decision/logo-reference-sheet";
import { buildFeatureDecisionMessages } from "@/lib/feature-decision/prompts";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

async function sample(color: string) {
  const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

describe("all uploaded logo variants in one bounded reference slot", () => {
  it("rejects an oversized sheet before downloads rather than exhausting memory or dropping samples", async () => {
    const load = vi.fn();
    await expect(prepareLogoReferenceSheet(Array.from({ length: 1000 }, (_, i) => ({ objectKey: `oversized-${i}` })), load))
      .rejects.toThrow("pixel budget");
    expect(load).not.toHaveBeenCalled();
  });

  it("includes the last of 28 variants and bounds concurrent preparation", async () => {
    const red = await sample("#ff0000"), blue = await sample("#0000ff");
    const images = Array.from({ length: 28 }, (_, i) => ({ id: `variant-${i}`, objectKey: `all28-${i}` }));
    let active = 0, maximum = 0;
    const load = vi.fn(async (key: string) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      return key.endsWith("-27") ? blue : red;
    });
    const result = await prepareLogoReferenceSheet(images, load);
    expect(load).toHaveBeenCalledTimes(28);
    expect(maximum).toBeLessThanOrEqual(4);
    expect(result.referenceImageCount).toBe(28);
    expect(result.referenceImageIds).toEqual(images.map(image => image.id));
    const buffer = Buffer.from(result.dataUrl.split(",")[1], "base64");
    expect(await sharp(buffer).metadata()).toMatchObject({ width: 768, height: 510 });
    const pixel = await sharp(buffer).extract({ left: 3 * 128 + 64, top: 4 * 102 + 51, width: 1, height: 1 }).raw().toBuffer();
    expect(pixel[0]).toBeLessThan(20);
    expect(pixel[2]).toBeGreaterThan(235);
    const messages = buildFeatureDecisionMessages({ sourceImage: "source", imageMode: true,
      ocr: { status: "empty", segments: [] }, candidates: [{
        candidateId: "logo:hera", classId: "hera", featureType: "logo", name: "HERA", typeName: "Logo",
        similarity: 0.8, referenceImage: result.dataUrl, referenceImageCount: result.referenceImageCount,
        referenceImageIds: result.referenceImageIds, referenceMatchStrategy: "highest",
      }] });
    const content = messages[1].content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) throw new Error("Expected image request");
    expect(content.filter(part => part.type === "image_url")).toHaveLength(2);
    expect(content.find(part => part.type === "text" && part.text.includes("contact sheet of 28"))).toBeDefined();
  });

  it("caps a 61-sample logo sheet on both axes without dropping variants", async () => {
    const image = await sample("#00ff00");
    const result = await prepareLogoReferenceSheet(Array.from({ length: 61 }, (_, i) => ({ id: `large-${i}`, objectKey: `large-${i}` })), async () => image);
    const meta = await sharp(Buffer.from(result.dataUrl.split(",")[1], "base64")).metadata();
    expect(result.referenceImageCount).toBe(61);
    expect(result.referenceImageIds).toHaveLength(61);
    expect(meta.width).toBeLessThanOrEqual(768);
    expect(meta.height).toBeLessThanOrEqual(768);
  });

  it("keeps a single reference unchanged", async () => {
    const image = await sample("#00ff00");
    expect(await prepareLogoReferenceSheet([{ id: "single", objectKey: "single" }], async () => image))
      .toEqual({ dataUrl: image, referenceImageCount: 1, referenceImageIds: ["single"] });
  });

  it("does not silently drop an unavailable graphical variant or cache a partial sheet", async () => {
    const images = [{ objectKey: "retry-text" }, { objectKey: "retry-symbol" }];
    const image = await sample("#000000");
    await expect(prepareLogoReferenceSheet(images, async key => {
      if (key === "retry-symbol") throw new Error("symbol unavailable");
      return image;
    })).rejects.toThrow("symbol unavailable");
    const load = vi.fn(async () => image);
    expect((await prepareLogoReferenceSheet(images, load)).referenceImageCount).toBe(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("reuses completed sheets and invalidates them when another variant is uploaded", async () => {
    const images = [{ objectKey: "cached-text" }, { objectKey: "cached-symbol" }];
    const image = await sample("#999999");
    const load = vi.fn(async () => image);
    const first = await prepareLogoReferenceSheet(images, load);
    expect(await prepareLogoReferenceSheet(images, load)).toEqual(first);
    expect(load).toHaveBeenCalledTimes(2);
    expect((await prepareLogoReferenceSheet([...images, { objectKey: "cached-new" }], load)).referenceImageCount).toBe(3);
    expect(load).toHaveBeenCalledTimes(5);
  });
});
