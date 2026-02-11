import "dotenv/config";
import { createBot } from "./bot";
import { ChatRouterClient } from "./chatRouterClient";

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
} else {
  console.log("CHAT_ROUTER_URL not set — running in standalone mode (echo only)");
}

const bot = createBot(token, chatRouter);

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`\nReceived ${signal}. Stopping bot...`);
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
