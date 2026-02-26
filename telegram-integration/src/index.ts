import "dotenv/config";
import { createBot } from "./bot";
import { ChatRouterClient } from "./chatRouterClient";
import { ChatRouterWsClient } from "./wsClient";

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

  const bot = createBot(token, chatRouter);

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
