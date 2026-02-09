import { Bot, Context } from "grammy";

/**
 * Creates and configures a grammY Bot instance.
 *
 * The bot logs every incoming message with its full shape so we can
 * understand the Telegram data structures during Phase 1 exploration.
 */
export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // Log every incoming message with full detail
  bot.on("message", (ctx: Context) => {
    const msg = ctx.message!;

    console.log("\n========== INCOMING MESSAGE ==========");
    console.log("Timestamp :", new Date().toISOString());
    console.log("Message ID:", msg.message_id);
    console.log("Chat ID   :", msg.chat.id);
    console.log("Chat Type :", msg.chat.type);
    console.log("From      :", JSON.stringify(msg.from, null, 2));
    console.log("Date      :", new Date(msg.date * 1000).toISOString());
    console.log("Text      :", msg.text ?? "(no text)");

    // Log the full raw message object for exploration
    console.log("\n--- Full message object ---");
    console.log(JSON.stringify(msg, null, 2));
    console.log("===========================================\n");
  });

  return bot;
}
