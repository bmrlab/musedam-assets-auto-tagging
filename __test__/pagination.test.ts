import { getVisiblePageNumbers } from "@/lib/pagination";
import { describe, expect, it } from "vitest";

describe("getVisiblePageNumbers", () => {
  it("renders every page when the total fits in the visible window", () => {
    expect(getVisiblePageNumbers(1, 2)).toEqual([1, 2]);
    expect(getVisiblePageNumbers(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("slides a five-page window around the current page", () => {
    expect(getVisiblePageNumbers(1, 10)).toEqual([1, 2, 3, 4, 5]);
    expect(getVisiblePageNumbers(5, 10)).toEqual([3, 4, 5, 6, 7]);
    expect(getVisiblePageNumbers(10, 10)).toEqual([6, 7, 8, 9, 10]);
  });
});
