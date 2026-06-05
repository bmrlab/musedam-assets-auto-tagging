import { isValidLocale } from "@/i18n/routing";
import {
  FEATURE_LIBRARY_COOKIE,
  FEATURE_LIBRARY_PARAM,
  featureLibraryEnabledToValue,
  isFeatureLibraryValue,
  resolveFeatureLibraryEnabled,
} from "@/lib/feature-library";
import { getRequestClientIp, getRequestOrigin } from "@/lib/request/headers";
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

function handleLocale(req: NextRequest, response: NextResponse) {
  // Get the locale from cookies
  const localeCookie = req.cookies.get("locale");
  const urlObj = new URL(req.url);
  const requestLocale = urlObj.searchParams.get("locale");
  // url 中的 ?locale= 优先，然后是 cookie 中的
  const locale =
    requestLocale && isValidLocale(requestLocale)
      ? requestLocale
      : localeCookie?.value && isValidLocale(localeCookie.value)
        ? localeCookie.value
        : undefined;
  // Set the locale in a header to be accessible in server components
  if (locale) {
    response.headers.set("x-locale", locale);
  }
  if (locale && (!localeCookie?.value || localeCookie.value !== locale)) {
    // 只有当前 cookie 没设置过才设置，否则会导致 cookie 一直更新，useTranslation 结果也一直更新，某些页面就会反复刷新
    // 在 iframe 环境下必须使用 sameSite: "none" 和 secure: true 才能设置第三方 cookie
    response.cookies.set("locale", locale, {
      httpOnly: false, // 允许前端 JavaScript 访问
      expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 365 天后过期
      sameSite: "none", // iframe 环境需要 "none"
      secure: true, // sameSite: "none" 必须配合 secure: true
    });
  }
  return locale;
}

function handleFeatureLibrary(req: NextRequest, response: NextResponse) {
  const featureLibraryCookie = req.cookies.get(FEATURE_LIBRARY_COOKIE);
  const requestFeatureLibrary = req.nextUrl.searchParams.get(FEATURE_LIBRARY_PARAM);
  const featureLibraryEnabled = resolveFeatureLibraryEnabled(
    requestFeatureLibrary,
    featureLibraryCookie?.value,
  );
  const featureLibraryValue = featureLibraryEnabledToValue(featureLibraryEnabled);

  response.headers.set("x-feature-library", featureLibraryValue);

  if (
    isFeatureLibraryValue(requestFeatureLibrary) &&
    featureLibraryCookie?.value !== requestFeatureLibrary
  ) {
    response.cookies.set(FEATURE_LIBRARY_COOKIE, requestFeatureLibrary, {
      httpOnly: false,
      expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      sameSite: "none",
      secure: true,
    });
  }

  return featureLibraryEnabled;
}

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.endsWith(".ping")) {
    return await handlePingRequest(req);
  }

  const requestFeatureLibrary = req.nextUrl.searchParams.get(FEATURE_LIBRARY_PARAM);

  const response = NextResponse.next();

  handleLocale(req, response);
  handleFeatureLibrary(req, response);

  // Set security headers dynamically at runtime
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set(
    "Content-Security-Policy",
    `frame-ancestors ${process.env.IFRAME_ALLOWED_ORIGINS || "'self'"}`,
  );

  return response;
}
