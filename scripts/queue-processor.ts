import { loadEnvConfig } from "@next/env";

async function processQueue() {
  // load env config from .env file
  loadEnvConfig(process.cwd());

  const internalApiKey = process.env.INTERNAL_API_KEY;
  
  if (!internalApiKey) {
    console.error("❌ INTERNAL_API_KEY not configured in environment");
    process.exit(1);
  }

  const apiUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const endpoint = `${apiUrl}/api/tagging/process-queue`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${internalApiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(`❌ Queue processing failed: ${response.status} ${response.statusText}`);
      const errorBody = await response.text();
      console.error(errorBody);
      return false;
    }

    const result = await response.json();
    console.log(`✅ ${new Date().toISOString()} - Queue processing completed: ${result.processing} processing, ${result.skipped} skipped`);
    return true;
  } catch (error) {
    console.error(`❌ ${new Date().toISOString()} - Error processing queue:`, error);
    return false;
  }
}

async function main() {
  console.log("🚀 Starting queue processor - will process queue every 10 seconds");
  console.log("Press Ctrl+C to stop");

  // Process immediately on startup
  await processQueue();

  // Set up interval to process every 10 seconds
  const interval = setInterval(async () => {
    await processQueue();
  }, 10000); // 10 seconds

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n🛑 Shutting down queue processor...");
    clearInterval(interval);
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n🛑 Shutting down queue processor...");
    clearInterval(interval);
    process.exit(0);
  });
}

if (require.main === module) {
  main();
}