import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { isValidLocale, locales } from "./routing";

const defaultLocale = "zh-CN" as const;

const getMessages = async (locale: string) => {
  // 验证 locale 是否有效，如果无效则使用默认值
  const validLocale = isValidLocale(locale) ? locale : defaultLocale;
  
  try {
    const [messages, taggingMessages] = await Promise.all([
      import(`../../messages/${validLocale}.json`),
      import(`../app/(tagging)/messages/${validLocale}.json`),
    ]);
    return {
      ...messages.default,
      ...taggingMessages.default,
    };
  } catch (error) {
    // 如果动态导入失败，回退到默认 locale
    if (validLocale !== defaultLocale) {
      const [messages, taggingMessages] = await Promise.all([
        import(`../../messages/${defaultLocale}.json`),
        import(`../app/(tagging)/messages/${defaultLocale}.json`),
      ]);
      return {
        ...messages.default,
        ...taggingMessages.default,
      };
    }
    throw error;
  }
};

export default getRequestConfig(async ({ locale }) => {
  if (!locale) {
    // Get locale from cookie or header
    const [cookieLocale, headerLocale] = await Promise.all([cookies(), headers()]).then(
      ([cookies, headers]) => [cookies.get("locale")?.value, headers.get("x-locale")],
    );
    locale = (cookieLocale || headerLocale || defaultLocale) as (typeof locales)[number];
  }
  
  // 确保 locale 有效
  if (!isValidLocale(locale)) {
    locale = defaultLocale;
  }
  
  return {
    locale,
    messages: await getMessages(locale),
  };
});
