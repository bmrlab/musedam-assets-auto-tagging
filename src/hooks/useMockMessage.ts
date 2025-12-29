import { mockRestoreLiveTranslation, mockStartLiveTranslation } from "@/embed/mockMessage";
import { useEffect } from "react";

/**
 * Type definition for mock LiveTranslation functions exposed on window
 */
interface MockLiveTranslation {
  start: typeof mockStartLiveTranslation;
  restore: typeof mockRestoreLiveTranslation;
}

/**
 * Extended Window interface to include mock functions
 */
declare global {
  interface Window {
    __mockLiveTranslation?: MockLiveTranslation;
  }
}

/**
 * Hook to expose mock LiveTranslation functions to window object in development mode
 * This allows easy access to mock functions in browser console for testing
 */
export function useMockLiveTranslation() {
  useEffect(() => {
    if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
      // Expose mock functions to window for easy access in browser console
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
        // Cleanup on unmount
        delete window.__mockLiveTranslation;
      };
    }
  }, []);
}
