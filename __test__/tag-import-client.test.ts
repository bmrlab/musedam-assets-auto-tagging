// @vitest-environment node
import {
  precheckTagImportFile,
  resumeTagImport,
  submitTagImportFile,
  waitForTagImport,
} from "@/app/tags/tagImportClient";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/s3-browser-upload", () => ({ uploadS3ObjectFromBrowser: mocks.upload }));
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
const outcome = {
  success: true as const,
  data: { successCount: 1, failedCount: 0, skippedCount: 0, failures: [] },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  const memory = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => memory.get(key),
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  });
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.upload.mockResolvedValue(new Response(null, { status: 200 }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("uploads once for preview and confirmation, sends only receipts, then polls without replaying writes", async () => {
  mocks.fetch.mockImplementation(async (_url, init) => {
    if (!init.body)
      return json({ success: true, data: { jobId: 42, status: "completed", outcome } });
    const body = JSON.parse(init.body);
    return json({
      success: true,
      data:
        body.action === "upload"
          ? { uploadId: "upload-1", uploadUrl: "https://storage.example/import" }
          : body.action === "submit"
            ? { jobId: 42 }
            : { createCount: 1, issues: [] },
    });
  });
  const form = new FormData();
  form.set("file", new File(["tags"], "tags.csv"));
  const stage = vi.fn();
  await precheckTagImportFile(form, 4, stage);
  const pending = submitTagImportFile(form, 4, "overwrite", "zh-CN", stage);
  await vi.waitFor(() => expect(stage).toHaveBeenCalledWith("pending"));
  await vi.advanceTimersByTimeAsync(2000);
  expect(await pending).toEqual(outcome);
  expect(mocks.upload).toHaveBeenCalledOnce();
  expect(mocks.upload.mock.calls[0][0].acl).toBe("private");
  const bodies = mocks.fetch.mock.calls
    .filter(([, init]) => init.body)
    .map(([, init]) => JSON.parse(init.body));
  expect(bodies.map((body) => body.action)).toEqual(["upload", "precheck", "submit"]);
  expect(JSON.stringify(bodies)).not.toContain('"file":');
  expect(sessionStorage.getItem("tag-import-submitted-upload")).toBeUndefined();
});
it("resolves a remembered upload after refresh through a read-only query", async () => {
  sessionStorage.setItem("tag-import-submitted-upload", "remembered");
  mocks.fetch.mockResolvedValue(json({ success: true, data: { jobId: 42, status: "processing" } }));
  expect(await resumeTagImport()).toMatchObject({ jobId: 42 });
  expect(mocks.fetch).toHaveBeenCalledWith(
    "/api/tags/imports?uploadId=remembered",
    expect.objectContaining({ method: "GET" }),
  );
});
it("retries status reads for transient errors while never submitting another import", async () => {
  mocks.fetch
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(
      json({ success: true, data: { jobId: 42, status: "completed", outcome } }),
    );
  const stage = vi.fn();
  const pending = waitForTagImport({ jobId: 42, status: "processing" }, stage);
  await vi.advanceTimersByTimeAsync(4000);
  expect(await pending).toEqual(outcome);
  expect(stage).toHaveBeenCalledWith("reconnecting");
  expect(mocks.fetch.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
});
