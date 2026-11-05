import "server-only";

import type { MediaProcessRequestMode } from "./object-detection";

export function getDetectionDebugRequestMode(): MediaProcessRequestMode {
  return process.env.DETECTION_DEBUG_SYNC?.trim().toLowerCase() === "true" ? "sync" : "async";
}
