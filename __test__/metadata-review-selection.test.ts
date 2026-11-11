import { applyMetadataReviewSelection } from "@/app/(tagging)/tagging/review/metadata-review-selection";
import { expect, it, vi } from "vitest";

it("partitions pending fields, ignores reviewed fields, and respects the 100-row API limit", async () => {
  const review = vi.fn().mockResolvedValue({});
  const rows = Array.from({ length: 202 }, (_, id) => ({ id, status: "pending" }));
  await applyMetadataReviewSelection([...rows, { id: 500, status: "approved" }], [1, 500], review);
  expect(review.mock.calls).toEqual([
    [[1], "reject"],
    [
      rows
        .filter((row) => row.id !== 1)
        .slice(0, 100)
        .map((row) => row.id),
      "approve",
    ],
    [
      rows
        .filter((row) => row.id !== 1)
        .slice(100, 200)
        .map((row) => row.id),
      "approve",
    ],
    [[201], "approve"],
  ]);
});

it("stops approval if saving exclusions fails", async () => {
  const review = vi.fn().mockRejectedValue(new Error("failed"));
  await expect(
    applyMetadataReviewSelection(
      [
        { id: 1, status: "pending" },
        { id: 2, status: "pending" },
      ],
      [1],
      review,
    ),
  ).rejects.toThrow("failed");
  expect(review).toHaveBeenCalledTimes(1);
  expect(review).toHaveBeenCalledWith([1], "reject");
});
