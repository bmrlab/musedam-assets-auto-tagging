"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { dispatchMuseDAMClientAction } from "./message";

export function Embed({ locale }: { locale: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    // _t 是当前 tab 的登录 token，只用于整页刷新，不能同步给父项目（会被存进父页面 hash 并在之后被当成过期 token 带回来）
    const syncParams = new URLSearchParams(searchParams.toString());
    syncParams.delete("_t");
    const search = syncParams.toString();
    // const params = new URLSearchParams(searchParams.toString());
    // params.set('locale', locale);
    // const search = params.toString();
    const pathValue = `#path=${pathname}${search ? `?${search}` : ""}`;
    dispatchMuseDAMClientAction("syncPath", {
      path: pathValue,
    }).catch(() => { });
  }, [pathname, searchParams]);

  return <></>;
}
