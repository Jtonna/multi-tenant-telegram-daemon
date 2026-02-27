import { Bot, Context } from "grammy";
import { ChatRouterClient, mapTelegramToInbound } from "./chatRouterClient";

// ----------------------------------------------------------------------------
// Access Control Types
// ----------------------------------------------------------------------------

/**
 * Access control configuration for the Telegram bot.
 * Empty sets = default-deny (block all unless explicitly allowed).
 */
export interface BotAccessConfig {
  allowedUserIds: Set<number>;
  allowedGroupIds: Set<number>;
}

/**
 * Pure function to check if a chat should be allowed access.
 * @param chatType - The Telegram chat type ("private", "group", "supergroup", "channel")
 * @param userId - The Telegram user ID
 * @param chatId - The Telegram chat ID
 * @param config - Optional access config; if undefined, allows all (backwards compatible)
 * @returns true if access is allowed, false otherwise
 */
export function checkAccess(
  chatType: string,
  userId: number,
  chatId: number,
  config?: BotAccessConfig
): boolean {
  // No config = allow all (backwards compatible)
  if (!config) {
    return true;
  }

  // DMs: check user ID
  if (chatType === "private") {
    return config.allowedUserIds.has(userId);
  }

  // Groups/supergroups: check group chat ID
  if (chatType === "group" || chatType === "supergroup") {
    return config.allowedGroupIds.has(chatId);
  }

  // Channels and unknown types: deny
  return false;
}

// ----------------------------------------------------------------------------
// Bot Creation
// ----------------------------------------------------------------------------

/**
 * Creates and configures a grammY Bot instance.
 *
 * The bot:
 * - Responds to /start with a welcome message
 * - Responds to /config with user/group IDs for allowlist setup
 * - Logs every incoming message with its full shape
 * - Optionally forwards messages to the chat router
 * - Enforces access control via allowlist (if accessConfig is provided)
 */
export function createBot(
  token: string,
  chatRouter?: ChatRouterClient,
  accessConfig?: BotAccessConfig
): Bot {
  const bot = new Bot(token);

  // /start command — welcome message
  bot.command("start", async (ctx: Context) => {
    await ctx.reply(
      "Hello! I'm the multi-tenant Telegram daemon bot.\n" +
        "Send me any message and it will be forwarded to the chat router.\n\n" +
        "This is a Phase 1 test bot for exploring the Telegram API."
    );
  });

  // /config command — show user ID and group ID for allowlist setup
  bot.command("config", async (ctx: Context) => {
    const userId = ctx.from?.id;
    const chatType = ctx.chat?.type;
    const chatId = ctx.chat?.id;

    let message = `Your Telegram user ID: ${userId}\n`;

    if (chatType === "group" || chatType === "supergroup") {
      message += `Group chat ID: ${chatId}\n`;
      message += `Chat type: ${chatType}\n`;
    }

    message += "\nGive these IDs to the bot admin to get allowlisted.";

    await ctx.reply(message);
  });

  // ----------------------------------------------------------------------------
  // Access Control Guard Middleware
  // ----------------------------------------------------------------------------

  bot.use(async (ctx: Context, next) => {
    const chatType = ctx.chat?.type;
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;

    // Skip if not a message (e.g., callback queries, inline queries, etc.)
    if (!chatType || !userId || !chatId) {
      return next();
    }

    const allowed = checkAccess(chatType, userId, chatId, accessConfig);

    if (!allowed) {
      console.log(
        `[ACCESS DENIED] chatType=${chatType} userId=${userId} chatId=${chatId}`
      );
      return; // Silently drop — do not call next()
    }

    return next();
  });

  // ----------------------------------------------------------------------------
  // Message Handler
  // ----------------------------------------------------------------------------

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
