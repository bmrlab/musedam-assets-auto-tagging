import { recallProductsByMetadata, type ProductMetadataEvidence } from "@/lib/product/metadata-candidates";
import { selectProductRegionWinners } from "@/lib/product/product-match-policy";
import { prepareLogoReferenceSheet } from "./logo-reference-sheet";
import { getScoredFeaturePredictions } from "./match-policy";
import { findProductNameMatches } from "@/lib/product/product-name-evidence";
import "server-only";
import { FEATURE_DECISION_MODE, isDecisionLlmImageUseEnabled } from "./config";

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
import { getFeatureThresholds } from "@/lib/tagging/feature-threshold-settings";
import prisma from "@/prisma/prisma";
import pLimit from "p-limit";
import { selectFeatureRegions, type DecisionFeatureType } from "./regions";
import { recognizeFeatureOcr, runFeatureDecision } from "./service";
import { allowsLogoFolderMatch, logoFolderAlias } from "./path-candidates";
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
  confidenceThresholds?: import("@/lib/tagging/feature-confidence").FeatureThresholds;
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
    ocrSegments?: string[];
    ocrImage?: string;
    boxes?: Partial<Record<DecisionFeatureType, ClassificationDetectionBox[]>>;
  },
): Promise<AssetFeatureClassification> {
  const { teamId, imageInput } = input;
  const thresholds = await getFeatureThresholds(teamId);
  // Dev requests always use the decision layer; their explicit switch controls image evidence.
  const mode = input.imageMode === undefined ? getFeatureDecisionMode() : "llm";
  const imageMode = input.imageMode ?? isDecisionLlmImageUseEnabled();
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
  const cropWork = pLimit(4);
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
            selected.map(({ box }) => cropWork(async () => ({
              box,
              image: await cropImageToDataUrl({
                imageDataUrl: imageInput.dataUrl,
                imageBuffer: imageInput.buffer,
                sourceMimeType: imageInput.mimeType,
                meta: imageInput,
                box,
              }),
            }))),
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

  const metadataEvidence = new Map<string, ProductMetadataEvidence[]>();
  if (mode === "llm" && output.product && (input.fileName || input.folderPath)) {
    try {
      const catalog = await prisma.assetProduct.findMany({
        where: { teamId, enabled: true, status: "completed" },
        select: { id: true, name: true, notes: true, productTypeId: true, productTypeName: true,
          description: true, generalCategory: true,
          tags: { where: { assetTag: { teamId, deletedAt: null } },
            select: { id: true, assetTagId: true, tagPath: true } } },
      });
      for (const { product, evidence } of recallProductsByMetadata(catalog, input)) {
        metadataEvidence.set(product.id, evidence);
        // These are competing hypotheses for each region, not localized metadata
        // or observed vector matches. The decision must identify the actual object.
        for (const region of output.product.detections) {
          if (region.topMatches.some(match => match.assetProductId === product.id)) continue;
          region.topMatches.push({ assetProductId: product.id, productName: product.name,
            productTypeId: product.productTypeId, productTypeName: product.productTypeName,
            description: product.description, generalCategory: product.generalCategory,
            confidence: 0, similarity: 0, imageSimilarity: 0, descriptionSimilarity: 0,
            detectionIndex: region.detectionIndex, detectionIndices: region.sourceDetectionIndices,
            recommendedTags: product.tags.map(tag => ({ ...tag,
              tagPath: Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [] })) });
        }
      }
    } catch (error) {
      errors.push(`product metadata recall: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
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
    const ocr = await recognizeFeatureOcr({
      teamId, queueItemId: input.queueItemId, assetObjectId: input.assetObjectId,
      sourceImage: input.ocrImage ?? imageInput.dataUrl, segments: input.ocrSegments,
    });
    const ocrText = ocr.segments.join("\n");
    const folderCatalog = enabledTypes.includes("logo") && (input.folderPath || ocrText)
      ? await loadCatalog(prisma.assetLogo.findMany({
          where: { teamId, enabled: true, status: "completed", ...(ocrText ? {} : { OR: [
            { notes: { contains: "文件夹" } }, { notes: { contains: "文件路径" } },
            { notes: { contains: "folder", mode: "insensitive" } }, { notes: { contains: "file path", mode: "insensitive" } },
          ] }) },
          select: { id: true, name: true, notes: true, logoTypeId: true, logoTypeName: true, referenceMatchStrategy: true },
        }), "logo")
      : [];
    const folderMatches = folderCatalog.filter(logo =>
      allowsLogoFolderMatch(logo.notes) && logoFolderAlias(logo.name, input.folderPath ?? ""),
    );
    const folderMatchIds = new Set(folderMatches.map(logo => logo.id));
    const ocrMatches = ocrText ? folderCatalog.filter(logo => logoFolderAlias(logo.name, ocrText)) : [];
    const ocrMatchIds = new Set(ocrMatches.map(logo => logo.id));
    for (const logo of [...folderMatches, ...ocrMatches]) {
      if (brandCandidates.some(match => match.assetLogoId === logo.id)) continue;
      brandCandidates.push({
        assetLogoId: logo.id, logoName: logo.name, logoTypeId: logo.logoTypeId,
        logoTypeName: logo.logoTypeName ?? "", similarity: 0, confidence: 0,
        referenceMatchStrategy: logo.referenceMatchStrategy,
        detectionIndex: -1,
      });
    }
    // Logo decisions see every configured variant; products/IP retain one reference.
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
                tags: {
                  where: { assetTag: { teamId, deletedAt: null } },
                  select: { assetTagId: true, tagPath: true },
                },
                images: {
                  orderBy: imageSelect.orderBy,
                  select: { id: true, objectKey: true },
                },
              },
            }),
            "logo",
          )
        : [],
      productCandidates.length
        ? loadCatalog(
            prisma.assetProduct.findMany({
              where: {
                teamId,
                enabled: true,
                status: "completed",
                id: { in: productCandidates.map((match) => match.assetProductId) },
              },
              select: { id: true, notes: true, images: { ...imageSelect, select: { objectKey: true } } },
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
    const addLogoReferences = async (
      candidate: FeatureDecisionCandidate,
      images: Array<{ id?: string; objectKey: string }>,
    ): Promise<FeatureDecisionCandidate | null> => {
      if (!imageMode) return candidate;
      try {
        const prepared = await prepareLogoReferenceSheet(images, objectKey => referenceWork(async () => {
          const { signedUrl } = getCachedSignedS3ObjectUrl({ objectKey });
          return (await fetchRemoteImageInput(signedUrl, "feature decision logo references")).dataUrl;
        }));
        return { ...candidate, referenceImage: prepared.dataUrl,
          referenceImageCount: prepared.referenceImageCount, referenceImageIds: prepared.referenceImageIds };
      } catch (error) {
        retrieval.unassessedCandidates.push({ candidateId: candidate.candidateId,
          reason: error instanceof Error ? error.message : String(error) });
        return null;
      }
    };
    const pending: Array<Promise<FeatureDecisionCandidate | null>> = [];
    for (const match of brandCandidates) {
      const logo = logos.find((entry) => entry.id === match.assetLogoId);
      pending.push(
        addLogoReferences(
          {
            candidateId: `logo:${match.assetLogoId}`,
            classId: match.assetLogoId,
            featureType: "logo",
            name: match.logoName,
            typeName: match.logoTypeName,
            description: logo?.notes,
            similarity: match.similarity,
            referenceMatchStrategy: match.referenceMatchStrategy,
            regionIds: match.detectionIndex < 0 ? [] : [`logo:${match.detectionIndex}`],
            ocrMatch: ocrMatchIds.has(match.assetLogoId) ? { alias: logoFolderAlias(match.logoName, ocrText)! } : undefined,
            folderMatch: folderMatchIds.has(match.assetLogoId) ? { alias: logoFolderAlias(match.logoName, input.folderPath ?? "")!, path: input.folderPath! } : undefined,
          },
          logo?.images ?? [],
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
            notes: product?.notes,
            metadataMatches: metadataEvidence.get(match.assetProductId),
            typeName: match.productTypeName,
            description: [match.description, match.generalCategory].filter(Boolean).join("\n"),
            similarity: match.similarity,
            imageSimilarity: match.imageSimilarity,
            descriptionSimilarity: match.descriptionSimilarity,
            regionIds: output.product?.detections.filter(region =>
              region.topMatches.some(candidate => candidate.assetProductId === match.assetProductId && candidate.similarity > 0),
            ).map(region => `product:${region.detectionIndex}`),
            regionEvidence: output.product?.detections.flatMap(region => {
              const candidate = region.topMatches.find(item => item.assetProductId === match.assetProductId);
              return candidate && candidate.similarity > 0 ? [{
                regionId: `product:${region.detectionIndex}`,
                wholeAssetFallback: region.sourceDetectionIndices.length === 0,
                similarity: candidate.similarity,
                imageSimilarity: candidate.imageSimilarity,
                descriptionSimilarity: candidate.descriptionSimilarity,
              }] : [];
            }),
            retrievedRegions: output.product?.detections.filter((region) =>
              region.topMatches.some(
                (candidate) => candidate.assetProductId === match.assetProductId && candidate.similarity > 0,
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
            regionIds: [`ip:${match.detectionIndex}`],
            imageSimilarity: match.imageSimilarity,
            descriptionSimilarity: match.descriptionSimilarity,
          },
          ip?.images[0]?.objectKey,
        ),
      );
    }
    for (const candidate of await Promise.all(pending)) if (candidate) candidates.push(candidate);
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
        ocr,
      })),
      mode,
      decisionInputMode: imageMode ? "image" : "text",
      retrieval,
      folderMatchedLogoIds: [...folderMatchIds],
      ocrMatchedLogoIds: [...ocrMatchIds],
    };
    for (const batch of output.diagnostics.decision.batches ?? []) {
      if (batch.status !== "completed") retrieval.unassessedCandidates.push(...batch.candidateIds.map(candidateId => ({
        candidateId, reason: batch.error ?? "Decision batch failed",
      })));
    }
    // Final model predictions are accepted solely by the team's score threshold.
    const predictions = new Map(getScoredFeaturePredictions(output.diagnostics)
      .map(match => [match.candidateId, match]));
    const decisions = predictions;
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
    const classifiedProducts = selectProductRegionWinners(
      final(productCandidates, (match) => match.assetProductId, "product"),
      output.product?.detections ?? [],
    );
    const productWinnerIds = new Set(classifiedProducts.map(match => `product:${match.assetProductId}`));
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
              (candidate.featureType !== "product" || productWinnerIds.has(candidate.candidateId)) &&
              meetsFeatureConfidenceThreshold(
                candidate.featureType === "logo" ? "brand" : candidate.featureType,
                decision.confidence,
                thresholds[candidate.featureType === "logo" ? "brand" : candidate.featureType],
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
    if (output.brand) {
      const classified = final(brandCandidates, (match) => match.assetLogoId, "logo");
      const matches = classified.filter(
        (match) =>
          decisions.has(`logo:${match.assetLogoId}`) &&
          meetsFeatureConfidenceThreshold("brand", match.confidence, thresholds.brand),
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
          meetsFeatureConfidenceThreshold("ip", match.confidence, thresholds.ip),
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
      const classified = classifiedProducts;
      const matches = classified.filter(
        (match) =>
          decisions.has(`product:${match.assetProductId}`) &&
          meetsFeatureConfidenceThreshold("product", match.confidence, thresholds.product),
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
            matches.find(match => match.detectionIndices.includes(region.detectionIndex)) ?? null;
          return { ...region, bestMatch,
            topMatches: bestMatch ? [bestMatch] : [],
            noConfidentMatch: !bestMatch };
        }),
      };
    }
  }
  if (output.product) {
    const imageMatches = selectProductRegionWinners(output.product.matches, output.product.detections);
    const nameMatches = await findProductNameMatches(teamId, input.fileName);
    const matches = deduplicateProductMatches([...nameMatches, ...imageMatches]);
    output.product = { ...output.product, matches,
      bestMatch: matches[0] ?? output.product.bestMatch,
      noConfidentMatch: matches.length === 0,
      winningDetectionIndex: matches[0]?.detectionIndex ?? null };
  }
  if (output.product && output.diagnostics.decision.result) {
    const kept = new Set(output.product.topMatches.map(match => `product:${match.assetProductId}`));
    output.diagnostics.decision.result.matches = output.diagnostics.decision.result.matches.filter(match =>
      !match.candidateId.startsWith("product:") || kept.has(match.candidateId));
  }
  output.confidenceThresholds = thresholds;
  if (output.brand) output.brand.diagnostics = output.diagnostics;
  if (output.ip) output.ip.diagnostics = output.diagnostics;
  if (output.product) output.product.diagnostics = output.diagnostics;
  return output;
}
