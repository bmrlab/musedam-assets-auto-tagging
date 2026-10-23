"use client";

import { dispatchMuseDAMClientAction } from "@/embed/message";
import { useEffect, useState } from "react";

const RETRY_DELAYS_MS = [0, 400, 1200, 3000];

/** 主站按 DAM_MATERIAL_ADMIN_MANAGEMENT_TAG 判定。未取到、加载中或失败时只读。 */
export function useTagManagementPermission() {
  const [canManageTags, setCanManageTags] = useState(false);

  useEffect(() => {
    let active = true;
    const timers: number[] = [];

    let requestId = 0;
    const refresh = async () => {
      const id = ++requestId;
      try {
        const result = await Promise.race([
          dispatchMuseDAMClientAction("get-tag-management-permission", {}),
          new Promise<never>((_, reject) => {
            window.setTimeout(() => reject(new Error("timeout")), 2000);
          }),
        ]);
        if (active && id === requestId) setCanManageTags(result?.canManageTags === true);
      } catch {
        if (active && id === requestId) setCanManageTags(false);
      }
    };

    RETRY_DELAYS_MS.forEach((delay) => {
      timers.push(window.setTimeout(() => void refresh(), delay));
    });

    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      active = false;
      timers.forEach((id) => window.clearTimeout(id));
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  return canManageTags;
}
