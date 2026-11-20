import { isValidLocale } from "@/i18n/routing";
import type { Session } from "next-auth";
import { createTranslator, type AbstractIntlMessages, type TranslationValues } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { AsyncLocalStorage } from "node:async_hooks";
import "server-only";

type Context = {
  user: NonNullable<Session["user"]>;
  team: NonNullable<Session["team"]>;
  locale: string;
};
const context = new AsyncLocalStorage<Context>();
export const getTagImportJobContext = () => context.getStore();
/** Only the worker uses the identity of a persisted, permission-checked import. No login tokens are stored. */
export const runTagImportJobContext = <T>(value: Context, run: () => Promise<T>) =>
  context.run(value, run);
export async function getTagImportLocale() {
  return context.getStore()?.locale ?? (await getLocale());
}
type Translator = (key: string, values?: TranslationValues) => string;
export async function getTagImportTranslations(
  namespace: "TagsPage" | "Tagging.BatchImportExport",
): Promise<Translator> {
  const job = context.getStore();
  if (!job) return (await getTranslations(namespace)) as Translator;
  if (!isValidLocale(job.locale)) throw new Error("Invalid import locale");
  const [main, tagging] = await Promise.all([
    import(`../../../messages/${job.locale}.json`),
    import(`../(tagging)/messages/${job.locale}.json`),
  ]);
  const translate = createTranslator<AbstractIntlMessages>({
    locale: job.locale,
    messages: { ...main.default, ...tagging.default },
  }) as Translator;
  return (key, values) => translate(`${namespace}.${key}`, values);
}
