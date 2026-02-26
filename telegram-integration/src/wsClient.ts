import WebSocket from "ws";
import { Bot } from "grammy";
import { splitMessage } from "./splitMessage";

// ---------------------------------------------------------------------------
// Types — redeclared locally (no cross-package import)
// ---------------------------------------------------------------------------

interface TimelineEntry {
  id: number;
  direction: "in" | "out";
  platform: string;
  platformMessageId: string;
  platformChatId: string;
  platformChatType: string | null;
  senderName: string;
  senderId: string;
  text: string | null;
  timestamp: number;
  platformMeta: string | null;
  createdAt: string;
}

interface WsPush {
  type: "new_message";
  entry: TimelineEntry;
}

// ---------------------------------------------------------------------------
// ChatRouterWsClient
// ---------------------------------------------------------------------------

export class ChatRouterWsClient {
  private ws: WebSocket | null = null;
  private intentionalClose = false;
  private wsUrl: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    chatRouterUrl: string,
    private bot: Bot,
  ) {
    this.wsUrl = this.deriveWsUrl(chatRouterUrl);
  }

  connect(): void {
    this.intentionalClose = false;
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on("open", () => {
      console.log(`WebSocket connected to chat router at ${this.wsUrl}`);
    });

    this.ws.on("message", (raw: WebSocket.RawData) => {
      this.handleMessage(raw.toString());
    });

    this.ws.on("close", () => {
      if (!this.intentionalClose) {
        console.log("WebSocket disconnected from chat router, reconnecting in 3s...");
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    });

    this.ws.on("error", (err: Error) => {
      console.warn(`WebSocket error: ${err.message}`);
    });
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private handleMessage(raw: string): void {
    let msg: WsPush;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.warn("WebSocket received malformed JSON, ignoring");
      return;
    }

    if (msg.type !== "new_message") return;

    const entry = msg.entry;
    if (entry.direction !== "out") return;
    if (entry.platform !== "telegram") return;
    if (!entry.text) return;

    console.log(
      `Outbound message ${entry.id} for telegram chat ${entry.platformChatId} — delivering`,
    );
    this.deliverToTelegram(entry);
  }

  private async deliverToTelegram(entry: TimelineEntry): Promise<void> {
    try {
      const chunks = splitMessage(entry.text!);
      for (const chunk of chunks) {
        await this.bot.api.sendMessage(entry.platformChatId, chunk);
      }
      console.log(`Delivered to Telegram chat ${entry.platformChatId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `Failed to deliver to Telegram chat ${entry.platformChatId}: ${message}`,
      );
    }
  }

  private deriveWsUrl(httpUrl: string): string {
    const cleaned = httpUrl.replace(/\/+$/, "");
    return cleaned.replace(/^http/, "ws") + "/ws";
  }
}
