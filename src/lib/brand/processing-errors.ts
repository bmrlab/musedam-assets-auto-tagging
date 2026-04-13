export const BRAND_PROCESSING_ERROR_CODES = {
  embeddingCountMismatch: "embedding_count_mismatch",
  imageFetchFailed: "image_fetch_failed",
  jinaRequestFailed: "jina_request_failed",
  logoNotFound: "logo_not_found",
  noReferenceImages: "no_reference_images",
  unknown: "unknown",
  vectorStoreSyncFailed: "vector_store_sync_failed",
} as const;

export type BrandProcessingErrorCode =
  (typeof BRAND_PROCESSING_ERROR_CODES)[keyof typeof BRAND_PROCESSING_ERROR_CODES];

export function isBrandProcessingErrorCode(value: string): value is BrandProcessingErrorCode {
  return Object.values(BRAND_PROCESSING_ERROR_CODES).includes(value as BrandProcessingErrorCode);
}
