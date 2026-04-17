import "server-only";

import { executeGenerateTagTreeByLLM } from "@/app/tags/generateTagTreeLLM";
import { Locale } from "@/i18n/routing";
import { rootLogger } from "@/lib/logging";
import { TagTreeGenerationJobExtra, TagTreeGenerationJobResult } from "@/prisma/client";
import prisma from "@/prisma/prisma";
import { TaggingQueueItem } from "@/prisma/client";

export const TAG_TREE_JOB_KIND = "tag-tree-generation" as const;
const TAG_TREE_QUEUE_LLM_TIMEOUT_MS = Number(
  process.env.TAG_TREE_QUEUE_LLM_TIMEOUT_MS ?? process.env.TAG_TREE_LLM_TIMEOUT_MS ?? 300000,
);

export async function createTagTreeJob({
  teamId,
  userId,
  prompt,
  lang,
  requestId,
}: {
  teamId: number;
  userId: number;
  prompt: string;
  lang: string;
  requestId?: string;
}): Promise<TaggingQueueItem> {
  const extra: TagTreeGenerationJobExtra = {
    jobKind: TAG_TREE_JOB_KIND,
    prompt,
    lang,
    userId,
    requestId,
  };

  const item = await prisma.taggingQueueItem.create({
    data: {
      teamId,
      status: "pending",
      taskType: "manual",
      startsAt: new Date(),
      extra: extra as object,
      result: {},
    },
  });

  rootLogger.info({
    msg: "tag-tree job created",
    jobId: item.id,
    teamId,
    userId,
    requestId,
    lang,
    promptLength: prompt.length,
  });

  return item;
}

export function isTagTreeJob(item: TaggingQueueItem): boolean {
  const extra = item.extra as Record<string, unknown> | null;
  return extra?.jobKind === TAG_TREE_JOB_KIND;
}

export async function processTagTreeQueueItem(item: TaggingQueueItem): Promise<void> {
  const extra = item.extra as TagTreeGenerationJobExtra;
  const logger = rootLogger.child({
    jobId: item.id,
    teamId: item.teamId,
    requestId: extra.requestId,
  });

  const startedAt = Date.now();
  logger.info({ msg: "tag-tree job worker start", lang: extra.lang, promptLength: extra.prompt?.length });

  try {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`TAG_TREE_LLM_TIMEOUT(${TAG_TREE_QUEUE_LLM_TIMEOUT_MS}ms)`));
      }, TAG_TREE_QUEUE_LLM_TIMEOUT_MS);
    });

    const llmResult = await Promise.race([
      executeGenerateTagTreeByLLM({
        finalPrompt: extra.prompt,
        lang: extra.lang as Locale,
        teamId: item.teamId,
        requestId: extra.requestId,
      }),
      timeoutPromise,
    ]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });

    const elapsedMs = Date.now() - startedAt;

    if (llmResult.success) {
      const result: TagTreeGenerationJobResult = {
        text: llmResult.data.text,
        input: llmResult.data.input,
      };
      await prisma.taggingQueueItem.update({
        where: { id: item.id },
        data: {
          status: "completed",
          endsAt: new Date(),
          result: result as object,
        },
      });
      logger.info({ msg: "tag-tree job completed", elapsedMs });
    } else {
      const result: TagTreeGenerationJobResult = { error: llmResult.message };
      await prisma.taggingQueueItem.update({
        where: { id: item.id },
        data: {
          status: "failed",
          endsAt: new Date(),
          result: result as object,
        },
      });
      logger.warn({ msg: "tag-tree job failed (llm error)", error: llmResult.message, elapsedMs });
    }
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    const result: TagTreeGenerationJobResult = { error: message };
    await prisma.taggingQueueItem.update({
      where: { id: item.id },
      data: {
        status: "failed",
        endsAt: new Date(),
        result: result as object,
      },
    });
    logger.error({
      msg: "tag-tree job failed (exception)",
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
      elapsedMs,
    });
  }
}
