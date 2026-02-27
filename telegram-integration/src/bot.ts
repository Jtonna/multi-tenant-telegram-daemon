import { Bot, Context } from "grammy";
import { ChatRouterClient, mapTelegramToInbound } from "./chatRouterClient";

/**
 * Creates and configures a grammY Bot instance.
 *
 * The bot:
 * - Responds to /start with a welcome message
 * - Logs every incoming message with its full shape
 * - Optionally forwards messages to the chat router
 * - Echoes text messages back (for testing response sending)
 */
export function createBot(token: string, chatRouter?: ChatRouterClient): Bot {
  const bot = new Bot(token);

  // /start command — welcome message
  bot.command("start", async (ctx: Context) => {
    await ctx.reply(
      "Hello! I'm the multi-tenant Telegram daemon bot.\n" +
        "Send me any message and it will be forwarded to the chat router.\n\n" +
        "This is a Phase 1 test bot for exploring the Telegram API."
    );
  });

  // Log every incoming message with full detail, then echo it back
  bot.on("message", async (ctx: Context) => {
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

    // Forward to chat router if configured — thumbs-up on success
    if (chatRouter) {
      try {
        const inbound = mapTelegramToInbound(ctx);
        await chatRouter.ingestMessage(inbound);
        console.log("  -> Forwarded to chat-router");
        await ctx.react("👍");
      } catch (err) {
        console.error("  -> Failed to forward to chat-router:", err);
      }
    }
  });

  return bot;
}
