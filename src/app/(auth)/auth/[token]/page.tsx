import { TokenAuthPageClient } from "./TokenAuthPageClient";

export default async function TokenAuthPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<
    {
      callbackUrl?: string;
    } & Record<string, string>
  >;
}) {
  const { token } = await params;
  const { callbackUrl, ...rest } = await searchParams;

  let finalCallbackUrl = callbackUrl ?? "/";
  let theme: "light" | "dark" | undefined = undefined;
  let locale: "zh-CN" | "en-US" | undefined = undefined;

  // Append remaining searchParams to callbackUrl if there are any
  if (Object.keys(rest).length > 0) {
    const url = new URL(finalCallbackUrl, "http://localhost");
    Object.entries(rest).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    finalCallbackUrl = url.pathname + url.search + url.hash;
  }

  if (rest.locale === "zh-CN" || rest.locale === "en-US") {
    locale = rest.locale;
  }

  if (rest.theme === "light" || rest.theme === "dark") {
    theme = rest.theme;
  }

  return (
    <TokenAuthPageClient
      token={token}
      callbackUrl={finalCallbackUrl}
      theme={theme}
      locale={locale}
    />
  );
}
