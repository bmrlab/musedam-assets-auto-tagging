import "server-only";

// Sharp uses the SVG's small viewBox as its default raster size (72 DPI). Rendering at a
// higher density before resizing preserves vector detail in detection and embedding inputs.
const DEFAULT_SVG_DENSITY = 72;
const MAX_SVG_DENSITY = 100_000;

export function getSvgRasterDensity(
  metadata: { format?: string; width?: number; height?: number; density?: number },
  targetMaxDimension: number,
) {
  if (metadata.format !== "svg") return null;
  const sourceMaxDimension = Math.max(metadata.width ?? 0, metadata.height ?? 0);
  if (
    !Number.isFinite(sourceMaxDimension) ||
    sourceMaxDimension <= 0 ||
    !Number.isFinite(targetMaxDimension) ||
    targetMaxDimension <= 0
  ) {
    throw new Error("Invalid SVG raster dimensions");
  }
  const baseDensity =
    metadata.density && Number.isFinite(metadata.density) && metadata.density > 0
      ? metadata.density
      : DEFAULT_SVG_DENSITY;
  return Math.min(
    MAX_SVG_DENSITY,
    Math.max(baseDensity, Math.ceil((baseDensity * targetMaxDimension) / sourceMaxDimension)),
  );
}
