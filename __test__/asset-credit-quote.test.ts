// @vitest-environment node
import { fetchAssetCreditInputs } from "@/musedam/asset-credit-quote";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ credentials: vi.fn(), request: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/musedam/apiKey", () => ({ retrieveTeamCredentials: mocks.credentials }));
vi.mock("@/musedam/lib", () => ({ requestMuseDAMAPI: mocks.request }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.credentials.mockResolvedValue({ apiKey: "test-key" });
});

describe("read-only asset quotation metadata", () => {
  it("maps duration in milliseconds by ID regardless of response order", async () => {
    mocks.request.mockResolvedValue([
      { id: "2", extension: "mp4", duration: 5000 },
      { id: "1", name: "image.jpg", extension: "jpg", duration: null },
    ]);
    expect(await fetchAssetCreditInputs({ id: 7, slug: "t/7" }, [BigInt(1), BigInt(2)])).toEqual([
      { name: "image.jpg", extra: { extension: "jpg", duration: null } },
      { name: undefined, extra: { extension: "mp4", duration: 5000 } },
    ]);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith(
      "/api/muse/assets-by-ids",
      expect.objectContaining({ method: "POST", timeoutMs: 30000 }),
    );
  });

  it("rejects missing assets instead of silently quoting fewer items", async () => {
    mocks.request.mockResolvedValue([]);
    await expect(fetchAssetCreditInputs({ id: 7, slug: "t/7" }, [BigInt(1)])).rejects.toThrow(
      "unavailable",
    );
  });

  it("does not fetch metadata for an empty selection", async () => {
    expect(await fetchAssetCreditInputs({ id: 7, slug: "t/7" }, [])).toEqual([]);
    expect(mocks.credentials).not.toHaveBeenCalled();
  });
});
