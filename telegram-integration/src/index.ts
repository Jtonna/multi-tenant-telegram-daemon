import "dotenv/config";
import { createBot } from "./bot";

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error("ERROR: BOT_TOKEN environment variable is not set.");
  console.error("Create a .env file with BOT_TOKEN=your_token_here");
  process.exit(1);
}

const bot = createBot(token);

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
