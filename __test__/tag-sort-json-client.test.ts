// @vitest-environment node
import { saveTagSort, TagSortRequestError } from "@/app/tags/tagSortClient";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fetchMock = vi.fn();
const tags = [
  { id: 2, sort: 2 },
  { id: 1, sort: 1 },
];
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
it("posts only IDs and sort values and accepts canonical values from the server", async () => {
  const sorts = [
    { id: 2, sort: 100 },
    { id: 1, sort: 50 },
  ];
  fetchMock.mockResolvedValue(json({ success: true, data: { sorts } }));
  expect(await saveTagSort(tags)).toEqual({ success: true, data: { sorts } });
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
    "/api/tags/sort",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ tags }),
      redirect: "error",
    }),
  );
});
it.each([200, 400, 404, 413, 502, 504])(
  "handles HTML/non-RSC HTTP %s without retrying or exposing HTML",
  async (status) => {
    fetchMock.mockResolvedValue(
      new Response("<html>private upstream response</html>", {
        status,
        headers: { "content-type": "text/html", "x-request-id": "request-123" },
      }),
    );
    await expect(saveTagSort(tags)).rejects.toMatchObject({ status, requestId: "request-123" });
    expect(fetchMock).toHaveBeenCalledOnce();
  },
);
it("preserves structured permission errors", async () => {
  fetchMock.mockResolvedValue(
    json({ success: false, code: "forbidden", message: "No permission" }, 403),
  );
  expect(await saveTagSort(tags)).toEqual({ success: false, message: "No permission" });
});
it.each([
  { success: true },
  { success: true, data: { sorts: [] } },
  {
    success: true,
    data: {
      sorts: [
        { id: 2, sort: 1 },
        { id: 2, sort: 2 },
      ],
    },
  },
  {
    success: true,
    data: {
      sorts: [
        { id: 99, sort: 2 },
        { id: 1, sort: 1 },
      ],
    },
  },
])("does not report malformed receipts as success: %j", async (body) => {
  fetchMock.mockResolvedValue(json(body));
  await expect(saveTagSort(tags)).rejects.toBeInstanceOf(TagSortRequestError);
});
it("does not retry after a network failure with an unknown commit outcome", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  await expect(saveTagSort(tags)).rejects.toBeInstanceOf(TagSortRequestError);
  expect(fetchMock).toHaveBeenCalledOnce();
});
