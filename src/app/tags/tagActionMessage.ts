import { MAX_TAG_LEVEL, TAG_LEVEL_EXCEEDED_MESSAGE } from "@/lib/tagging/tag-level";

type Translate = (key: "tagLevelExceeded", values: { max: number }) => string;

/**
 * 标签 server action 返回 / 抛出的错误信息本地化：层级超限时服务端返回固定中文常量，
 * 这里映射为 TagsPage.tagLevelExceeded；其他信息原样返回（为空时返回 undefined，由调用方兜底）。
 */
export function localizeTagActionMessage(
  message: string | undefined | null,
  t: Translate,
): string | undefined {
  if (!message) return undefined;
  if (message === TAG_LEVEL_EXCEEDED_MESSAGE) {
    return t("tagLevelExceeded", { max: MAX_TAG_LEVEL });
  }
  return message;
}
