import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { locales } from "./routing";

const getMessages = async (locale: string) => {
  const [messages, taggingMessages] = await Promise.all([
    import(`../../messages/${locale}.json`),
    import(`../app/(tagging)/messages/${locale}.json`),
  ]);
  return {
    ...messages.default,
    ...taggingMessages.default,
  };
};

export default getRequestConfig(async ({ locale }) => {
  if (!locale) {
    // Get locale from cookie or header
    const [cookieLocale, headerLocale] = await Promise.all([cookies(), headers()]).then(
      ([cookies, headers]) => [cookies.get("locale")?.value, headers.get("x-locale")],
    );
    const defaultLocale = "zh-CN"; // 一定要有默认的 locale，不然后面 getMessages(undefined) 会报错
    locale = (cookieLocale || headerLocale || defaultLocale) as (typeof locales)[number];
  }
  return {
    locale,
    messages: await getMessages(locale),
  };
});
