"use server";
import { headers } from "next/headers";

export async function getRequestOrigin(): Promise<string> {
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") || headersList.get("host");
  const protocol = headersList.get("x-forwarded-proto");
  if (!host || !protocol) {
    throw new Error("Missing required headers");
  }
  return `${protocol}://${host}`;
}

export async function getRequestClientIp(): Promise<string> {
  const headersList = await headers();
  const forwardedIp = headersList.get("x-forwarded-for");
  const realIp = headersList.get("x-real-ip");
  if (!forwardedIp && !realIp) {
    throw new Error("Missing required headers");
  }
  // If x-forwarded-for exists, it might contain multiple IPs separated by commas
  // The leftmost IP is typically the original client IP
  if (forwardedIp) {
    return forwardedIp.split(",")[0].trim();
  }
  return realIp as string;
}

export async function getRequestUserAgent(): Promise<string | null> {
  const headersList = await headers();
  return headersList.get("user-agent") || null;
}

export async function getRequestGeo(): Promise<Partial<{
  country: string;
  countryCode: string;
  city: string;
}> | null> {
  const headersList = await headers();
  const country = headersList.get("x-country");
  const countryCode = headersList.get("x-country-code");
  const city = headersList.get("x-city");
  if (!country && !countryCode && !city) {
    return null;
  }
  return {
    ...(country ? { country } : {}),
    ...(countryCode ? { countryCode } : {}),
    ...(city ? { city } : {}),
  };
}
