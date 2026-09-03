const DEFAULT_APP_INTERNAL_URL = "http://musedam-auto-tagging-web:3000";
const DEFAULT_QUEUE_INTERVAL_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15 * 60_000;

function getPositiveNumberEnv(name, fallback) {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return value;
}

function getRequiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

const internalApiKey = getRequiredEnv("INTERNAL_API_KEY");
const appInternalUrl = (process.env.APP_INTERNAL_URL || DEFAULT_APP_INTERNAL_URL).replace(
  /\/$/,
  "",
);
const queueIntervalMs = getPositiveNumberEnv("QUEUE_POLL_INTERVAL_MS", DEFAULT_QUEUE_INTERVAL_MS);
const requestTimeoutMs = getPositiveNumberEnv(
  "SCHEDULER_REQUEST_TIMEOUT_MS",
  DEFAULT_REQUEST_TIMEOUT_MS,
);

let stopping = false;

function log(level, message, fields = {}) {
  console.log(
    JSON.stringify({
      level,
      time: new Date().toISOString(),
      service: "queue-scheduler",
      message,
      ...fields,
    }),
  );
}

async function invoke(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(`${appInternalUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${internalApiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 1000)}`);
    }

    log("info", "Internal task completed", { path, response: responseText.slice(0, 1000) });
  } finally {
    clearTimeout(timeout);
  }
}

async function runQueueLoop() {
  log("info", "Queue scheduler started", { appInternalUrl, queueIntervalMs });

  while (!stopping) {
    try {
      await invoke("/api/tagging/process-queue");
    } catch (error) {
      log("error", "Queue processing request failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (!stopping) {
      await new Promise((resolve) => setTimeout(resolve, queueIntervalMs));
    }
  }
}

function handleShutdown(signal) {
  log("info", "Shutdown requested", { signal });
  stopping = true;
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

if (process.argv.includes("--scheduled-only")) {
  try {
    await invoke("/api/tagging/process-scheduled");
  } catch (error) {
    log("error", "Scheduled tagging request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  }
} else {
  await runQueueLoop();
}
