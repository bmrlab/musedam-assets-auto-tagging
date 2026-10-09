// @vitest-environment node

import { detectMediaProcessObjects } from "@/lib/media-process/object-detection";
import type { ClassificationRemoteImageInput } from "@/lib/tagging/classification-image";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { findTeam } = vi.hoisted(() => ({ findTeam: vi.fn() }));
vi.mock("@/prisma/prisma", () => ({ default: { team: { findUnique: findTeam } } }));

const jobId = "26b031a1-489b-410c-bde9-f8c485305aba";
const base = "https://media.test/api";
const input: ClassificationRemoteImageInput = {
  width: 1280,
  height: 853,
  buffer: Buffer.from("preview"),
  byteLength: 7,
  mimeType: "image/jpeg",
  dataUrl: "data:image/jpeg;base64,cHJldmlldw==",
  sourceImage: { url: "https://assets.test/image.jpg?signature=abc", width: 2400, height: 1600 },
};
const submitted = {
  job_id: jobId,
  status_url: "http://internal-worker/status",
  response_url: "http://internal-worker/result",
};
const emptyResult = { status: "completed", result: { detections: [], found: false }, errors: "" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const run = (options: Partial<Parameters<typeof detectMediaProcessObjects>[0]> = {}) =>
  detectMediaProcessObjects({
    teamId: 7,
    imageInput: input,
    detectionLabelText: "face .",
    ...options,
  });

describe("media processing detection", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("MEDIA_PROCESS_SERVICE_URL", `${base}///`);
    vi.stubEnv("MEDIA_PROCESS_SERVICE_TOKEN", "media-token");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    findTeam.mockReset().mockResolvedValue({ slug: "t/16" });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("submits only a URL, authenticates reads, handles requeue, and scales original coordinates", async () => {
    fetchMock
      .mockResolvedValueOnce(json(submitted))
      .mockResolvedValueOnce(json({ status: "queued" }))
      .mockResolvedValueOnce(json({ status: "running" }))
      .mockResolvedValueOnce(json({ status: "queued" }))
      .mockResolvedValueOnce(json({ status: "completed" }))
      .mockResolvedValueOnce(
        json({
          status: "completed",
          errors: "",
          result: {
            detections: [
              { x_min: 120, y_min: 80, x_max: 1200, y_max: 800, score: 0.9, label: "face" },
            ],
            found: true,
          },
        }),
      );
    const promise = run({ teamId: 7, detectionMode: "product_instances" });
    await vi.advanceTimersByTimeAsync(7_000);
    expect(await promise).toEqual({
      detections: [
        {
          xMin: 64,
          yMin: expect.closeTo(42.65),
          xMax: 640,
          yMax: expect.closeTo(426.5),
          score: 0.9,
          label: "face",
        },
      ],
      found: true,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      file: input.sourceImage!.url,
      detection_label_text: "face .",
      detection_mode: "product_instances",
      team_id: 16,
    });
    expect(findTeam).toHaveBeenCalledExactlyOnceWith({
      where: { id: 7 },
      select: { slug: true },
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${base}/queue/object_detection_llm`,
      ...Array(4).fill(`${base}/queue/jobs/${jobId}/status`),
      `${base}/queue/jobs/${jobId}`,
    ]);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({
        cache: "no-store",
        headers: { Authorization: "Bearer media-token", "Content-Type": "application/json" },
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts a completed empty result and uses default detection mode", async () => {
    fetchMock
      .mockResolvedValueOnce(json(submitted))
      .mockResolvedValueOnce(json({ status: "completed" }))
      .mockResolvedValueOnce(json(emptyResult));
    expect(await run()).toEqual({ detections: [], found: false });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({
      detection_mode: "default",
    });
  });

  it("uses the synchronous envelope and scales original coordinates without polling", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        id: jobId,
        request: {},
        result: {
          detections: [
            { x_min: 120, y_min: 80, x_max: 1200, y_max: 800, score: 0.98, label: "face" },
          ],
          found: true,
        },
        error: {},
      }),
    );
    expect(await run({ requestMode: "sync" })).toEqual({
      detections: [
        {
          xMin: 64,
          yMin: expect.closeTo(42.65),
          xMax: 640,
          yMax: expect.closeTo(426.5),
          score: 0.98,
          label: "face",
        },
      ],
      found: true,
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `${base}/requests/object_detection_llm`,
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: { Authorization: "Bearer media-token", "Content-Type": "application/json" },
        signal: expect.any(AbortSignal),
        body: JSON.stringify({
          file: input.sourceImage!.url,
          detection_label_text: "face .",
          detection_mode: "default",
          team_id: 16,
        }),
      }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts no synchronous detections and preserves product_instances mode", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ id: jobId, request: {}, result: { detections: [], found: false }, error: {} }),
    );
    expect(await run({ requestMode: "sync", detectionMode: "product_instances" })).toEqual({
      detections: [],
      found: false,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({
      detection_mode: "product_instances",
    });
  });

  it("surfaces synchronous errors even when HTTP 200 includes a valid result", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        id: jobId,
        request: {},
        result: { detections: [], found: false },
        error: { object_detection_llm: "Creative Reasoning unavailable" },
      }),
    );
    await expect(run({ requestMode: "sync" })).rejects.toThrow("Creative Reasoning unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { job_id: jobId },
    { id: jobId, result: {}, error: null },
    { id: jobId, result: {}, error: { detection: 123 } },
  ])("rejects malformed synchronous envelopes", async (payload) => {
    fetchMock.mockResolvedValueOnce(json(payload));
    await expect(run({ requestMode: "sync" })).rejects.toThrow("invalid sync response");
  });

  it.each([null, {}, { found: true }, { detections: [{ x_min: "bad" }], found: true }])(
    "rejects malformed synchronous detection results",
    async (result) => {
      fetchMock.mockResolvedValueOnce(json({ id: jobId, request: {}, result, error: {} }));
      await expect(run({ requestMode: "sync" })).rejects.toThrow("invalid detection result");
    },
  );

  it.each(["async", "sync"] as const)(
    "rejects a missing team before a %s request",
    async (requestMode) => {
      findTeam.mockResolvedValueOnce(null);
      await expect(run({ requestMode })).rejects.toThrow("team 7 not found");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["16", "u/16", "t/nope", "t/-16", "t/1.5", "t/0", "t/9007199254740993"])(
    "rejects invalid MuseDAM team slug %s instead of sending the local ID",
    async (slug) => {
      findTeam.mockResolvedValueOnce({ slug });
      await expect(run()).rejects.toThrow("invalid MuseDAM");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("allows the synchronous service to finish LLM retries beyond a single detection timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((resolve, reject) => {
          setTimeout(
            () => resolve(json({ id: jobId, request: {}, result: emptyResult.result, error: {} })),
            180_000,
          );
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), {
            once: true,
          });
        }),
    );
    try {
      const promise = run({ requestMode: "sync" });
      await vi.advanceTimersByTimeAsync(180_000);
      expect(await promise).toEqual({ detections: [], found: false });
      expect(timeoutSpy).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it.each(["discarded", "cancelled"])("surfaces %s job errors", async (status) => {
    fetchMock
      .mockResolvedValueOnce(json(submitted))
      .mockResolvedValueOnce(json({ status }))
      .mockResolvedValueOnce(
        json({ status, result: null, errors: "worker could not fetch image" }),
      );
    await expect(run()).rejects.toThrow(`${status}: worker could not fetch image`);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { status: "completed", result: null, errors: "" },
    { status: "completed", result: { found: true }, errors: "" },
    { status: "completed", result: { detections: [{ x_min: "bad" }], found: true }, errors: "" },
  ])("rejects malformed results instead of returning no detections", async (payload) => {
    fetchMock
      .mockResolvedValueOnce(json(submitted))
      .mockResolvedValueOnce(json({ status: "completed" }))
      .mockResolvedValueOnce(json(payload));
    await expect(run()).rejects.toThrow("invalid detection result");
  });

  it("rejects a submission without job_id", async () => {
    fetchMock.mockResolvedValueOnce(json({ status_url: "/somewhere" }));
    await expect(run()).rejects.toThrow("missing job_id");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown statuses", async () => {
    fetchMock
      .mockResolvedValueOnce(json(submitted))
      .mockResolvedValueOnce(json({ status: "unknown" }));
    await expect(run()).rejects.toThrow("invalid job status");
  });

  it("rejects non-JSON responses", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not json"));
    await expect(run()).rejects.toThrow("invalid JSON");
  });

  it.each(["async", "sync"] as const)(
    "never retries an unsuccessful %s submission",
    async (requestMode) => {
      fetchMock.mockResolvedValueOnce(json({ detail: "queue unavailable" }, 503));
      await expect(run({ requestMode })).rejects.toThrow("(503): queue unavailable");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("retries transient status reads without creating another job", async () => {
    fetchMock
      .mockResolvedValueOnce(json(submitted))
      .mockResolvedValueOnce(json({ detail: "temporarily unavailable" }, 503))
      .mockResolvedValueOnce(json({ status: "completed" }))
      .mockResolvedValueOnce(json(emptyResult));
    const promise = run();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await promise).toEqual({ detections: [], found: false });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("fails immediately on polling authentication errors", async () => {
    fetchMock
      .mockResolvedValueOnce(json(submitted))
      .mockResolvedValueOnce(json({ detail: "Unauthenticated" }, 401));
    await expect(run()).rejects.toThrow("(401): Unauthenticated");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bounds total queue wait and clears polling timers", async () => {
    fetchMock
      .mockResolvedValueOnce(json(submitted))
      .mockImplementation(async () => json({ status: "queued" }));
    const assertion = expect(run()).rejects.toThrow(`timed out after 1800000ms (job ${jobId})`);
    await vi.advanceTimersByTimeAsync(30 * 60_000 - 1);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["async", "sync"] as const)(
    "aborts a hanging %s request at the total deadline",
    async (requestMode) => {
      fetchMock.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), {
              once: true,
            });
          }),
      );
      const assertion = expect(run({ requestMode })).rejects.toThrow("timed out after 1800000ms");
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      await assertion;
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["data:image/jpeg;base64,YWJj", "/api/s3/object", "file:///tmp/image.jpg"])(
    "rejects non-HTTP image input %s",
    async (url) => {
      await expect(
        run({ imageInput: { ...input, sourceImage: { ...input.sourceImage!, url } } }),
      ).rejects.toThrow("HTTP(S)");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
