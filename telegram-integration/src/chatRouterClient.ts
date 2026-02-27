import { Context } from "grammy";

// ---------------------------------------------------------------------------
// InboundMessage — redeclared locally (no cross-package import)
// ---------------------------------------------------------------------------

export interface InboundMessage {
  platform: "telegram";
  platformMessageId: string;
  platformChatId: string;
  platformChatType?: string;
  senderName: string;
  senderId: string;
  text?: string;
  timestamp: number;
  platformMeta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// mapTelegramToInbound — maps grammY Context to normalized format
// ---------------------------------------------------------------------------

export function mapTelegramToInbound(ctx: Context): InboundMessage {
  const msg = ctx.message!;
  const from = msg.from!;

  return {
    platform: "telegram",
    platformMessageId: String(msg.message_id),
    platformChatId: String(msg.chat.id),
    platformChatType: msg.chat.type,
    senderName: [from.first_name, from.last_name].filter(Boolean).join(" "),
    senderId: String(from.id),
    text: msg.text,
    timestamp: msg.date * 1000,
    platformMeta: {
      chatTitle: "title" in msg.chat ? msg.chat.title : undefined,
      fromUsername: from.username,
      fromIsBot: from.is_bot,
    },
  };
}

// ---------------------------------------------------------------------------
// ChatRouterClient — HTTP client for the chat-router REST API
// ---------------------------------------------------------------------------

export class ChatRouterClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    // Remove trailing slash if present
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async ingestMessage(msg: InboundMessage): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(msg),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Chat router returned ${res.status}: ${body}`);
    }

    return res.json();
  }

  async healthCheck(): Promise<{
    ok: boolean;
    messageCount: number;
    conversationCount: number;
  }> {
    const res = await fetch(`${this.baseUrl}/api/health`);

    if (!res.ok) {
      throw new Error(`Chat router health check failed: ${res.status}`);
    }

    return res.json() as Promise<{
      ok: boolean;
      messageCount: number;
      conversationCount: number;
    }>;
  }
}
