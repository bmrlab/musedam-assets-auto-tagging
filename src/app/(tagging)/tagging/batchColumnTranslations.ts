import "server-only";

import { getLocale } from "next-intl/server";
import deDEMessages from "../messages/de-DE.json";
import enUSMessages from "../messages/en-US.json";
import esESMessages from "../messages/es-ES.json";
import frFRMessages from "../messages/fr-FR.json";
import hiINMessages from "../messages/hi-IN.json";
import idIDMessages from "../messages/id-ID.json";
import itITMessages from "../messages/it-IT.json";
import jaJPMessages from "../messages/ja-JP.json";
import koKRMessages from "../messages/ko-KR.json";
import plPLMessages from "../messages/pl-PL.json";
import ptBRMessages from "../messages/pt-BR.json";
import ruRUMessages from "../messages/ru-RU.json";
import thTHMessages from "../messages/th-TH.json";
import trTRMessages from "../messages/tr-TR.json";
import viVNMessages from "../messages/vi-VN.json";
import zhCNMessages from "../messages/zh-CN.json";
import zhTWMessages from "../messages/zh-TW.json";
import type { BatchColumnDefinition } from "./batchFile";

type BatchColumnTranslationNamespace =
  | "BrandLibrary"
  | "PersonLibrary"
  | "ProductLibrary"
  | "IpLibrary";
type BatchColumnMessages = {
  Tagging: Record<
    BatchColumnTranslationNamespace,
    {
      batchImportExport: {
        columns: Record<string, string>;
      };
    }
  >;
};

const DEFAULT_LOCALE = "en-US";

const TAGGING_MESSAGES_BY_LOCALE = {
  "de-DE": deDEMessages,
  "en-US": enUSMessages,
  "es-ES": esESMessages,
  "fr-FR": frFRMessages,
  "hi-IN": hiINMessages,
  "id-ID": idIDMessages,
  "it-IT": itITMessages,
  "ja-JP": jaJPMessages,
  "ko-KR": koKRMessages,
  "pl-PL": plPLMessages,
  "pt-BR": ptBRMessages,
  "ru-RU": ruRUMessages,
  "th-TH": thTHMessages,
  "tr-TR": trTRMessages,
  "vi-VN": viVNMessages,
  "zh-CN": zhCNMessages,
  "zh-TW": zhTWMessages,
} as unknown as Record<string, BatchColumnMessages>;

export async function getLocalizedBatchColumns<TKey extends string>({
  namespace,
  columnKeys,
  fallbackHeaders,
}: {
  namespace: BatchColumnTranslationNamespace;
  columnKeys: readonly TKey[];
  fallbackHeaders: Record<TKey, string>;
}): Promise<BatchColumnDefinition<TKey>[]> {
  const locale = await getLocale();
  const currentHeaders = getBatchColumnHeadersForLocale(locale, namespace);
  const allHeaders = Object.values(TAGGING_MESSAGES_BY_LOCALE).map((messages) =>
    getBatchColumnHeaders(messages, namespace),
  );

  return columnKeys.map((key) => {
    const header = currentHeaders[key] || fallbackHeaders[key];
    const aliases = allHeaders
      .map((headers) => headers[key])
      .filter((value): value is string => Boolean(value?.trim()));

    return {
      key,
      header,
      aliases: Array.from(new Set([fallbackHeaders[key], ...aliases])),
    };
  });
}

function getBatchColumnHeadersForLocale(
  locale: string,
  namespace: BatchColumnTranslationNamespace,
) {
  const messages =
    TAGGING_MESSAGES_BY_LOCALE[locale as keyof typeof TAGGING_MESSAGES_BY_LOCALE] ??
    TAGGING_MESSAGES_BY_LOCALE[DEFAULT_LOCALE];

  return getBatchColumnHeaders(messages, namespace);
}

function getBatchColumnHeaders(
  messages: BatchColumnMessages,
  namespace: BatchColumnTranslationNamespace,
): Record<string, string> {
  return messages.Tagging[namespace].batchImportExport.columns;
}
