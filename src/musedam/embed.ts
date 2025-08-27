/* eslint-disable @typescript-eslint/no-explicit-any */

// 全局队列，存储待处理的 promise
const pendingPromises = new Map<
  string,
  {
    resolve: (result: any) => void;
    reject: (error: any) => void;
  }
>();

// 全局监听器标记，确保只有一个监听器
let isListenerInitialized = false;

// 生成唯一的 dispatch ID
function generateDispatchId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `dispatch_${timestamp}_${random}`;
}

// 初始化全局消息监听器
function initializeMessageListener() {
  if (isListenerInitialized) {
    return;
  }

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
      // 从队列中找到对应的 promise
      const pendingPromise = pendingPromises.get(message.dispatchId);

      if (pendingPromise) {
        // 移除已处理的 promise
        pendingPromises.delete(message.dispatchId);

        // 根据响应结果 resolve 或 reject
        if (message.error) {
          pendingPromise.reject(new Error(message.error));
        } else {
          pendingPromise.resolve(message.result);
        }
      }
    }
  });

  isListenerInitialized = true;
}

/**
 * 向 MuseDAM 父窗口发起 action 请求
 * @param action - 要调用的方法名称
 * @param args - 传递给方法的参数
 * @returns Promise<any> - 返回方法执行结果的 Promise
 */
export function dispatchMuseDAMClientAction(action: string, args: any = {}): Promise<any> {
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
  // 确保全局监听器已初始化
  initializeMessageListener();

  // 生成唯一的 dispatch ID
  const dispatchId = generateDispatchId();

  // 创建 Promise 并添加到队列
  const promise = new Promise((resolve, reject) => {
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

  // 设置超时处理（可选，防止 promise 永远不 resolve）
  const timeout = setTimeout(() => {
    const pendingPromise = pendingPromises.get(dispatchId);
    if (pendingPromise) {
      pendingPromises.delete(dispatchId);
      pendingPromise.reject(new Error(`Request timeout for action: ${action}`));
    }
  }, 30000); // 30秒超时

  // 在 promise resolve/reject 时清除超时
  promise.finally(() => {
    clearTimeout(timeout);
  });

  return promise;
}

/**
 * 获取当前待处理的请求数量（用于调试）
 */
export function getPendingRequestsCount(): number {
  return pendingPromises.size;
}

/**
 * 清除所有待处理的请求（用于清理）
 */
export function clearPendingRequests(): void {
  pendingPromises.forEach(({ reject }) => {
    reject(new Error("Request cleared"));
  });
  pendingPromises.clear();
}
