import { mockRestoreLiveTranslation, mockStartLiveTranslation } from "@/embed/mockMessage";
import { type Locale } from "@/i18n/routing";
import { useEffect } from "react";

/**
 * 定义暴露在 window 对象上的Mock LiveTranslation 函数的类型
 */
interface MockLiveTranslation {
  start: (targetLanguage: Locale) => void;
  restore: () => void;
}

/**
 * 扩展 Window 接口以包含 mock LiveTranslation 属性
 */
declare global {
  interface Window {
    __mockLiveTranslation?: MockLiveTranslation;
  }
}

/**
 * Hook：在开发模式下将Mock LiveTranslation 函数暴露到 window 对象
 * 这允许在浏览器控制台中轻松访问Mock函数以进行测试
 */
export function useMockLiveTranslation() {
  useEffect(() => {
    if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
      // 将Mock函数暴露到 window 对象，方便在浏览器控制台访问
      window.__mockLiveTranslation = {
        start: mockStartLiveTranslation,
        restore: mockRestoreLiveTranslation,
      };
      console.log(
        "[DEV] LiveTranslation mocks exposed at window.__mockLiveTranslation",
        "\nUsage:",
        "\n  window.__mockLiveTranslation.start('zh-CN')",
        "\n  window.__mockLiveTranslation.restore()",
      );

      return () => {
        // 组件卸载时清理
        delete window.__mockLiveTranslation;
      };
    }
  }, []);
}
