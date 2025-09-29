/* eslint-disable @typescript-eslint/no-explicit-any */

import { TagRecord } from "@/app/tags/types";
import { MuseDAMID } from "@/musedam/types";
import Cookies from "js-cookie";

// 定义全局类型
const globalForMessage = global as unknown as {
  musedamMessageQueue:
    | Map<string, { resolve: (result: any) => void; reject: (error: any) => void }>
    | undefined;
};

// 创建或获取全局队列
function getPendingPromises() {
  if (!globalForMessage.musedamMessageQueue) {
    globalForMessage.musedamMessageQueue = new Map();
    // 第一次创建时初始化监听器
    initializeMessageListener();
  }
  return globalForMessage.musedamMessageQueue;
}

// 生成唯一的 dispatch ID
function generateDispatchId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `dispatch_${timestamp}_${random}`;
}

// 初始化全局消息监听器
function initializeMessageListener() {
  // 检查是否在浏览器环境
  if (typeof window === "undefined") {
    console.warn("Cannot initialize message listener: not in browser environment");
    return;
  }

  window.addEventListener("message", (event) => {
    // 验证消息来源和格式
    if (!event.data || typeof event.data !== "object") {
      return;
    }

    const message = event.data;

    // 检查是否是来自 musedam 的 action_result 响应
    if (
      message.source === "musedam" &&
      message.target === "musedam-app" &&
      message.type === "action_result" &&
      message.dispatchId
    ) {
      const pendingPromises = getPendingPromises();
      // 从队列中找到对应的 promise
      const pendingPromise = pendingPromises.get(message.dispatchId);
      if (pendingPromise) {
        // 移除已处理的 promise
        pendingPromises.delete(message.dispatchId);
        // 根据响应结果 resolve 或 reject
        if (!message.result || !message.result.success) {
          // 如果 result.success === false，一定有 result.code
          if (message.result.code === "cancelled") {
            // 当用户取消操作时，不抛出异常，resolve undefined
            pendingPromise.resolve(undefined as any);
          } else {
            pendingPromise.reject(new Error(message.result?.message ?? "Unknown error"));
          }
        } else {
          // 如果 result.success === true，一定有 result.data
          pendingPromise.resolve(message.result.data);
        }
      }
    }

    // 处理来自父项目的配置更新事件或查询事件
    if (
      message.source === "musedam" &&
      message.target === "musedam-app" &&
      message.type === "action" &&
      message.action
    ) {
      handleParentConfigUpdate(message.action, message.args);
      // 支持异步返回结果的查询类 action
      // if (message.action === "checkUserPermission") {
      //   handleCheckUserPermission(message.dispatchId);
      // } else {
      //   handleParentConfigUpdate(message.action, message.args);
      // }
    }
  });
}

// 确保在浏览器环境下，模块加载即初始化监听器，避免父窗口过早发消息被丢失
if (typeof window !== "undefined") {
  // 该调用会在首次运行时创建全局队列并注册一次 message 监听器
  getPendingPromises();

  // 通知父窗口：应用加载完成
  // const notifyParentAppLoaded = () => {
  //   try {
  //     const message = {
  //       source: "musedam-app",
  //       target: "musedam",
  //       type: "event",
  //       event: "loaded",
  //       timestamp: new Date().toISOString(),
  //     } as const;
  //     window.parent?.postMessage(message, "*");
  //   } catch {}
  // };

  // if (document?.readyState === "complete" || document?.readyState === "interactive") {
  //   // 文档已就绪，异步触发一次
  //   setTimeout(notifyParentAppLoaded, 0);
  // } else {
  //   // 等待 DOMContentLoaded 再通知
  //   window.addEventListener("DOMContentLoaded", notifyParentAppLoaded, { once: true } as any);
  // }
}

// 处理来自父项目的配置更新事件
function handleParentConfigUpdate(action: string, args: any) {
  switch (action) {
    case "updateLocale":
      if (args?.locale && typeof window !== "undefined") {
        // 更新语言设置
        const validLocales = ["zh-CN", "en-US"];
        if (validLocales.includes(args.locale)) {
          // 同时尝试设置 cookie（第三方 iframe 需 SameSite=None; Secure，可能仍受浏览器策略限制）
          if (typeof document !== "undefined") {
            try {
              Cookies.set("locale", args.locale, {
                expires: 365,
                sameSite: "None" as any,
                secure: true,
              });
            } catch {}
          }
          // 通过 URL 参数传递 locale，服务端中间件会读取 ?locale= 并下发 x-locale
          try {
            const url = new URL(window.location.href);
            url.searchParams.set("locale", args.locale);
            // 使用 replace 避免产生历史记录，确保刷新后生效
            window.location.replace(url.toString());
          } catch {
            // 回退：如果 URL API 不可用，执行完整刷新
            window.location.reload();
          }
        }
      }
      break;

    case "updateTheme":
      if (args?.theme && typeof window !== "undefined") {
        // 更新主题设置
        const validThemes = ["light", "dark"];
        if (validThemes.includes(args.theme)) {
          // 更新 localStorage
          localStorage.setItem("theme", args.theme);
          // 触发主题更新
          const event = new CustomEvent("theme-change", { detail: { theme: args.theme } });
          window.dispatchEvent(event);
        }
      }
      break;

    default:
      // 忽略未知的 action
      break;
  }
}

// 处理权限检查请求：从父项目请求检查当前登录用户权限
// async function handleCheckUserPermission(dispatchId?: string) {
//   if (typeof window === "undefined") return;
//   try {
//     const res = await fetch("/api/auth/check-permission", { credentials: "include" });
//     const message = {
//       source: "musedam-app",
//       target: "musedam",
//       type: "action_result",
//       dispatchId,
//       action: "checkPermission",
//       result: res.ok,
//     } as const;
//     window.parent?.postMessage(message, "*");
//   } catch (error: unknown) {
//     const message = {
//       source: "musedam-app",
//       target: "musedam",
//       type: "action_result",
//       action: "checkPermission",
//       dispatchId,
//       result: false,
//     } as const;
//     window.parent?.postMessage(message, "*");
//   }
// }

type BaseActionResult<T = Record<string, never>> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      message: string;
      code?: string;
    };

type ActionMap = {
  "member-selector-modal-open": {
    args: Record<string, never>;
    result: BaseActionResult<{
      members: { id: MuseDAMID; name: string }[];
      departments: { id: MuseDAMID; name: string }[];
      groups: { id: MuseDAMID; name: string }[];
    }>;
  };
  "folder-selector-modal-open": {
    args: {
      initialSelectedFolders?: Array<{ id: number; name: string }>;
      allMaterials?: boolean;
    };
    result: BaseActionResult<{
      selectedFolders: Array<{ id: number; name: string }>;
      allMaterials: boolean;
    }>;
  };
  "assets-selector-modal-open": {
    args: Record<string, never>;
    result: BaseActionResult<{
      selectedAssets: Array<{
        id: number; // 素材唯一标识
        name: string; // 素材名称
        extension: string; // 文件扩展名
        size: number; // 文件大小（字节）
        url?: string; // 素材访问链接
        thumbnail?: {url?:string}; // 缩略图链接
        width?: number; // 图片宽度（图片类型）
        height?: number; // 图片高度（图片类型）
        type?: string; // 素材类型
        folderId?: MuseDAMID; // 所在文件夹ID
        folderName?: string; // 所在文件夹名称
      }>;
    }>;
  };
  goto: {
    args: {
      url: string;
      target?:"_blank" | "_self";
    };
    result: BaseActionResult<never>;
  };
  // "refetch-tags-tree": {
  //   args: {};
  //   result: BaseActionResult<never>;
  // };
  "get-smart-tags-list": {
    args: {
      pageNum: number;
      pageSize: number;
    };
    result: BaseActionResult<{
      tags: TagRecord[];
      total: number;
      isLoading: boolean;
      current: number;
      pageSize: number;
    }>;
  };
  "delete-smart-tag": {
    args: {
      tag: TagRecord;
    };
    result: BaseActionResult<{ tagId: number }>;
  };
  "rename-smart-tag": {
    args: {
      tagId: number;
      newName: string;
    };
    result: BaseActionResult<{ tagId: number; newName: string }>;
  };
  syncPath: {
    args: {
      path: string;
    };
    result: BaseActionResult<never>;
  };
};

type ExtractSuccessData<T> = T extends { success: true; data: infer U } ? U : never;

/**
 * 向 MuseDAM 父窗口发起 action 请求
 * @param action - 要调用的方法名称
 * @param args - 传递给方法的参数
 * @returns Promise - 返回方法执行结果的 Promise
 */
export function dispatchMuseDAMClientAction<T extends keyof ActionMap>(
  action: T,
  args: ActionMap[T]["args"] = {},
): Promise<ExtractSuccessData<ActionMap[T]["result"]>> {
  // 检查是否在浏览器环境
  if (typeof window === "undefined") {
    return Promise.reject(
      new Error("dispatchMuseDAMClientAction can only be used in browser environment"),
    );
  }

  // 检查是否有父窗口
  if (!window.parent || window.parent === window) {
    return Promise.reject(new Error("No parent window available for communication"));
  }

  // 获取全局队列（会自动初始化监听器）
  const pendingPromises = getPendingPromises();

  // 生成唯一的 dispatch ID
  const dispatchId = generateDispatchId();

  // 创建 Promise 并添加到队列
  const promise = new Promise<ExtractSuccessData<ActionMap[T]["result"]>>((resolve, reject) => {
    pendingPromises.set(dispatchId, { resolve, reject });
  });

  // 构建请求消息
  const message = {
    source: "musedam-app",
    target: "musedam",
    type: "action",
    timestamp: new Date().toISOString(),
    dispatchId,
    action,
    args,
  };

  // 发送消息到父窗口
  window.parent.postMessage(message, "*");

  // // 设置超时处理（可选，防止 promise 永远不 resolve）
  // // 暂时不需要，因为这都是用户交互，可能打开一个文件夹选项框选择了10分钟，其实也没问题
  // const timeout = setTimeout(() => {
  //   const pendingPromise = pendingPromises.get(dispatchId);
  //   if (pendingPromise) {
  //     pendingPromises.delete(dispatchId);
  //     pendingPromise.reject(new Error(`Request timeout for action: ${action}`));
  //   }
  // }, 30000); // 30秒超时
  // // 在 promise resolve/reject 时清除超时
  // promise.finally(() => {
  //   clearTimeout(timeout);
  // });

  return promise;
}

/**
 * 获取当前待处理的请求数量（用于调试）
 */
export function getPendingRequestsCount(): number {
  return getPendingPromises().size;
}

/**
 * 清除所有待处理的请求（用于清理）
 */
export function clearPendingRequests(): void {
  const pendingPromises = getPendingPromises();
  pendingPromises.forEach(({ reject }) => {
    reject(new Error("Request cleared"));
  });
  pendingPromises.clear();
}
