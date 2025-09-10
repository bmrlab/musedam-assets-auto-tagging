import { getRequestClientIp, getRequestOrigin } from "@/lib/request/headers";
import { Locale } from "next-intl";
import { NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|_public|_pages|favicon.ico|manifest.json|sitemap.xml|robots.txt|llm.txt).*)",
  ],
};

async function handlePingRequest(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const clientIp = await getRequestClientIp();
  const requestOrigin = await getRequestOrigin();
  const headers = Object.fromEntries(req.headers);
  return new NextResponse(
    JSON.stringify({
      path,
      clientIp,
      requestOrigin,
      headers,
      nextUrl: req.nextUrl,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function handleLocale(req: NextRequest) {
  // Get the locale from cookies
  const localeCookie = req.cookies.get("locale");
  const urlObj = new URL(req.url);
  const requestLocale = urlObj.searchParams.get("locale");
  // url 中的 ?locale= 优先，然后是 cookie 中的
  const locale =
    requestLocale === "zh-CN" || requestLocale === "en-US"
      ? (requestLocale as Locale)
      : localeCookie?.value === "zh-CN" || localeCookie?.value === "en-US"
        ? (localeCookie?.value as Locale)
        : undefined;
  // Create a response object from the request
  const response = NextResponse.next();
  // Set the locale in a header to be accessible in server components
  if (locale) {
    response.headers.set("x-locale", locale);
  }
  if (locale && !localeCookie) {
    // 只有当前 cookie 没设置过才设置，否则会导致 cookie 一直更新，useTranslation 结果也一直更新，某些页面就会反复刷新
    response.cookies.set("locale", locale, {
      httpOnly: false, // 允许前端 JavaScript 访问
      expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 365 天后过期
      sameSite: "lax", // 安全性设置
      secure: process.env.NODE_ENV === "production", // 生产环境使用 HTTPS
    });
  }
  return { response, locale };
}

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.endsWith(".ping")) {
    return await handlePingRequest(req);
  }

  const {
    response,
    // locale,
  } = handleLocale(req);

  // Set security headers dynamically at runtime
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set(
    "Content-Security-Policy",
    `frame-ancestors ${process.env.IFRAME_ALLOWED_ORIGINS || "'self'"}`,
  );

  return response;
}
