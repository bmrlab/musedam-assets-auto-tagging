import { uploadS3ObjectFromBrowser } from "@/lib/s3-browser-upload";
import type { ServerActionResult } from "@/lib/serverAction";
import type { TagTreeBatchImportResult, TagTreeImportPrecheck } from "./tagBatchActions";
import { TAG_BATCH_MAX_FILE_BYTES } from "./tagBatchSpreadsheet";

export type TagImportStage = "uploading" | "pending" | "processing" | "reconnecting" | "";
type Receipt = { uploadId: string; uploadUrl: string };
type Job = {
  jobId: number;
  status: string;
  outcome?: ServerActionResult<TagTreeBatchImportResult>;
};
const uploads = new WeakMap<File, Promise<Receipt>>();
const STORAGE_KEY = "tag-import-submitted-upload";

async function request<T>(body?: object, query = ""): Promise<ServerActionResult<T>> {
  const response = await fetch(`/api/tags/imports${query}`, {
    method: body ? "POST" : "GET",
    redirect: "error",
    cache: "no-store",
    ...(body
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error("Import response unavailable");
  const result = await response.json();
  if (typeof result?.success !== "boolean") throw new Error("Invalid import response");
  return result;
}

async function upload(file: File, stage: (value: TagImportStage) => void) {
  if (file.size <= 0 || file.size > TAG_BATCH_MAX_FILE_BYTES)
    throw new Error("Import file must be at most 5 MiB");
  let pending = uploads.get(file);
  if (!pending) {
    pending = (async () => {
      stage("uploading");
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const receipt = await request<Receipt>({
        action: "upload",
        filename: file.name,
        size: file.size,
        sha256,
      });
      if (!receipt.success) throw new Error(receipt.message);
      const response = await uploadS3ObjectFromBrowser({
        uploadUrl: receipt.data.uploadUrl,
        file,
        contentType: "application/octet-stream",
        acl: "private",
      });
      if (!response.ok) throw new Error("Import upload failed");
      return receipt.data;
    })();
    uploads.set(file, pending);
    pending.catch(() => uploads.delete(file));
  }
  return pending;
}

function remember(uploadId: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, uploadId);
  } catch {}
}
function forget() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export async function waitForTagImport(
  job: Job,
  stage: (value: TagImportStage) => void,
  signal?: AbortSignal,
) {
  let current = job;
  let failures = 0;
  // Retry read-only status requests. Never replay a mutation on an ambiguous response.
  for (;;) {
    signal?.throwIfAborted();
    if (current.outcome) {
      forget();
      stage("");
      return current.outcome;
    }
    stage(current.status === "pending" ? "pending" : "processing");
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, 2000);
      signal?.addEventListener("abort", abort, { once: true });
    });
    try {
      const result = await request<Job>(undefined, `?jobId=${current.jobId}`);
      if (!result.success) throw new Error(result.message);
      current = result.data;
      failures = 0;
    } catch (error) {
      signal?.throwIfAborted();
      if (++failures >= 5) {
        stage("");
        throw error;
      }
      stage("reconnecting");
    }
  }
}

export async function resumeTagImport() {
  let uploadId: string | null = null;
  try {
    uploadId = sessionStorage.getItem(STORAGE_KEY);
  } catch {}
  let result = await request<Job | null>(
    undefined,
    uploadId ? `?uploadId=${encodeURIComponent(uploadId)}` : "",
  );
  if (!result.success && uploadId) {
    forget();
    result = await request<Job | null>();
  }
  if (!result.success) throw new Error(result.message);
  return result.data;
}

export async function precheckTagImportFile(
  form: FormData,
  level: 3 | 4,
  stage: (value: TagImportStage) => void,
) {
  try {
    const receipt = await upload(form.get("file") as File, stage);
    return await request<TagTreeImportPrecheck>({
      action: "precheck",
      uploadId: receipt.uploadId,
      level,
    });
  } finally {
    stage("");
  }
}

export async function submitTagImportFile(
  form: FormData,
  level: 3 | 4,
  mode: "merge" | "overwrite",
  locale: string,
  stage: (value: TagImportStage) => void,
  signal?: AbortSignal,
) {
  const receipt = await upload(form.get("file") as File, stage);
  // Remember before submitting, so a lost POST response can be resolved by a read after refresh.
  remember(receipt.uploadId);
  const skipRows: unknown = form.get("skipRows") ? JSON.parse(String(form.get("skipRows"))) : [];
  const submitted = await request<{ jobId: number }>({
    action: "submit",
    uploadId: receipt.uploadId,
    level,
    mode,
    locale,
    skipRows,
  });
  if (!submitted.success) {
    stage("");
    return submitted;
  }
  const outcome = await waitForTagImport(
    { jobId: submitted.data.jobId, status: "pending" },
    stage,
    signal,
  );
  uploads.delete(form.get("file") as File);
  return outcome;
}
