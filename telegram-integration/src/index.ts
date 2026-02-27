import "dotenv/config";
import { createBot, BotAccessConfig } from "./bot";
import { ChatRouterClient } from "./chatRouterClient";
import { ChatRouterWsClient } from "./wsClient";
import fs from "fs";
import path from "path";
import util from "util";

// ----------------------------------------------------------------------------
// File logging setup
// ----------------------------------------------------------------------------

const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });

const logFilePath = path.join(logsDir, "telegram-plugin.log");
const logStream = fs.createWriteStream(logFilePath, { flags: "a" });

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = (...args: any[]) => {
  const timestamp = new Date().toISOString();
  const message = util.format(...args);
  logStream.write(`[${timestamp}] [LOG] ${message}\n`);
  originalConsoleLog(...args);
};

console.error = (...args: any[]) => {
  const timestamp = new Date().toISOString();
  const message = util.format(...args);
  logStream.write(`[${timestamp}] [ERROR] ${message}\n`);
  originalConsoleError(...args);
};

// ----------------------------------------------------------------------------

async function main() {
  const token = process.env.BOT_TOKEN;

  if (!token) {
    console.error("ERROR: BOT_TOKEN environment variable is not set.");
    console.error("Create a .env file with BOT_TOKEN=your_token_here");
    process.exit(1);
  }

  const chatRouterUrl = process.env.CHAT_ROUTER_URL;
  let chatRouter: ChatRouterClient | undefined;

  if (chatRouterUrl) {
    chatRouter = new ChatRouterClient(chatRouterUrl);
    console.log(`Chat router configured: ${chatRouterUrl}`);

    // Startup health check — warn but don't block if the router is unreachable
    try {
      const health = await chatRouter.healthCheck();
      console.log(`Chat router is reachable (ok=${health.ok})`);
      console.log(
        `  Messages     : ${health.messageCount}`,
      );
      console.log(
        `  Conversations: ${health.conversationCount}`,
      );
    } catch (err) {
      console.warn(
        "WARNING: Chat router health check failed — the router may not be running yet.",
      );
      console.warn(`  ${err instanceof Error ? err.message : err}`);
      console.warn("  The bot will start anyway and retry forwarding when messages arrive.\n");
    }
  } else {
    console.log("CHAT_ROUTER_URL not set — running in standalone mode (echo only)");
  }

  // ----------------------------------------------------------------------------
  // Access Control Config Parsing
  // ----------------------------------------------------------------------------

  const allowedUserIdsStr = process.env.TELEGRAM_ALLOWED_USER_IDS || "";
  const allowedGroupIdsStr = process.env.TELEGRAM_ALLOWED_GROUP_IDS || "";

  const allowedUserIds = new Set<number>(
    allowedUserIdsStr
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
      .map(Number)
      .filter((n) => !isNaN(n))
  );

  const allowedGroupIds = new Set<number>(
    allowedGroupIdsStr
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
      .map(Number)
      .filter((n) => !isNaN(n))
  );

  const accessConfig: BotAccessConfig = {
    allowedUserIds,
    allowedGroupIds,
  };

  console.log(`Access control: ${allowedUserIds.size} allowed user IDs, ${allowedGroupIds.size} allowed group IDs`);

  const bot = createBot(token, chatRouter, accessConfig);

  // WebSocket client for outbound messages (if chat router is configured)
  let wsClient: ChatRouterWsClient | undefined;
  if (chatRouterUrl) {
    wsClient = new ChatRouterWsClient(chatRouterUrl, bot);
    wsClient.connect();
    console.log("WebSocket return leg enabled — listening for outbound messages\n");
  }

  // Graceful shutdown
  function shutdown(signal: string) {
    console.log(`\nReceived ${signal}. Stopping bot...`);
    wsClient?.disconnect();
    bot.stop();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Start long polling
  console.log("Starting Telegram bot with long polling...");
  console.log("Waiting for messages — send a message to your bot on Telegram.\n");

  bot.start({
    onStart: (botInfo) => {
      console.log(`Bot started successfully!`);
      console.log(`  Username: @${botInfo.username}`);
      console.log(`  Bot ID  : ${botInfo.id}`);
      console.log(`  Name    : ${botInfo.first_name}\n`);
    },
  });
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
