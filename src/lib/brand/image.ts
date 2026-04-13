import "server-only";

export function bufferToDataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export function dataUrlToBase64(image: string) {
  const match = image.match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1] : image;
}
