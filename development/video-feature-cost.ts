/** Offline estimate only. No credentials, remote requests or database access.
 * NODE_OPTIONS=--conditions=react-server pnpm exec tsx development/video-feature-cost.ts
 */
import sharp from "sharp";
import { createVideoContactSheet } from "../src/lib/feature-decision/video-frame-selection";

async function main() {
  const frame = {
    width: 1280,
    height: 720,
    buffer: await sharp({
      create: { width: 1280, height: 720, channels: 3, background: "#6688aa" },
    })
      .jpeg()
      .toBuffer(),
  };
  const { buffer, columns } = await createVideoContactSheet(Array.from({ length: 8 }, () => frame));
  const sheet = await sharp(buffer).metadata();
  // Area estimate before provider-specific rounding/resizing. Actual usage wins.
  const visualTokens = (width: number, height: number) => (width * height) / (32 * 32) + 2;
  const referenceTokens = 5 * visualTokens(768, 768);
  const sources = [
    { name: "image", width: 1280, height: 720 },
    { name: "video-before", width: 1536, height: 1024 },
    { name: "video-after", width: sheet.width!, height: sheet.height! },
  ];
  const estimates = sources.map((source) => {
    const sourceTokens = visualTokens(source.width, source.height);
    const inputTokens = 3000 + sourceTokens + referenceTokens;
    const costPerBatch = (inputTokens * 0.8 + 1000 * 2.7) / 1_000_000;
    return {
      ...source,
      sourceTokens,
      costPerBatchCny: costPerBatch,
      costPer1000AssetsWith3BatchesCny: costPerBatch * 3 * 1000,
    };
  });
  console.log(
    JSON.stringify(
      {
        measured: { selectedFrames: 8, columns, width: sheet.width, height: sheet.height },
        assumptions: {
          model: "qwen3.8-flash",
          inputCnyPerMillion: 0.8,
          outputCnyPerMillion: 2.7,
          textInputTokensPerBatch: 3000,
          outputTokensPerBatch: 1000,
          referencesPerBatch: 5,
          referenceWidth: 768,
          referenceHeight: 768,
          cachedTokens: 0,
          excluded: ["OCR", "embedding", "object detection", "storage", "traffic", "video decode"],
          caveat: "Offline area estimate, not measured model usage or gateway billing",
        },
        estimates,
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
