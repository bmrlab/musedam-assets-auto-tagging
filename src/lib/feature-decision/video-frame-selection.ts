import "server-only";

import sharp from "sharp";

const SIDE = 32;
const TILE_PIXELS = 384 * 512;

export type VideoFrameQuality = { fingerprint: Buffer; sharpness: number; blank: boolean };

/** Small CPU-only preview; no additional detection, embedding or model requests. */
export async function measureVideoFrame(buffer: Buffer): Promise<VideoFrameQuality> {
  const fingerprint = await sharp(buffer)
    .resize(SIDE, SIDE, { fit: "fill" })
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer();
  const gray = Array.from({ length: SIDE * SIDE }, (_, index) => {
    const offset = index * 3;
    return (
      fingerprint[offset] * 0.299 +
      fingerprint[offset + 1] * 0.587 +
      fingerprint[offset + 2] * 0.114
    );
  });
  let energy = 0;
  for (let y = 1; y < SIDE - 1; y++) {
    for (let x = 1; x < SIDE - 1; x++) {
      const i = y * SIDE + x;
      const laplacian = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - SIDE] - gray[i + SIDE];
      energy += laplacian * laplacian;
    }
  }
  return {
    fingerprint,
    sharpness: energy / (SIDE - 2) ** 2,
    blank: gray.every((value) => value < 12) || gray.every((value) => value > 243),
  };
}

function nearDuplicate(a: Buffer, b: Buffer) {
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference += Math.abs(a[index] - b[index]);
    if (difference > 3 * a.length) return false;
  }
  return true;
}

export function selectVideoFrames<T extends VideoFrameQuality & { timestamp: number }>(
  frames: T[],
  limit = 8,
): T[] {
  const usable = frames.filter((frame) => !frame.blank);
  // Do not fail an otherwise decodable video when every sample is dark/blank.
  const pool = usable.length ? usable : frames;
  const unique: T[] = [];
  // A blurred duplicate must not displace the sharper version of the same content.
  for (const frame of [...pool].sort(
    (a, b) => b.sharpness - a.sharpness || a.timestamp - b.timestamp,
  )) {
    if (!unique.some((previous) => nearDuplicate(previous.fingerprint, frame.fingerprint)))
      unique.push(frame);
  }
  const remaining = unique.sort((a, b) => a.timestamp - b.timestamp);
  const selected: T[] = [];
  while (remaining.length && selected.length < limit) {
    if (selected.length) {
      const distance = (frame: T) =>
        Math.min(...selected.map((previous) => Math.abs(previous.timestamp - frame.timestamp)));
      remaining.sort((a, b) => distance(b) - distance(a) || b.sharpness - a.sharpness);
    }
    selected.push(remaining.shift()!);
  }
  return selected.sort((a, b) => a.timestamp - b.timestamp);
}

/** Preserve the old per-tile pixel budget, spending it on picture rather than black bars. */
export function videoSheetLayout(frames: { width: number; height: number }[]) {
  if (!frames.length) throw new Error("Cannot create an empty video sheet");
  const ratios = frames.map((frame) => frame.width / frame.height).sort((a, b) => a - b);
  const ratio = Math.max(0.25, Math.min(4, ratios[Math.floor(ratios.length / 2)]));
  const tileWidth = Math.floor(Math.sqrt(TILE_PIXELS * ratio));
  const tileHeight = Math.floor(TILE_PIXELS / tileWidth);
  // Keep chronological order, with at most four columns and a compact overall canvas.
  let columns = 1;
  let best = Infinity;
  const oldColumns = Math.min(4, frames.length);
  const maxCells = oldColumns * Math.ceil(frames.length / oldColumns);
  for (let value = 1; value <= Math.min(4, frames.length); value++) {
    const rows = Math.ceil(frames.length / value);
    if (value * rows > maxCells) continue;
    const score =
      Math.abs(Math.log((value * tileWidth) / (rows * tileHeight))) +
      (value * rows - frames.length) / frames.length;
    if (score < best) {
      best = score;
      columns = value;
    }
  }
  return { columns, tileWidth, tileHeight };
}

export async function createVideoContactSheet(
  frames: { buffer: Buffer; width: number; height: number }[],
) {
  const { columns, tileWidth, tileHeight } = videoSheetLayout(frames);
  const background = "#181818";
  const tiles = await Promise.all(
    frames.map(async (frame, index) => ({
      input: await sharp(frame.buffer)
        .resize(tileWidth, tileHeight, { fit: "contain", background })
        .jpeg()
        .toBuffer(),
      left: (index % columns) * tileWidth,
      top: Math.floor(index / columns) * tileHeight,
    })),
  );
  const buffer = await sharp({
    create: {
      width: columns * tileWidth,
      height: Math.ceil(frames.length / columns) * tileHeight,
      channels: 3,
      background,
    },
  })
    .composite(tiles)
    .jpeg({ quality: 88 })
    .toBuffer();
  return { buffer, columns };
}
