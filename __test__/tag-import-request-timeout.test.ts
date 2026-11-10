// @vitest-environment node
import { runWithTagImportSignal } from "@/lib/tagging/tag-import-runtime";
import { requestMuseDAMAPI } from "@/musedam/lib";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function stalledFetch() {
  const fetch = vi.fn(async (_url, init: RequestInit) => new Promise<Response>((_, reject) => {
    init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

it("bounds import credential exchange, including requests without an explicit timeout", async () => {
  const timeout = new AbortController();
  const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeout.signal);
  const fetch = stalledFetch();
  const pending = runWithTagImportSignal(new AbortController().signal, () =>
    requestMuseDAMAPI("/api/muse/exchange-api-key", { method: "POST" }),
  );
  const failed = expect(pending).rejects.toThrow("upstream timeout");
  timeout.abort(new Error("upstream timeout"));
  await failed;
  expect(timeoutSpy).toHaveBeenCalledWith(75_000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("cancels an active upstream request when the whole import loses its lease", async () => {
  const controller = new AbortController();
  const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
  stalledFetch();
  const pending = runWithTagImportSignal(controller.signal, () =>
    requestMuseDAMAPI("/api/muse/merge-tags", { method: "POST", timeoutMs: 12_000 }),
  );
  const failed = expect(pending).rejects.toThrow("import expired");
  controller.abort(new Error("import expired"));
  await failed;
  expect(timeoutSpy).toHaveBeenCalledWith(12_000);
});

it("never starts another upstream request from an already expired import", async () => {
  const controller = new AbortController(); controller.abort(new Error("expired"));
  const fetch = stalledFetch();
  await expect(runWithTagImportSignal(controller.signal, () =>
    requestMuseDAMAPI("/api/muse/merge-tags", { method: "POST" }),
  )).rejects.toThrow("expired");
  expect(fetch).not.toHaveBeenCalled();
});
