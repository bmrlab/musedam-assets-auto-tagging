import "server-only";

// 私有化迁移导入 —— 进程内后台任务。
//
// 为什么不在请求里同步跑：大团队的 db/resources 阶段要跑几分钟到几十分钟，Ingress 一般 60s 就断，
// 但 Node 里的处理不会停；用户看到 504 再刷新就会起第二个导入和第一个并发 upsert 同一批行。
// 所以改成：触发接口立刻返回任务 id，导入在后台跑，进程内同一时间只允许一个任务，
// 状态接口随时能看进度 / 失败项 / 最近日志。
//
// 只保留最近一次任务的状态（进程内存），Pod 重启就没了；导入本身幂等，重跑即可。
// Web 只跑一个副本（见 docs/private-deployment.md 第 4 节），所以进程内锁足够。

import { getHeapStatistics } from "v8";
import { rootLogger } from "@/lib/logging";
import { getS3StorageLocation, headS3Object, uploadS3Object } from "@/lib/s3";
import prisma from "@/prisma/prisma";
import type { MigrationBundle } from "./export-team";
import {
  assertMigrationBundle,
  ImportCancelledError,
  importTeamBundle,
  type ImportPhase,
  type ImportProgress,
  type ImportResult,
  type ImportStorage,
} from "./import-team";

export type ImportJobStatus = "fetching" | "running" | "done" | "failed" | "cancelled";

export type ImportJobParams = {
  bundleUrl: string;
  phase: ImportPhase;
  dryRun: boolean;
  rewriteFolder?: string;
  sourceUrlBase?: string;
  concurrency: number;
  batchSize: number;
  startedBy: string;
};

export type ImportJob = {
  id: string;
  status: ImportJobStatus;
  params: Omit<ImportJobParams, "bundleUrl"> & { bundleUrl: string }; // bundleUrl 已去掉签名参数
  startedAt: string;
  finishedAt?: string;
  elapsedSeconds: number;
  bundle?: { teamId: number; teamSlug: string; imageCount: number; signedUrlExpiresAt: string | null; bytes: number };
  progress?: ImportProgress;
  result?: ImportResult;
  error?: string;
  // 最近 MAX_LOG_LINES 行
  logs: string[];
  memory: { heapUsedMB: number; rssMB: number; heapLimitMB: number };
};

const MAX_LOG_LINES = 400;
const MAX_BUNDLE_BYTES = 1024 * 1024 * 1024;
const logger = rootLogger.child({ module: "migration-import" });

type JobState = {
  job: ImportJob;
  cancelRequested: boolean;
  promise: Promise<void>;
};

// 用 globalThis 挂单例，dev 下热更新不会丢
const g = globalThis as unknown as { __migrationImportJob?: JobState };

function memory() {
  const m = process.memoryUsage();
  return {
    heapUsedMB: Math.round(m.heapUsed / 1024 / 1024),
    rssMB: Math.round(m.rss / 1024 / 1024),
    // heap 上限来自 NODE_OPTIONS --max-old-space-size
    heapLimitMB: Math.round(getHeapStatistics().heap_size_limit / 1024 / 1024),
  };
}

function stripQuery(url: string) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split("?")[0];
  }
}

function snapshot(state: JobState): ImportJob {
  const j = state.job;
  const end = j.finishedAt ? new Date(j.finishedAt).getTime() : Date.now();
  return {
    ...j,
    elapsedSeconds: Math.round((end - new Date(j.startedAt).getTime()) / 1000),
    memory: memory(),
    logs: [...j.logs],
  };
}

export function getImportJob(): ImportJob | null {
  return g.__migrationImportJob ? snapshot(g.__migrationImportJob) : null;
}

export function isImportJobRunning() {
  const s = g.__migrationImportJob;
  return !!s && (s.job.status === "fetching" || s.job.status === "running");
}

export function cancelImportJob(): ImportJob | null {
  const s = g.__migrationImportJob;
  if (!s) return null;
  if (isImportJobRunning()) {
    s.cancelRequested = true;
    pushLog(s, "收到取消请求，将在当前批次结束后停止");
    logger.warn({ jobId: s.job.id }, "import job cancel requested");
  }
  return snapshot(s);
}

function pushLog(state: JobState, msg: string) {
  const line = `${new Date().toISOString()} ${msg}`;
  state.job.logs.push(line);
  if (state.job.logs.length > MAX_LOG_LINES) state.job.logs.splice(0, state.job.logs.length - MAX_LOG_LINES);
  logger.info({ jobId: state.job.id }, msg.trim());
}

async function fetchBundle(state: JobState, bundleUrl: string): Promise<MigrationBundle> {
  let url: URL;
  try {
    url = new URL(bundleUrl);
  } catch {
    throw new Error(`bundleUrl 不合法: ${bundleUrl}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("bundleUrl 只支持 http(s)");

  const shown = stripQuery(bundleUrl);
  pushLog(state, `拉取数据包 ${shown}`);
  const t0 = Date.now();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`拉取数据包失败: ${res.status} ${shown}`);
  const length = Number(res.headers.get("content-length") || 0);
  if (length > MAX_BUNDLE_BYTES) throw new Error(`数据包过大: ${length} bytes`);

  // 先拿文本再 parse，文本用完立刻不再引用，让 GC 能回收那份 70MB+ 的字符串
  let text: string | null = await res.text();
  const bytes = Buffer.byteLength(text);
  pushLog(state, `下载完成 ${(bytes / 1024 / 1024).toFixed(1)} MB，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s，开始解析`);
  const bundle: unknown = JSON.parse(text);
  text = null;
  assertMigrationBundle(bundle, shown);

  const m = memory();
  state.job.bundle = {
    teamId: bundle.manifest.teamId,
    teamSlug: bundle.manifest.teamSlug,
    imageCount: bundle.assets.length,
    signedUrlExpiresAt: bundle.manifest.signedUrlExpiresAt,
    bytes,
  };
  const tables = Object.entries(bundle.db)
    .filter(([, rows]) => rows.length > 0)
    .map(([k, rows]) => `${k}=${rows.length}`)
    .join(", ");
  pushLog(state, `解析完成：Team #${bundle.manifest.teamId} ${bundle.manifest.teamSlug}，图片 ${bundle.assets.length} 张`);
  pushLog(state, `表行数：${tables}`);
  pushLog(state, `内存：heap ${m.heapUsedMB}MB / 上限 ${m.heapLimitMB}MB，rss ${m.rssMB}MB`);
  return bundle;
}

function buildStorage(): ImportStorage {
  const { bucket, folder } = getS3StorageLocation();
  return {
    label: "私有化对象存储",
    bucket,
    folder,
    head: headS3Object,
    put: async (objectKey, body, contentType) => {
      await uploadS3Object({ objectKey, body, contentType: contentType || "application/octet-stream" });
    },
  };
}

async function run(state: JobState, params: ImportJobParams) {
  const job = state.job;
  try {
    let bundle: MigrationBundle | null = await fetchBundle(state, params.bundleUrl);
    if (state.cancelRequested) throw new ImportCancelledError();

    job.status = "running";
    const storage = params.phase === "all" || params.phase === "resources" ? buildStorage() : undefined;

    let lastProgressLog = 0;
    const result = await importTeamBundle(prisma, bundle, {
      phase: params.phase,
      dryRun: params.dryRun,
      storage,
      rewriteFolder: params.rewriteFolder,
      sourceUrlBase: params.sourceUrlBase,
      concurrency: params.concurrency,
      batchSize: params.batchSize,
      log: (msg) => pushLog(state, msg),
      onProgress: (p) => {
        job.progress = p;
        // 大表每 10 秒往 stdout 打一条心跳，方便在 Pod 日志里看进度
        const now = Date.now();
        if (now - lastProgressLog > 10_000) {
          lastProgressLog = now;
          logger.info({ jobId: job.id, ...p, ...memory() }, "import progress");
        }
      },
      shouldCancel: () => state.cancelRequested,
    });
    bundle = null;

    job.result = result;
    const failed = !!result.resources?.failed || (result.verify ? !result.verify.ok : false);
    job.status = failed ? "failed" : "done";
    if (failed) {
      job.error = result.resources?.failed
        ? `${result.resources.failed} 张图片迁移失败，重新触发 resources 阶段即可重试`
        : "verify 行数不一致，请检查日志";
    }
    pushLog(state, `任务结束：${job.status}${job.error ? `（${job.error}）` : ""}`);
    logger.info({ jobId: job.id, status: job.status, phase: params.phase, dryRun: params.dryRun }, "import job finished");
  } catch (err) {
    if (err instanceof ImportCancelledError) {
      job.status = "cancelled";
      job.error = err.message;
      pushLog(state, "任务已取消");
      logger.warn({ jobId: job.id }, "import job cancelled");
    } else {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
      pushLog(state, `任务失败：${job.error}`);
      logger.error({ jobId: job.id, err }, "import job failed");
    }
  } finally {
    job.finishedAt = new Date().toISOString();
    job.progress = undefined;
  }
}

// 返回 { started: false } 表示已有任务在跑，附带其快照
export function startImportJob(params: ImportJobParams): { started: boolean; job: ImportJob } {
  if (isImportJobRunning()) {
    return { started: false, job: snapshot(g.__migrationImportJob!) };
  }

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const state: JobState = {
    job: {
      id,
      status: "fetching",
      params: { ...params, bundleUrl: stripQuery(params.bundleUrl) },
      startedAt: new Date().toISOString(),
      elapsedSeconds: 0,
      logs: [],
      memory: memory(),
    },
    cancelRequested: false,
    promise: Promise.resolve(),
  };
  g.__migrationImportJob = state;

  logger.info(
    { jobId: id, phase: params.phase, dryRun: params.dryRun, startedBy: params.startedBy, bundleUrl: state.job.params.bundleUrl },
    "import job started",
  );
  pushLog(state, `任务 ${id} 由 ${params.startedBy} 触发：phase=${params.phase} dryRun=${params.dryRun}`);

  // 不 await：让触发接口立刻返回
  state.promise = run(state, params);
  return { started: true, job: snapshot(state) };
}
