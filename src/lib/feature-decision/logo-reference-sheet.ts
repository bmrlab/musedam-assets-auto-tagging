import { createHash } from "node:crypto";
import pLimit from "p-limit";
import sharp from "sharp";

type Reference = { id?: string; objectKey: string };
type PreparedLogoReference = {
  dataUrl: string;
  referenceImageCount: number;
  referenceImageIds: string[];
};

const TILE_WIDTH = 240;
const TILE_HEIGHT = 192;
const MAX_COLUMNS = 6;
const MAX_PIXELS = 40_000_000;
// Vision token usage follows pixel dimensions, not JPEG file size.
const MAX_SHEET_DIMENSION = 768;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX_BYTES = 8 * 1024 * 1024;
// Cache completed sheets only: sharing an in-flight request would share its queue abort signal.
const sheets = new Map<string, { value: PreparedLogoReference; expiresAt: number }>();
let cachedBytes = 0;

/** Every uploaded variant belongs to the same candidate; no variant is silently truncated. */
export async function prepareLogoReferenceSheet(
  references: Reference[],
  load: (objectKey: string) => Promise<string>,
): Promise<PreparedLogoReference> {
  const images = [...new Map(references.map(image => [image.objectKey, image])).values()];
  if (!images.length) throw new Error("Logo reference images unavailable");
  const metadata = {
    referenceImageCount: images.length,
    referenceImageIds: images.flatMap(image => image.id ? [image.id] : []),
  };
  if (images.length === 1) return { ...metadata, dataUrl: await load(images[0].objectKey) };

  const key = createHash("sha256").update(JSON.stringify(images)).digest("hex");
  const cached = sheets.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    sheets.delete(key);
    sheets.set(key, cached);
    return cached.value;
  }
  if (cached) {
    cachedBytes -= cached.value.dataUrl.length;
    sheets.delete(key);
  }
  const columns = Math.min(MAX_COLUMNS, Math.ceil(Math.sqrt(images.length)));
  const rows = Math.ceil(images.length / columns);
  if (columns * TILE_WIDTH * rows * TILE_HEIGHT > MAX_PIXELS)
    throw new Error("Logo reference sheet exceeds image pixel budget");
  const scale = Math.min(1, MAX_SHEET_DIMENSION / (columns * TILE_WIDTH), MAX_SHEET_DIMENSION / (rows * TILE_HEIGHT));
  const tileWidth = Math.floor(TILE_WIDTH * scale);
  const tileHeight = Math.floor(TILE_HEIGHT * scale);
  const inset = Math.max(1, Math.floor(8 * scale));
  const work = pLimit(4);
  const tiles = await Promise.all(images.map((image, index) => work(async () => {
    const dataUrl = await load(image.objectKey);
    const encoded = /^data:image\/[^;]+;base64,([\s\S]+)$/.exec(dataUrl)?.[1];
    if (!encoded) throw new Error(`Invalid logo reference image ${index + 1}`);
    const input = await sharp(Buffer.from(encoded, "base64"), { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize({ width: tileWidth - inset * 2, height: tileHeight - inset * 2, fit: "contain", background: "#ffffff" })
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer();
    return { input, left: (index % columns) * tileWidth + inset, top: Math.floor(index / columns) * tileHeight + inset };
  })));
  const buffer = await sharp({ create: {
    width: columns * tileWidth, height: rows * tileHeight,
    channels: 3, background: "#e5e7eb",
  } }).composite(tiles).jpeg({ quality: 90 }).toBuffer();
  const value = { ...metadata, dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}` };
  if (value.dataUrl.length <= CACHE_MAX_BYTES) {
    while (cachedBytes + value.dataUrl.length > CACHE_MAX_BYTES && sheets.size) {
      const oldest = sheets.keys().next().value!;
      cachedBytes -= sheets.get(oldest)!.value.dataUrl.length;
      sheets.delete(oldest);
    }
    // Another task may have completed the same sheet while this task was preparing it.
    const previous = sheets.get(key);
    if (previous) cachedBytes -= previous.value.dataUrl.length;
    sheets.delete(key);
    sheets.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    cachedBytes += value.dataUrl.length;
  }
  return value;
}
