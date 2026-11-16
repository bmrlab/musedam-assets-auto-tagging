import IpDialog from "@/app/(tagging)/tagging/ip/IpDialog";
import type { IpItem } from "@/app/(tagging)/tagging/ip/types";
import ProductDialog from "@/app/(tagging)/tagging/product/ProductDialog";
import type { ProductItem } from "@/app/(tagging)/tagging/product/types";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ product: vi.fn(), ip: vi.fn(), t: (key: string) => key }));
vi.mock("next-intl", () => ({ useTranslations: () => mocks.t }));
vi.mock("@/components/ui/icons", () => ({ TagsIcon: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/(tagging)/tagging/product/actions", () => ({
  createAssetProductAction: vi.fn(),
  updateAssetProductAction: mocks.product,
  prepareAssetLibraryProductImagesAction: vi.fn(),
  prepareProductImageUploadAction: vi.fn(),
}));
vi.mock("@/app/(tagging)/tagging/ip/actions", () => ({
  createAssetIpAction: vi.fn(),
  updateAssetIpAction: mocks.ip,
  prepareAssetLibraryIpImagesAction: vi.fn(),
  prepareIpImageUploadAction: vi.fn(),
  detectAssetIpPartialFeatureAction: vi.fn(),
}));
vi.mock("@/app/(tagging)/tagging/product/SignedProductImage", () => ({
  default: () => <span>reference</span>,
}));
vi.mock("@/app/(tagging)/tagging/ip/SignedIpImage", () => ({
  default: () => <span>reference</span>,
}));
vi.mock("@/app/(tagging)/tagging/ip/IpPartialFeatureCropDialog", () => ({ default: () => null }));
vi.mock("@/app/(tagging)/tagging/components/DialogTagSelector", () => ({ default: () => null }));
vi.mock("@/app/(tagging)/tagging/product/ProductTypeSelect", () => ({ default: () => null }));
vi.mock("@/app/(tagging)/tagging/ip/IpTypeSelect", () => ({ default: () => null }));

const base = {
  id: "entry",
  slug: "entry",
  name: "entry",
  description: "",
  notes: "",
  enabled: true,
  status: "completed" as const,
  processedAt: null,
  processingError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  images: [
    {
      id: "image",
      objectKey: "image.png",
      signedUrl: "https://example.com/image.png",
      signedUrlExpiresAt: Date.now() + 60000,
      size: 1,
      mimeType: "image/png",
      sort: 0,
    },
  ],
  tags: [{ id: "tag", assetTagId: 1, tagPath: ["tag"] }],
};
const product: ProductItem = {
  ...base,
  productTypeId: "type",
  productTypeName: "type",
  generalCategory: "object",
  referenceMatchStrategy: "highest",
};
const ip: IpItem = {
  ...base,
  ipTypeId: "type",
  ipTypeName: "type",
  matchPattern: "whole",
  referenceMatchStrategy: "highest",
  images: base.images.map((image) => ({
    ...image,
    partialMatchPatternName: null,
    cropXMin: null,
    cropYMin: null,
    cropXMax: null,
    cropYMax: null,
    cropImageWidth: null,
    cropImageHeight: null,
    cropSource: null,
    cropDetectionLabel: null,
    cropDetectionScore: null,
  })),
};
const callbacks = {
  onOpenChange: vi.fn(),
  onSaved: vi.fn(),
  onProductTypesChange: vi.fn(),
  onProductTypeRenamed: vi.fn(),
  onProductTypeDeleted: vi.fn(),
  onIpTypesChange: vi.fn(),
  onIpTypeRenamed: vi.fn(),
  onIpTypeDeleted: vi.fn(),
};
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.product.mockResolvedValue({ success: true, data: { product } });
  mocks.ip.mockResolvedValue({ success: true, data: { ip } });
});

describe.each(["product", "ip"] as const)("%s multi-image match", (kind) => {
  function dialog(entry: ProductItem | IpItem | null, mode: "create" | "edit" = "edit") {
    return kind === "product" ? (
      <ProductDialog
        open
        mode={mode}
        product={entry as ProductItem | null}
        productTypes={[{ id: "type", name: "type", sort: 0 }]}
        usedProductTypeIds={[]}
        tags={[]}
        {...callbacks}
      />
    ) : (
      <IpDialog
        open
        mode={mode}
        ip={entry as IpItem | null}
        ipTypes={[{ id: "type", name: "type", sort: 0 }]}
        usedIpTypeIds={[]}
        tags={[]}
        {...callbacks}
      />
    );
  }
  const entry = kind === "product" ? product : ip;
  const save = kind === "product" ? mocks.product : mocks.ip;

  it("defaults a new entry to highest", () => {
    render(dialog(null, "create"));
    expect(
      screen
        .getByRole("button", { name: "dialog.matchStrategy.highest" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
  it("restores the saved mode and submits the selected value", async () => {
    render(dialog({ ...entry, referenceMatchStrategy: "average" }));
    expect(
      screen
        .getByRole("button", { name: "dialog.matchStrategy.average" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "dialog.matchStrategy.highest" }));
    fireEvent.click(screen.getByRole("button", { name: "dialog.save" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect((save.mock.calls[0][0] as FormData).get("referenceMatchStrategy")).toBe("highest");
  });
  it("submits average and resets it when opening a new entry", async () => {
    const view = render(dialog(entry));
    fireEvent.click(screen.getByRole("button", { name: "dialog.matchStrategy.average" }));
    fireEvent.click(screen.getByRole("button", { name: "dialog.save" }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect((save.mock.calls[0][0] as FormData).get("referenceMatchStrategy")).toBe("average");
    view.rerender(dialog(null, "create"));
    expect(
      screen
        .getByRole("button", { name: "dialog.matchStrategy.highest" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
