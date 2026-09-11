import { isValidLocale } from "@/i18n/routing";
import {
  FEATURE_LIBRARY_TOGGLE_NAMES,
  featureLibraryEnabledToValue,
  isFeatureLibraryValue,
  resolveFeatureLibraryFeatures,
} from "@/lib/feature-library";
import { NextRequest, NextResponse } from "next/server";

const PRODUCTION_ONLY_DISABLED_PATH_PREFIXES = ["/store-inspection", "/tagging/dev"];

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|_public|_pages|favicon.ico|manifest.json|sitemap.xml|robots.txt|llm.txt).*)",
  ],
};

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
  if (
    process.env.NODE_ENV === "production" &&
    process.env.DEBUG_PAGE !== "true" &&
    PRODUCTION_ONLY_DISABLED_PATH_PREFIXES.some((path) => req.nextUrl.pathname.startsWith(path))
  ) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const response = NextResponse.next();

  handleLocale(req, response);
  handleFeatureLibrary(req, response);

  // CSP frame-ancestors is the source of truth for MuseDAM's cross-origin
  // iframe embedding. X-Frame-Options: SAMEORIGIN would block that use case.
  response.headers.set(
    "Content-Security-Policy",
    `frame-ancestors ${process.env.IFRAME_ALLOWED_ORIGINS || "'self'"}`,
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return response;
}
