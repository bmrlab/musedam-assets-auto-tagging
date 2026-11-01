"use client";

import { dispatchMuseDAMClientAction } from "@/embed/message";
import { useEffect, useState } from "react";

const RETRY_DELAYS_MS = [0, 400, 1200, 3000];

export type AutoTaggingAccessRole = "admin" | "content" | "other";

export type AutoTaggingAccess = {
  role: AutoTaggingAccessRole;
  canManageConfig: boolean;
  contentRoleCanManage: boolean;
  /** 主站尚未返回时为 true；期间不展示「配置」，避免内容管理员先闪出入口 */
  loading: boolean;
};

const DEFAULT_ACCESS: AutoTaggingAccess = {
  role: "other",
  canManageConfig: false,
  contentRoleCanManage: false,
  loading: true,
};

/**
 * 主站按 DAM_MATERIAL_EXTENSION_AI_AUTO_MARKING 判定。
 * 未取到、加载中或失败时：不展示配置入口；内容管理员行按「可审核」展示。
 */
export function useAutoTaggingAccess(): AutoTaggingAccess {
  const [access, setAccess] = useState<AutoTaggingAccess>(DEFAULT_ACCESS);

  useEffect(() => {
    let active = true;
    const timers: number[] = [];

    let requestId = 0;
    const refresh = async () => {
      const id = ++requestId;
      try {
        const result = await Promise.race([
          dispatchMuseDAMClientAction("get-auto-tagging-access", {}),
          new Promise<never>((_, reject) => {
            window.setTimeout(() => reject(new Error("timeout")), 2000);
          }),
        ]);
        if (active && id === requestId) {
          setAccess({
            role: result?.role ?? "other",
            canManageConfig: result?.canManageConfig === true,
            contentRoleCanManage: result?.contentRoleCanManage === true,
            loading: false,
          });
        }
      } catch {
        if (active && id === requestId) {
          setAccess({
            role: "other",
            canManageConfig: false,
            contentRoleCanManage: false,
            loading: false,
          });
        }
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

  return access;
}
