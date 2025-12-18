import { registerLiveTranslationCallbacks, sendPostMessageToParent } from "@/embed/message";
import { locales, type Locale } from "@/i18n/routing";

/**
 * Message types sent from parent window to iframe
 */
export type LiveTranslationIncomingMessage =
  | {
      type: "START_LIVE_TRANSLATION";
      payload: { targetLang: Locale };
    }
  | {
      type: "STOP_LIVE_TRANSLATION";
      payload: Record<string, never>;
    }
  | {
      type: "RESTORE_LIVE_TRANSLATION";
      payload: Record<string, never>;
    };

/**
 * Message types sent from iframe to parent window
 */
export type LiveTranslationOutgoingMessage =
  | {
      type: "LIVE_TRANSLATION_READY";
      payload: { supportedLangs: readonly Locale[] };
    }
  | {
      type: "LIVE_TRANSLATION_INITIALIZED";
      payload: Record<string, never>;
    }
  | {
      type: "LIVE_TRANSLATION_STARTED";
      payload: { targetLang: Locale; success: true };
    }
  | {
      type: "LIVE_TRANSLATION_STOPPED";
      payload: { success: true };
    }
  | {
      type: "LIVE_TRANSLATION_ERROR";
      payload: { error: string; success: false };
    };

/**
 * Helper function to send postMessage to parent window
 * Uses shared postMessage utility from embed/message.ts
 */
export function sendLiveTranslationMessage(
  type: LiveTranslationOutgoingMessage["type"],
  payload: LiveTranslationOutgoingMessage["payload"],
): void {
  sendPostMessageToParent({ type, payload });
}

/**
 * Callback type for handling start translation
 */
export type OnStartTranslationCallback = (targetLang: Locale) => void;

/**
 * Callback type for handling stop/restore translation
 */
export type OnStopTranslationCallback = () => void;

/**
 * Options for initializing live translation message listener
 */
export interface LiveTranslationMessageOptions {
  onStartTranslation: OnStartTranslationCallback;
  onStopTranslation: OnStopTranslationCallback;
  onRestoreTranslation: OnStopTranslationCallback;
}

/**
 * Initialize message listener for live translation commands from parent window
 * Uses shared message listener from embed/message.ts
 * Returns cleanup function to unregister callbacks
 *
 * Note: Locale validation is handled automatically in embed/message.ts
 */
export function initializeLiveTranslationListener(
  options: LiveTranslationMessageOptions,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  // Register callbacks directly with shared message listener
  // Validation is handled in embed/message.ts
  return registerLiveTranslationCallbacks({
    onStartTranslation: options.onStartTranslation,
    onStopTranslation: options.onStopTranslation,
    onRestoreTranslation: options.onRestoreTranslation,
  });
}

/**
 * Send ready message to parent window with supported languages
 */
export function notifyLiveTranslationReady(): void {
  sendLiveTranslationMessage("LIVE_TRANSLATION_READY", {
    supportedLangs: locales,
  });
}

/**
 * Send initialized message to parent window when page refreshes and live translation gets cleared
 */
export function notifyLiveTranslationInitialized(): void {
  sendLiveTranslationMessage("LIVE_TRANSLATION_INITIALIZED", {});
}

/**
 * Send acknowledgment when translation starts successfully
 */
export function notifyLiveTranslationStarted(targetLang: Locale): void {
  sendLiveTranslationMessage("LIVE_TRANSLATION_STARTED", {
    targetLang,
    success: true,
  });
}

/**
 * Send acknowledgment when translation stops/restores
 */
export function notifyLiveTranslationStopped(): void {
  sendLiveTranslationMessage("LIVE_TRANSLATION_STOPPED", {
    success: true,
  });
}

/**
 * Send error message to parent window
 */
export function notifyLiveTranslationError(error: string | Error): void {
  const errorMessage = error instanceof Error ? error.message : error;
  sendLiveTranslationMessage("LIVE_TRANSLATION_ERROR", {
    error: errorMessage,
    success: false,
  });
}

/**
 * Expose mock functions to window for testing
 * This allows testing postMessage functionality from the browser console
 */
export function setupLiveTranslationMock(): void {
  if (typeof window === "undefined") {
    return;
  }

  // Only setup mocks in development
  if (process.env.NODE_ENV === "production") {
    return;
  }

  // @ts-expect-error - Adding mock functions to window for testing
  window.__mockLiveTranslation = {
    start: (targetLang: Locale) => {
      const mockEvent = {
        data: {
          type: "START_LIVE_TRANSLATION",
          payload: { targetLang },
        },
        origin: window.location.origin,
      };
      window.dispatchEvent(new MessageEvent("message", mockEvent as MessageEventInit));
    },
    stop: () => {
      const mockEvent = {
        data: {
          type: "STOP_LIVE_TRANSLATION",
          payload: {},
        },
        origin: window.location.origin,
      };
      window.dispatchEvent(new MessageEvent("message", mockEvent as MessageEventInit));
    },
    restore: () => {
      const mockEvent = {
        data: {
          type: "RESTORE_LIVE_TRANSLATION",
          payload: {},
        },
        origin: window.location.origin,
      };
      window.dispatchEvent(new MessageEvent("message", mockEvent as MessageEventInit));
    },
    supportedLangs: locales,
  };

  // Log instructions to console
  // console.log(
  // 	"%c[Live Translation Mock]",
  // 	"color: #4CAF50; font-weight: bold; font-size: 14px",
  // );
  // console.log(
  // 	"Mock functions available. Use the following commands in console:",
  // );
  // console.log(
  // 	"  window.__mockLiveTranslation.start('en-US')  // Start translation to English",
  // );
  // console.log(
  // 	"  window.__mockLiveTranslation.start('zh-CN')  // Start translation to Chinese",
  // );
  // console.log("  window.__mockLiveTranslation.stop()  // Stop translation");
  // console.log(
  // 	"  window.__mockLiveTranslation.restore()  // Restore original texts",
  // );
  // console.log(
  // 	"  window.__mockLiveTranslation.supportedLangs  // View supported languages",
  // );
}
