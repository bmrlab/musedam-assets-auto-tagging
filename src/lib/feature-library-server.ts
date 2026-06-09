import "server-only";

import {
  FEATURE_LIBRARY_COOKIE,
  FEATURE_LIBRARY_PARAM,
  resolveFeatureLibraryEnabled,
} from "@/lib/feature-library";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

export async function getServerFeatureLibraryEnabled() {
  const cookieStore = await cookies();
  return resolveFeatureLibraryEnabled(undefined, cookieStore.get(FEATURE_LIBRARY_COOKIE)?.value);
}

export function getFeatureLibraryEnabledFromRequest(
  request: NextRequest,
  explicitValue?: string | null,
) {
  return resolveFeatureLibraryEnabled(
    explicitValue ?? request.nextUrl.searchParams.get(FEATURE_LIBRARY_PARAM),
    request.cookies.get(FEATURE_LIBRARY_COOKIE)?.value,
  );
}
