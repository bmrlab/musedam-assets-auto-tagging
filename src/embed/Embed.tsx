"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { dispatchMuseDAMClientAction } from "./message";

export function Embed() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const search = searchParams.toString();
    const pathValue = `#path=${pathname}${search ? `?${search}` : ""}`;
    dispatchMuseDAMClientAction("syncPath", {
      path: pathValue,
    }).catch(() => {});
  }, [pathname, searchParams]);

  return <></>;
}
