import { isValidLocale } from "@/i18n/routing";
import {
  FEATURE_LIBRARY_TOGGLE_NAMES,
  featureLibraryEnabledToValue,
  isFeatureLibraryValue,
  resolveFeatureLibraryFeatures,
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
  const requestValues = Object.fromEntries(
    FEATURE_LIBRARY_TOGGLE_NAMES.map((name) => [name, req.nextUrl.searchParams.get(name)]),
  );
  const cookieValues = Object.fromEntries(
    FEATURE_LIBRARY_TOGGLE_NAMES.map((name) => [name, req.cookies.get(name)?.value]),
  );
  const features = resolveFeatureLibraryFeatures(requestValues, cookieValues);

  for (const name of FEATURE_LIBRARY_TOGGLE_NAMES) {
    response.headers.set(
      `x-${name.replace(/([A-Z])/g, "-$1").toLowerCase()}`,
      featureLibraryEnabledToValue(features[name]),
    );

    const requestValue = requestValues[name];
    if (isFeatureLibraryValue(requestValue) && cookieValues[name] !== requestValue) {
      response.cookies.set(name, requestValue, {
        httpOnly: false,
        expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        sameSite: "none",
        secure: true,
      });
    }
  }

  return features;
}

export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.endsWith(".ping")) {
    return await handlePingRequest(req);
  }

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
