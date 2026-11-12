// @vitest-environment node
import {
  createVideoContactSheet,
  measureVideoFrame,
  selectVideoFrames,
  videoSheetLayout,
} from "@/lib/feature-decision/video-frame-selection";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("video evidence selection", () => {
  it("recognizes blank extremes while preserving dark scenes with visible details", async () => {
    const blank = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "black" },
    })
      .png()
      .toBuffer();
    const detailed = await sharp(blank)
      .composite([
        {
          input: await sharp({
            create: { width: 20, height: 20, channels: 3, background: "white" },
          })
            .png()
            .toBuffer(),
          left: 22,
          top: 22,
        },
      ])
      .png()
      .toBuffer();
    const black = await measureVideoFrame(blank);
    const visible = await measureVideoFrame(detailed);
    expect(black.blank).toBe(true);
    expect(visible.blank).toBe(false);
    expect(visible.sharpness).toBeGreaterThan(black.sharpness);
    expect(
      selectVideoFrames([
        { ...black, timestamp: 0 },
        { ...visible, timestamp: 0.5 },
      ]),
    ).toEqual([{ ...visible, timestamp: 0.5 }]);
    expect(selectVideoFrames([{ ...black, timestamp: 0 }])).toHaveLength(1);
  });

  it("keeps the sharper duplicate and preserves distinct soft frames", () => {
    const frame = (value: number, timestamp: number, sharpness: number) => ({
      timestamp,
      sharpness,
      blank: false,
      fingerprint: Buffer.alloc(32 * 32 * 3, value),
    });
    const blurry = frame(80, 0, 1);
    const clear = frame(81, 0.5, 100);
    const distinct = frame(140, 1, 0);
    expect(selectVideoFrames([blurry, clear, distinct])).toEqual([clear, distinct]);
  });

  it("bounds detection to eight temporally spread frames and retains the last sample", () => {
    const frames = Array.from({ length: 12 }, (_, index) => ({
      timestamp: index / 3,
      sharpness: 10,
      blank: false,
      fingerprint: Buffer.alloc(32 * 32 * 3, 20 + index * 15),
    }));
    const selected = selectVideoFrames(frames);
    expect(selected).toHaveLength(8);
    expect(selected[0]).toBe(frames[0]);
    expect(selected.at(-1)).toBe(frames.at(-1));
    expect(selectVideoFrames([])).toEqual([]);
  });

  it.each([0.25, 9 / 16, 1, 16 / 9, 4])(
    "fits aspect %s without increasing the old sheet pixel budget",
    (ratio) => {
      for (let count = 1; count <= 8; count++) {
        const layout = videoSheetLayout(
          Array.from({ length: count }, () => ({ width: ratio * 1000, height: 1000 })),
        );
        expect(layout.tileWidth / layout.tileHeight).toBeCloseTo(ratio, 1);
        const pixels =
          layout.columns * Math.ceil(count / layout.columns) * layout.tileWidth * layout.tileHeight;
        const oldColumns = Math.min(4, count);
        expect(pixels).toBeLessThanOrEqual(oldColumns * Math.ceil(count / oldColumns) * 384 * 512);
      }
    },
  );

  it("renders the measured landscape layout in chronological order", async () => {
    const frames = await Promise.all(
      ["red", "blue"].map(async (background) => ({
        buffer: await sharp({ create: { width: 1280, height: 720, channels: 3, background } })
          .png()
          .toBuffer(),
        width: 1280,
        height: 720,
      })),
    );
    const { buffer, columns } = await createVideoContactSheet(frames);
    const layout = videoSheetLayout(frames);
    const metadata = await sharp(buffer).metadata();
    expect(metadata.width).toBe(columns * layout.tileWidth);
    expect(metadata.height).toBe(Math.ceil(frames.length / columns) * layout.tileHeight);
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) =>
      Array.from(data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3));
    expect(pixel(100, 100)[0]).toBeGreaterThan(240);
    expect(
      pixel(
        columns === 1 ? 100 : layout.tileWidth + 100,
        columns === 1 ? layout.tileHeight + 100 : 100,
      )[2],
    ).toBeGreaterThan(240);
  });
});
