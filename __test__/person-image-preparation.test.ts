import {
  fetchRemoteImageInput,
  fetchRemotePersonImageInput,
} from "@/lib/tagging/classification-image";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("person image preparation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves full pixel dimensions for person detection while shared input remains bounded", async () => {
    const source = await sharp({
      create: {
        width: 2400,
        height: 1600,
        channels: 3,
        background: "#456789",
      },
    })
      .jpeg({ quality: 85 })
      .toBuffer();

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array(source), {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          }),
      ),
    );

    const sharedInput = await fetchRemoteImageInput(
      "https://example.test/photo.jpg",
      "test shared classification",
    );
    const personInput = await fetchRemotePersonImageInput(
      "https://example.test/photo.jpg",
      "test person classification",
    );

    expect(sharedInput.width).toBe(1280);
    expect(sharedInput.height).toBe(853);
    expect(personInput.width).toBe(2400);
    expect(personInput.height).toBe(1600);
  });
});
