import "server-only";
import { FEATURE_DECISION_MODE } from "./config";

import {
  classifyBrandImageCrops,
  detectBrandLogoBoxes,
  type BrandClassificationResult,
  type BrandTopMatch,
} from "@/lib/brand/logo-classification";
import { fetchLogoDetectionLabelText } from "@/lib/brand/logo-detection-prompt";
import {
  classifyIpImageCrops,
  detectIpFigureBoxes,
  type IpClassificationResult,
  type IpTopMatch,
} from "@/lib/ip/ip-classification";
import {
  classifyProductImageRegions,
  detectProductFigureBoxes,
  type ProductClassificationResult,
  type ProductTopMatch,
} from "@/lib/product/product-classification";
import { deduplicateProductMatches } from "@/lib/product/product-match-policy";
import { getCachedSignedS3ObjectUrl } from "@/lib/s3";
import {
  clampBox,
  cropImageToDataUrl,
  fetchRemoteImageInput,
  getFallbackBox,
  MAX_DETECTION_CROPS,
  type ClassificationDetectionBox,
  type ClassificationRemoteImageInput,
} from "@/lib/tagging/classification-image";
import { meetsFeatureConfidenceThreshold } from "@/lib/tagging/feature-confidence";
import prisma from "@/prisma/prisma";
import pLimit from "p-limit";
import { MAX_FEATURE_REFERENCES, selectFeatureRegions, type DecisionFeatureType } from "./regions";
import { runFeatureDecision } from "./service";
import type {
  FeatureDecisionCandidate,
  FeatureDecisionDiagnostics,
  FeatureLlmContext,
} from "./types";

export function getFeatureDecisionMode(): "llm" | "legacy" {
  return FEATURE_DECISION_MODE;
}

type WithDiagnostics<T> = T & { diagnostics?: FeatureDecisionDiagnostics };
export type AssetFeatureClassification = {
  brand: WithDiagnostics<BrandClassificationResult> | null;
  ip: WithDiagnostics<IpClassificationResult> | null;
  product: WithDiagnostics<ProductClassificationResult> | null;
  diagnostics: FeatureDecisionDiagnostics;
  /** Exact catalog-identity tags contradicted by the completed decision; generic tags are excluded. */
  unacceptedIdentityTagIds?: number[];
};

/** Detection and crops are retrieval-only; a single whole-image decision owns final identities. */
export async function classifyAssetFeatures(
  input: FeatureLlmContext & {
    imageInput: ClassificationRemoteImageInput;
    enabledTypes: DecisionFeatureType[];
    imageMode?: boolean;
    fileName?: string;
    folderPath?: string;
    boxes?: Partial<Record<DecisionFeatureType, ClassificationDetectionBox[]>>;
  },
): Promise<AssetFeatureClassification> {
  const { teamId, imageInput } = input;
  // Dev requests always use the decision layer; their switch controls image evidence only.
  const mode = input.imageMode === undefined ? getFeatureDecisionMode() : "llm";
  const imageMode = input.imageMode ?? true;
  const enabledTypes = [...new Set(input.enabledTypes)];
  const errors: string[] = [];
  const boxesByType: Partial<Record<DecisionFeatureType, ClassificationDetectionBox[]>> = {};
  await Promise.all(
    enabledTypes.map(async (type) => {
      try {
        if (input.boxes?.[type] !== undefined) {
          boxesByType[type] = input.boxes[type];
          return;
        }
        const result =
          type === "logo"
            ? await detectBrandLogoBoxes({
                teamId,
                imageInput,
                detectionLabelText: await fetchLogoDetectionLabelText(teamId),
              })
            : type === "product"
              ? await detectProductFigureBoxes({ teamId, imageInput })
              : await detectIpFigureBoxes({ teamId, imageInput });
        boxesByType[type] = result.detections;
      } catch (error) {
        errors.push(`${type} detection: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );

  // Embedding-only mode retains the original crop policy: all product boxes,
  // and the existing per-task crop limit for logo/IP, with whole-image fallback.
  const legacySelected =
    mode === "legacy"
      ? enabledTypes.flatMap((featureType) => {
          const raw = boxesByType[featureType];
          if (!raw) return [];
          const boxes = raw.length ? raw : [getFallbackBox(imageInput)];
          return boxes
            .slice(0, featureType === "product" ? undefined : MAX_DETECTION_CROPS)
            .map((box, detectionIndex) => ({
              featureType,
              box: featureType === "product" ? box : clampBox(box, imageInput),
              detectionIndex,
              sourceDetectionIndices: [detectionIndex],
              fallback: raw.length === 0,
            }));
        })
      : [];
  const legacyDetected = Object.values(boxesByType).reduce(
    (count, boxes) => count + boxes.length,
    0,
  );
  const regions =
    mode === "llm"
      ? selectFeatureRegions(boxesByType, imageInput)
      : {
          selected: legacySelected,
          regionsDetected: legacyDetected,
          regionsSelected: legacySelected.length,
          regionsOmitted: Math.max(0, legacyDetected - legacySelected.length),
          regionsDeduplicated: 0,
        };
  const output: AssetFeatureClassification = {
    brand: enabledTypes.includes("logo")
      ? {
          topMatches: [],
          matches: [],
          bestMatch: null,
          noConfidentMatch: true,
          winningDetectionIndex: null,
        }
      : null,
    ip: enabledTypes.includes("ip")
      ? {
          topMatches: [],
          matches: [],
          bestMatch: null,
          noConfidentMatch: true,
          winningDetectionIndex: null,
        }
      : null,
    product: enabledTypes.includes("product")
      ? {
          topMatches: [],
          matches: [],
          bestMatch: null,
          noConfidentMatch: true,
          winningDetectionIndex: null,
          rawDetections: boxesByType.product ?? [],
          detections: [],
        }
      : null,
    diagnostics: {
      mode,
      ocr: { status: "skipped", segments: [] },
      decision: { status: "skipped" },
    },
  };
  await Promise.all(
    enabledTypes.map(async (type) => {
      const selected = regions.selected.filter((region) => region.featureType === type);
      if (!selected.length) return;
      try {
        if (type === "product") {
          const result = await classifyProductImageRegions({
            teamId,
            imageInput,
            boxes: selected.map((region) => region.box),
          });
          const remap = (match: ProductTopMatch) => {
            const region = selected[match.detectionIndex];
            return {
              ...match,
              detectionIndex: region?.detectionIndex ?? match.detectionIndex,
              detectionIndices: (match.detectionIndices ?? [match.detectionIndex]).flatMap(
                (index) => selected[index]?.sourceDetectionIndices ?? [],
              ),
            };
          };
          output.product = {
            ...result,
            rawDetections: boxesByType.product ?? [],
            topMatches: result.topMatches.map(remap),
            matches: deduplicateProductMatches(result.matches.map(remap)),
            bestMatch: result.bestMatch ? remap(result.bestMatch) : null,
            detections: result.detections.map((detection) => ({
              ...detection,
              detectionIndex:
                selected[detection.detectionIndex]?.detectionIndex ?? detection.detectionIndex,
              sourceDetectionIndices: detection.sourceDetectionIndices.flatMap(
                (index) => selected[index]?.sourceDetectionIndices ?? [],
              ),
              topMatches: detection.topMatches.map(remap),
              bestMatch: detection.bestMatch ? remap(detection.bestMatch) : null,
            })),
          };
        } else {
          const crops = await Promise.all(
            selected.map(async ({ box }) => ({
              box,
              image: await cropImageToDataUrl({
                imageDataUrl: imageInput.dataUrl,
                imageBuffer: imageInput.buffer,
                sourceMimeType: imageInput.mimeType,
                meta: imageInput,
                box,
              }),
            })),
          );
          if (type === "logo") {
            const result = await classifyBrandImageCrops({
              teamId,
              crops,
              retrievalOnly: mode === "llm",
            });
            const remap = (match: BrandTopMatch) => ({
              ...match,
              detectionIndex:
                selected[match.detectionIndex]?.detectionIndex ?? match.detectionIndex,
            });
            output.brand = {
              ...result,
              topMatches: result.topMatches.map(remap),
              bestMatch: result.bestMatch ? remap(result.bestMatch) : null,
            };
          } else {
            const result = await classifyIpImageCrops({
              teamId,
              crops,
              retrievalOnly: mode === "llm",
            });
            const remap = (match: IpTopMatch) => ({
              ...match,
              detectionIndex:
                selected[match.detectionIndex]?.detectionIndex ?? match.detectionIndex,
            });
            output.ip = {
              ...result,
              topMatches: result.topMatches.map(remap),
              bestMatch: result.bestMatch ? remap(result.bestMatch) : null,
            };
          }
        }
      } catch (error) {
        errors.push(`${type} retrieval: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );

  const productCandidates = deduplicateProductMatches(
    output.product?.detections.flatMap((region) => region.topMatches) ?? [],
  );
  const brandCandidates = output.brand?.topMatches ?? [];
  const ipCandidates = output.ip?.topMatches ?? [];
  const retrieval = {
    regionsDetected: regions.regionsDetected,
    regionsSelected: regions.regionsSelected,
    regionsOmitted: regions.regionsOmitted,
    regionsDeduplicated: regions.regionsDeduplicated,
    candidatesRetrieved: productCandidates.length + brandCandidates.length + ipCandidates.length,
    unassessedCandidates: [] as Array<{ candidateId: string; reason: string }>,
    errors,
  };
  if (mode === "legacy") {
    output.diagnostics = {
      mode,
      retrieval,
      ocr: { status: "disabled", segments: [] },
      decision: { status: "skipped", error: "Explicit embedding-only legacy mode" },
    };
  } else {
    const candidates: FeatureDecisionCandidate[] = [];
    const referenceWork = pLimit(4);
    const imageSelect = {
      orderBy: [{ sort: "asc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }],
      take: 1,
    };
    const loadCatalog = async <T>(query: Promise<T[]>, type: DecisionFeatureType): Promise<T[]> => {
      try {
        return await query;
      } catch (error) {
        errors.push(
          `${type} reference metadata: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      }
    };
    // Stable library order chooses the reference, independently from the winning retrieval vector.
    const [logos, products, ips] = await Promise.all([
      brandCandidates.length
        ? loadCatalog(
            prisma.assetLogo.findMany({
              where: {
                teamId,
                enabled: true,
                status: "completed",
                id: { in: brandCandidates.map((match) => match.assetLogoId) },
              },
              select: {
                id: true,
                notes: true,
                tags: { select: { assetTagId: true, tagPath: true } },
                images: { ...imageSelect, select: { objectKey: true } },
              },
            }),
            "logo",
          )
        : [],
      productCandidates.length && imageMode
        ? loadCatalog(
            prisma.assetProduct.findMany({
              where: {
                teamId,
                enabled: true,
                status: "completed",
                id: { in: productCandidates.map((match) => match.assetProductId) },
              },
              select: { id: true, images: { ...imageSelect, select: { objectKey: true } } },
            }),
            "product",
          )
        : [],
      ipCandidates.length
        ? loadCatalog(
            prisma.assetIp.findMany({
              where: {
                teamId,
                enabled: true,
                status: "completed",
                id: { in: ipCandidates.map((match) => match.assetIpId) },
              },
              select: {
                id: true,
                matchPattern: true,
                images: {
                  ...imageSelect,
                  select: { objectKey: true, partialMatchPatternName: true },
                },
              },
            }),
            "ip",
          )
        : [],
    ]);
    const addReference = async (
      candidate: Omit<FeatureDecisionCandidate, "referenceImage">,
      objectKey?: string,
    ): Promise<FeatureDecisionCandidate | null> => {
      if (!imageMode) return candidate;
      if (!objectKey) {
        retrieval.unassessedCandidates.push({
          candidateId: candidate.candidateId,
          reason: "First reference image unavailable",
        });
        return null;
      }
      try {
        const { signedUrl } = getCachedSignedS3ObjectUrl({ objectKey });
        const reference = await referenceWork(() =>
          fetchRemoteImageInput(signedUrl, "feature decision first reference"),
        );
        return { ...candidate, referenceImage: reference.dataUrl };
      } catch (error) {
        retrieval.unassessedCandidates.push({
          candidateId: candidate.candidateId,
          reason: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    };
    const pending: Array<Promise<FeatureDecisionCandidate | null>> = [];
    for (const match of brandCandidates) {
      const logo = logos.find((entry) => entry.id === match.assetLogoId);
      pending.push(
        addReference(
          {
            candidateId: `logo:${match.assetLogoId}`,
            classId: match.assetLogoId,
            featureType: "logo",
            name: match.logoName,
            typeName: match.logoTypeName,
            description: logo?.notes,
            similarity: match.similarity,
          },
          logo?.images[0]?.objectKey,
        ),
      );
    }
    for (const match of productCandidates) {
      const product = products.find((entry) => entry.id === match.assetProductId);
      pending.push(
        addReference(
          {
            candidateId: `product:${match.assetProductId}`,
            classId: match.assetProductId,
            featureType: "product",
            name: match.productName,
            typeName: match.productTypeName,
            description: [match.description, match.generalCategory].filter(Boolean).join("\n"),
            similarity: match.similarity,
            imageSimilarity: match.imageSimilarity,
            descriptionSimilarity: match.descriptionSimilarity,
            retrievedRegions: output.product?.detections.filter((region) =>
              region.topMatches.some(
                (candidate) => candidate.assetProductId === match.assetProductId,
              ),
            ).length,
          },
          product?.images[0]?.objectKey,
        ),
      );
    }
    for (const match of ipCandidates) {
      const ip = ips.find((entry) => entry.id === match.assetIpId);
      pending.push(
        addReference(
          {
            candidateId: `ip:${match.assetIpId}`,
            classId: match.assetIpId,
            featureType: "ip",
            name: match.ipName,
            typeName: match.ipTypeName,
            description: [
              match.description,
              ip?.matchPattern === "partial"
                ? `Partial identity feature: ${ip.images[0]?.partialMatchPatternName || "unspecified"}`
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
            similarity: match.similarity,
            imageSimilarity: match.imageSimilarity,
            descriptionSimilarity: match.descriptionSimilarity,
          },
          ip?.images[0]?.objectKey,
        ),
      );
    }
    for (const candidate of await Promise.all(pending)) if (candidate) candidates.push(candidate);
    if (candidates.length > MAX_FEATURE_REFERENCES)
      throw new Error("Feature decision reference budget exceeded");
    output.diagnostics = {
      ...(await runFeatureDecision({
        teamId,
        queueItemId: input.queueItemId,
        assetObjectId: input.assetObjectId,
        fileName: input.fileName,
        folderPath: input.folderPath,
        sourceImage: imageInput.dataUrl,
        imageMode,
        candidates,
      })),
      mode,
      decisionInputMode: imageMode ? "image" : "text",
      retrieval,
    };
    // Predictions remain visible regardless of confidence, conflicts or specificity.
    // Automatic application has a separate gate and must never promote alternatives.
    const predictions = new Map(
      (output.diagnostics.decision.status === "completed"
        ? (output.diagnostics.decision.result?.matches ?? [])
        : []
      )
        .filter((match) => imageMode || !match.evidence.includes("visual"))
        .map((match) => [match.candidateId, match]),
    );
    const decisions = new Map(
      [...predictions].filter(
        ([candidateId, match]) =>
          match.conflicts.length === 0 &&
          !match.specificityLimit?.trim() &&
          (!candidateId.startsWith("logo:") ||
            match.evidence.includes(imageMode ? "visual" : "retrieval")),
      ),
    );
    if (output.diagnostics.decision.status === "completed") {
      // A rejected catalog identity must not be reapplied through general AI tagging. Only
      // exact identity names are withheld; shared/generic linked tags remain independent.
      const normalizeName = (name: string) =>
        name.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
      const evidence = [
        ...brandCandidates.map((match) => ({
          candidateId: `logo:${match.assetLogoId}`,
          name: match.logoName,
          tags: logos.find((entry) => entry.id === match.assetLogoId)?.tags ?? [],
        })),
        ...productCandidates.map((match) => ({
          candidateId: `product:${match.assetProductId}`,
          name: match.productName,
          tags: match.recommendedTags,
        })),
        ...ipCandidates.map((match) => ({
          candidateId: `ip:${match.assetIpId}`,
          name: match.ipName,
          tags: match.recommendedTags,
        })),
      ];
      const assessed = new Set(candidates.map((candidate) => candidate.candidateId));
      const acceptedDecisionIds = new Set(
        candidates
          .filter((candidate) => {
            const decision = decisions.get(candidate.candidateId);
            return (
              decision &&
              meetsFeatureConfidenceThreshold(
                candidate.featureType === "logo" ? "brand" : candidate.featureType,
                decision.confidence,
              )
            );
          })
          .map((candidate) => candidate.candidateId),
      );
      const acceptedTagIds = new Set(
        evidence
          .filter((entry) => acceptedDecisionIds.has(entry.candidateId))
          .flatMap((entry) => entry.tags.map((tag) => tag.assetTagId)),
      );
      output.unacceptedIdentityTagIds = [
        ...new Set(
          evidence
            .filter(
              (entry) =>
                assessed.has(entry.candidateId) && !acceptedDecisionIds.has(entry.candidateId),
            )
            .flatMap((entry) =>
              entry.tags
                .filter(
                  (tag) =>
                    Array.isArray(tag.tagPath) &&
                    normalizeName(String(tag.tagPath.at(-1) ?? "")) === normalizeName(entry.name),
                )
                .map((tag) => tag.assetTagId),
            ),
        ),
      ].filter((id): id is number => typeof id === "number" && id > 0 && !acceptedTagIds.has(id));
    }
    const final = <T extends { confidence: number }>(
      matches: T[],
      key: (match: T) => string,
      type: DecisionFeatureType,
    ): T[] =>
      matches
        .flatMap((match) => {
          const decision = predictions.get(`${type}:${key(match)}`);
          if (!decision) return [];
          return [
            { ...match, confidence: decision.confidence, decisionSource: "llm" as const, decision },
          ];
        })
        .sort((a, b) => b.confidence - a.confidence);
    if (output.brand) {
      const classified = final(brandCandidates, (match) => match.assetLogoId, "logo");
      const matches = classified.filter(
        (match) =>
          decisions.has(`logo:${match.assetLogoId}`) &&
          meetsFeatureConfidenceThreshold("brand", match.confidence),
      );
      output.brand = {
        ...output.brand,
        topMatches: classified,
        matches,
        bestMatch: matches[0] ?? classified[0] ?? null,
        noConfidentMatch: matches.length === 0,
        winningDetectionIndex: (matches[0] ?? classified[0])?.detectionIndex ?? null,
      };
    }
    if (output.ip) {
      const classified = final(ipCandidates, (match) => match.assetIpId, "ip");
      const matches = classified.filter(
        (match) =>
          decisions.has(`ip:${match.assetIpId}`) &&
          meetsFeatureConfidenceThreshold("ip", match.confidence),
      );
      output.ip = {
        ...output.ip,
        topMatches: classified,
        matches,
        bestMatch: matches[0] ?? classified[0] ?? null,
        noConfidentMatch: matches.length === 0,
        winningDetectionIndex: (matches[0] ?? classified[0])?.detectionIndex ?? null,
      };
    }
    if (output.product) {
      const classified = final(productCandidates, (match) => match.assetProductId, "product");
      const matches = classified.filter(
        (match) =>
          decisions.has(`product:${match.assetProductId}`) &&
          meetsFeatureConfidenceThreshold("product", match.confidence),
      );
      output.product = {
        ...output.product,
        topMatches: classified,
        matches,
        bestMatch: matches[0] ?? classified[0] ?? null,
        noConfidentMatch: matches.length === 0,
        winningDetectionIndex: (matches[0] ?? classified[0])?.detectionIndex ?? null,
        detections: output.product.detections.map((region) => {
          const bestMatch =
            matches.find((match) =>
              region.topMatches.some(
                (candidate) => candidate.assetProductId === match.assetProductId,
              ),
            ) ?? null;
          return { ...region, bestMatch, noConfidentMatch: !bestMatch };
        }),
      };
    }
  }
  if (output.brand) output.brand.diagnostics = output.diagnostics;
  if (output.ip) output.ip.diagnostics = output.diagnostics;
  if (output.product) output.product.diagnostics = output.diagnostics;
  return output;
}
