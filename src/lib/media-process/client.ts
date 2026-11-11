import "server-only";

import { slugToId } from "@/lib/slug";
import { DETECTION_TIMEOUT_MS } from "@/lib/tagging/external-timeouts";
import { queueAbortSignal } from "@/lib/tagging/queue-execution";
import prisma from "@/prisma/prisma";
import { z } from "zod";

export type MediaProcessRequestMode = "async" | "sync";

const queuedJobSchema = z.object({ job_id: z.string().trim().min(1) });
const jobStatusSchema = z.object({
  status: z.enum(["queued", "running", "completed", "discarded", "cancelled"]),
});
const jobResultSchema = jobStatusSchema.extend({
  result: z.unknown(),
  errors: z.string().nullish(),
});
const syncResultSchema = z.object({
  id: z.string().trim().min(1),
  result: z.unknown(),
  error: z.record(z.string(), z.string()),
});
class MediaProcessHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function isRetryableReadError(error: unknown) {
  return (
    (error instanceof MediaProcessHttpError &&
      [408, 429, 500, 502, 503, 504].includes(error.status)) ||
    error instanceof TypeError ||
    (error instanceof Error && error.name === "TimeoutError")
  );
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

export async function resolveMediaProcessTeamId(teamId: number, errorPrefix: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { slug: true },
  });
  if (!team) throw new Error(`${errorPrefix}: team ${teamId} not found`);

  let orgId: number;
  try {
    // Media processing uses the MuseDAM org ID, not this application's Team.id.
    orgId = Number(slugToId("team", team.slug).toString());
  } catch {
    throw new Error(`${errorPrefix}: team ${teamId} has an invalid MuseDAM team slug`);
  }
  if (!Number.isSafeInteger(orgId) || orgId <= 0) {
    throw new Error(`${errorPrefix}: team ${teamId} has an invalid MuseDAM org ID`);
  }
  return orgId;
}

function waitForPoll(delayMs: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runMediaProcessRequest({
  entrypoint,
  requestBody,
  requestMode = "async",
  errorPrefix,
  timeoutMs,
  signal: abortSignal,
}: {
  entrypoint: "object_detection_llm" | "video_sprite";
  requestBody: string;
  requestMode?: MediaProcessRequestMode;
  errorPrefix: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<unknown> {
  const baseUrl = requiredEnv("MEDIA_PROCESS_SERVICE_URL").replace(/\/+$/, "");
  const token = requiredEnv("MEDIA_PROCESS_SERVICE_TOKEN");
  const parentSignal = queueAbortSignal(abortSignal);
  parentSignal?.throwIfAborted();
  const controller = new AbortController();
  let jobId: string | undefined;
  const timer = setTimeout(() => {
    controller.abort(
      new Error(`${errorPrefix} timed out after ${timeoutMs}ms${jobId ? ` (job ${jobId})` : ""}`),
    );
  }, timeoutMs);

  const signal = parentSignal
    ? AbortSignal.any([controller.signal, parentSignal])
    : controller.signal;

  async function requestOnce(path: string, init: RequestInit = {}) {
    signal.throwIfAborted();
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      // A synchronous response includes all service-side LLM attempts.
      signal:
        requestMode === "sync"
          ? signal
          : AbortSignal.any([signal, AbortSignal.timeout(DETECTION_TIMEOUT_MS)]),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail =
        payload && typeof payload === "object" && "detail" in payload
          ? typeof payload.detail === "string"
            ? payload.detail
            : JSON.stringify(payload.detail)
          : "";
      throw new MediaProcessHttpError(
        `${errorPrefix} request failed (${response.status})${detail ? `: ${detail}` : ""}`,
        response.status,
      );
    }
    if (payload === null) throw new Error(`${errorPrefix} returned invalid JSON`);
    return payload;
  }

  async function request(path: string, init: RequestInit = {}) {
    let retryDelayMs = 1_000;
    for (;;) {
      try {
        return await requestOnce(path, init);
      } catch (error) {
        signal.throwIfAborted();
        // Only retry reads. Repeating an ambiguously successful POST could create duplicate jobs.
        if (init.method === "POST" || !isRetryableReadError(error)) throw error;
        await waitForPoll(retryDelayMs, signal);
        retryDelayMs = Math.min(retryDelayMs * 2, 5_000);
      }
    }
  }

  try {
    if (requestMode === "sync") {
      const response = syncResultSchema.safeParse(
        await request(`/requests/${entrypoint}`, { method: "POST", body: requestBody }),
      );
      if (!response.success) throw new Error(`${errorPrefix} returned an invalid sync response`);
      const errors = Object.entries(response.data.error);
      if (errors.length > 0) {
        throw new Error(
          `${errorPrefix} request ${response.data.id} failed: ${errors.map(([key, value]) => `${key}: ${value}`).join("; ")}`,
        );
      }
      return response.data.result;
    }

    const submitted = queuedJobSchema.safeParse(
      await request(`/queue/${entrypoint}`, {
        method: "POST",
        body: requestBody,
      }),
    );
    if (!submitted.success) throw new Error(`${errorPrefix} response missing job_id`);
    jobId = submitted.data.job_id;
    // Derive paths from our configured service; returned URLs may use an internal proxy host.
    const jobPath = `/queue/jobs/${encodeURIComponent(jobId)}`;
    let pollDelayMs = 1_000;
    for (;;) {
      const status = jobStatusSchema.safeParse(await request(`${jobPath}/status`));
      if (!status.success) throw new Error(`${errorPrefix} returned an invalid job status`);
      if (status.data.status === "queued" || status.data.status === "running") {
        await waitForPoll(pollDelayMs, signal);
        pollDelayMs = Math.min(pollDelayMs * 2, 5_000);
        continue;
      }

      const job = jobResultSchema.safeParse(await request(jobPath));
      if (!job.success) throw new Error(`${errorPrefix} returned an invalid job result`);
      if (status.data.status !== "completed" || job.data.status !== "completed") {
        const failedStatus =
          status.data.status !== "completed" ? status.data.status : job.data.status;
        throw new Error(
          `${errorPrefix} job ${jobId} ${failedStatus}${job.data.errors ? `: ${job.data.errors}` : ""}`,
        );
      }
      if (job.data.errors) {
        throw new Error(`${errorPrefix} job ${jobId} failed: ${job.data.errors}`);
      }
      return job.data.result;
    }
  } catch (error) {
    if (signal.aborted) {
      if (jobId && (parentSignal?.aborted || entrypoint === "video_sprite")) {
        // Media process can cancel jobs that are still queued.
        await fetch(`${baseUrl}/queue/jobs/${encodeURIComponent(jobId)}/cancel`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(2_000),
        }).catch(() => undefined);
      }
      throw signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
