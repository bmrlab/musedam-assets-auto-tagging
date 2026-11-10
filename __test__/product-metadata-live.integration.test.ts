// @vitest-environment node
import { loadEnvConfig } from "@next/env";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

// Explicit opt-in: reads the test catalog and makes paid embedding/decision calls.
// Reuses the recorded detection boxes; does not retry or modify the original task.
it.skipIf(process.env.RUN_PRODUCT_METADATA_LIVE !== "1").each([1754, 1764, 1765])(
  "recognizes the reported Sulwhasoo emulsion for task %s with real embeddings and decisions",
  async (taskId) => {
    loadEnvConfig(process.env.PRODUCT_RECALL_ENV_DIR ?? process.cwd());
    process.env.DEBUG_PAGE = "false";
    process.env.JINA_EMBEDDING_MODEL ||= "jina-clip-v2";
    process.env.FEATURE_DECISION_MODEL ||= "qwen3.8-flash";
    const prisma = (await import("@/prisma/prisma")).default;
    try {
      const task = await prisma.taggingQueueItem.findUniqueOrThrow({
        where: { id: taskId },
        include: { assetObject: true },
      });
      const asset = task.assetObject!;
      expect(asset.name).toMatch(/Essential Revitalizing Emulsion EX_model 05|滋盈琉光乳_开盖/);
      const result = task.result as any;
      const calls = await prisma.featureLlmCall.findMany({
        where: { queueItemId: task.id, kind: "decision", status: "completed" },
        orderBy: { createdAt: "desc" },
      });
      const request = calls[0].request as any;
      const dataUrl = request.messages
        .flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))
        .find((part: any) => part.type === "image_url").image_url.url as string;
      const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
      const meta = await sharp(buffer).metadata();
      const { classifyAssetFeatures } = await import("@/lib/feature-decision/classify");
      const output = await classifyAssetFeatures({
        teamId: task.teamId,
        assetObjectId: asset.id,
        imageInput: {
          dataUrl,
          buffer,
          width: meta.width!,
          height: meta.height!,
          mimeType: "image/jpeg",
          byteLength: buffer.length,
        },
        enabledTypes: ["logo", "product"],
        imageMode: true,
        fileName: asset.name,
        folderPath: asset.materializedPath,
        ocrSegments: result.featureDecision.ocr.segments,
        boxes: {
          product: result.productRecommendation.rawDetections,
          // Whole-image fallback for the unchanged Logo path; product boxes are
          // replayed from the original run so the product regression is comparable.
          logo: [
            { xMin: 0, yMin: 0, xMax: meta.width!, yMax: meta.height!, score: 1, label: "logo" },
          ],
        },
      });
      const summary = {
        asset: asset.name,
        path: asset.materializedPath,
        matches: output.product?.matches.map((m) => ({
          id: m.assetProductId,
          name: m.productName,
          confidence: m.confidence,
        })),
        retrieval: output.diagnostics.retrieval,
        decision: output.diagnostics.decision.result,
        batches: output.diagnostics.decision.batches?.map((b) => ({
          status: b.status,
          error: b.error,
          callId: b.call?.id,
          durationMs: b.call?.durationMs,
        })),
      };
      const dir = process.env.PRODUCT_RECALL_OUTPUT_DIR ?? "/tmp/musedam-product-recall-validation";
      await mkdir(dir, { recursive: true });
      await writeFile(`${dir}/result-${taskId}.json`, JSON.stringify(summary, null, 2));
      console.log(JSON.stringify(summary, null, 2));
      expect(output.diagnostics.retrieval?.errors).toEqual([]);
      expect(output.diagnostics.retrieval?.unassessedCandidates).toEqual([]);
      expect(output.diagnostics.decision.status).toBe("completed");
      expect(output.product?.matches.map((m) => m.productName)).toEqual([
        "雪花秀滋盈琉光润颜乳(1)",
      ]);
      expect(output.product?.matches.some((m) => m.productName.includes("套装"))).toBe(false);
    } finally {
      await prisma.$disconnect();
    }
  },
  600_000,
);
