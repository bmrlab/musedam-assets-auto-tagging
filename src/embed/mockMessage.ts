/**
 * Mock functions for simulating post messages from parent window
 * These are only used in development for testing purposes
 */

import { isValidLocale, type Locale } from "@/i18n/routing";

/**
 * Generate a mock dispatch ID for testing
 */
function generateMockDispatchId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `mock_dispatch_${timestamp}_${random}`;
}

/**
 * Mock receiving a "startLiveTranslation" post message from parent window
 * @param targetLanguage - The target language locale to translate to
 */
export function mockStartLiveTranslation(targetLanguage: Locale): void {
  if (typeof window === "undefined") {
    console.warn("mockStartLiveTranslation can only be used in browser environment");
    return;
  }

  if (!isValidLocale(targetLanguage)) {
    console.error(`Invalid locale: ${targetLanguage}`);
    return;
  }

  const dispatchId = generateMockDispatchId();

  // Simulate the message that would be sent from parent window
  const mockMessage = {
    source: "musedam",
    target: "musedam-app",
    type: "action",
    action: "startLiveTranslation",
    args: {
      targetLanguage,
    },
    dispatchId,
    timestamp: new Date().toISOString(),
  };

  // Dispatch the message event to simulate receiving it from parent window
  window.dispatchEvent(
    new MessageEvent("message", {
      data: mockMessage,
      origin: window.location.origin,
    }),
  );

  console.log(`[MOCK] Simulated startLiveTranslation with targetLanguage: ${targetLanguage}`);
}

/**
 * Mock receiving a "restoreLiveTranslation" post message from parent window
 */
export function mockRestoreLiveTranslation(): void {
  if (typeof window === "undefined") {
    console.warn("mockRestoreLiveTranslation can only be used in browser environment");
    return;
  }

  const dispatchId = generateMockDispatchId();

  // Simulate the message that would be sent from parent window
  const mockMessage = {
    source: "musedam",
    target: "musedam-app",
    type: "action",
    action: "restoreLiveTranslation",
    args: {},
    dispatchId,
    timestamp: new Date().toISOString(),
  };

  // Dispatch the message event to simulate receiving it from parent window
  window.dispatchEvent(
    new MessageEvent("message", {
      data: mockMessage,
      origin: window.location.origin,
    }),
  );

  console.log("[MOCK] Simulated restoreLiveTranslation");
}
