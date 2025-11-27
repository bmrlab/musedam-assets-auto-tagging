import { loadEnvConfig } from "@next/env";

async function processScheduledTagging() {
  // load env config from .env file
  loadEnvConfig(process.cwd());

  const internalApiKey = process.env.INTERNAL_API_KEY;

  if (!internalApiKey) {
    console.error("❌ INTERNAL_API_KEY not configured in environment");
    return false;
  }

  const apiUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3002";
  const endpoint = `${apiUrl}/api/tagging/process-scheduled`;

  try {
    console.log(`🕐 ${new Date().toISOString()} - Starting scheduled tagging task...`);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${internalApiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(`❌ Scheduled tagging failed: ${response.status} ${response.statusText}`);
      const errorBody = await response.text();
      console.error(errorBody);
      return false;
    }

    const result = await response.json();
    if (result.success) {
      console.log(`✅ ${new Date().toISOString()} - Scheduled tagging completed successfully:`);
      console.log(`   - Total teams found: ${result.totalTeams}`);
      console.log(`   - Teams processed: ${result.processedTeams}`);
      console.log(`   - Successful: ${result.successCount}`);
      console.log(`   - Failed: ${result.errorCount}`);

      if (result.errorCount > 0) {
        console.log("   Errors:");
        result.results.forEach((team: any) => {
          if (!team.success) {
            console.log(`     - ${team.teamName}: ${team.error}`);
          }
        });
      }
    } else {
      console.error(`❌ Scheduled tagging failed: ${result.error}`);
    }

    return result.success;
  } catch (error) {
    console.error(`❌ Error processing scheduled tagging:`, error);
    return false;
  }
}

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
        Authorization: `Bearer ${internalApiKey}`,
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
    console.log(
      `✅ ${new Date().toISOString()} - Queue processing completed: ${result.processing} processing, ${result.skipped} skipped`,
    );
    return true;
  } catch (error) {
    console.error(`❌ ${new Date().toISOString()} - Error processing queue:`, error);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);

  // 如果是只运行定时标签模式
  if (args.includes("--scheduled-only")) {
    console.log("🚀 Running scheduled tagging task immediately...");
    await processScheduledTagging();
    process.exit(0);
  }

  // 默认模式：队列处理 + 定时标签
  console.log(
    "🚀 Starting queue processor - will process queue every 10 seconds and scheduled tagging daily",
  );
  console.log("Press Ctrl+C to stop");

  // Process immediately on startup
  await processQueue();

  // Track if scheduled tagging ran today to avoid duplicate runs
  let scheduledTaggingLastRun = new Date().toDateString();

  // Set up interval to process every 10 seconds
  const interval = setInterval(async () => {
    await processQueue();

    // Check if it's a new day and run scheduled tagging
    const today = new Date().toDateString();
    const now = new Date();

    if (scheduledTaggingLastRun !== today && now.getHours() === 0 && now.getMinutes() < 10) {
      console.log(`🕐 It's a new day! Running scheduled tagging...`);
      await processScheduledTagging();
      scheduledTaggingLastRun = today;
    }
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
