import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AssetThumbnail } from "@/components/AssetThumbnail";

vi.mock("next/image", () => ({ default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} /> }));
afterEach(cleanup);

it("loads a refreshed signed URL after the previous image failed", () => {
  const { container, rerender } = render(<AssetThumbnail asset={{ thumbnailUrl: "https://example.test/expired", extension: "jpg" }} />);
  fireEvent.error(container.querySelector("img")!);
  expect(container.querySelector("img")!.getAttribute("src")).not.toBe("https://example.test/expired");
  rerender(<AssetThumbnail asset={{ thumbnailUrl: "https://example.test/refreshed", extension: "jpg" }} />);
  expect(container.querySelector("img")!.getAttribute("src")).toBe("https://example.test/refreshed");
});

it("does not retry the same failed URL on unrelated renders", () => {
  const asset = { thumbnailUrl: "https://example.test/missing", extension: "jpg" };
  const { container, rerender } = render(<AssetThumbnail asset={asset} />);
  fireEvent.error(container.querySelector("img")!);
  rerender(<AssetThumbnail asset={{ ...asset }} maxWidth={48} />);
  expect(container.querySelector("img")!.getAttribute("src")).not.toBe(asset.thumbnailUrl);
});
