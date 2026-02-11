// ---------------------------------------------------------------------------
// seed.ts — Insert fake Telegram messages directly via the service layer
// Usage: npm run seed
// ---------------------------------------------------------------------------

import * as fs from "fs";
import * as path from "path";
import { ChatRouterStore } from "../db/store";
import { ChatRouterService } from "../service";
import type { InboundMessage } from "../types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DATA_DIR = process.env.CHAT_ROUTER_DATA_DIR || "./data";
const DB_FILE = path.join(DATA_DIR, "chat-router.db");

// ---------------------------------------------------------------------------
// Fake users
// ---------------------------------------------------------------------------

const users = {
  alice: { id: "110234567", name: "Alice Kuznetsova", username: "alice_kuz" },
  bob: { id: "220345678", name: "Bob Marley", username: "bob_marley42" },
  carol: { id: "330456789", name: "Carol Chen", username: "carol_c" },
};

// ---------------------------------------------------------------------------
// Chat IDs — positive for private, negative for groups (Telegram convention)
// ---------------------------------------------------------------------------

const chats = {
  alicePrivate: {
    id: "110234567",
    type: "private" as const,
    title: undefined,
  },
  projectGroup: {
    id: "-1001987654321",
    type: "supergroup" as const,
    title: "Project Alpha",
  },
};

// ---------------------------------------------------------------------------
// Build fake inbound messages
// ---------------------------------------------------------------------------

function buildMessages(): InboundMessage[] {
  const now = Date.now();
  const min = 60_000; // one minute in ms

  return [
    // -- Private chat: Alice --
    {
      platform: "telegram",
      platformMessageId: "msg-1001",
      platformChatId: chats.alicePrivate.id,
      platformChatType: chats.alicePrivate.type,
      senderName: users.alice.name,
      senderId: users.alice.id,
      text: "Hey, can you check the deployment status?",
      timestamp: now - 8 * min,
      platformMeta: {
        fromUsername: users.alice.username,
        fromIsBot: false,
      },
    },
    {
      platform: "telegram",
      platformMessageId: "msg-1002",
      platformChatId: chats.alicePrivate.id,
      platformChatType: chats.alicePrivate.type,
      senderName: users.alice.name,
      senderId: users.alice.id,
      text: "The staging environment seems to be down again.",
      timestamp: now - 7 * min,
      platformMeta: {
        fromUsername: users.alice.username,
        fromIsBot: false,
      },
    },
    {
      platform: "telegram",
      platformMessageId: "msg-1003",
      platformChatId: chats.alicePrivate.id,
      platformChatType: chats.alicePrivate.type,
      senderName: users.alice.name,
      senderId: users.alice.id,
      text: "Never mind, I just restarted the service and it came back up.",
      timestamp: now - 5 * min,
      platformMeta: {
        fromUsername: users.alice.username,
        fromIsBot: false,
      },
    },

    // -- Group chat: Project Alpha --
    {
      platform: "telegram",
      platformMessageId: "msg-2001",
      platformChatId: chats.projectGroup.id,
      platformChatType: chats.projectGroup.type,
      senderName: users.bob.name,
      senderId: users.bob.id,
      text: "Good morning team! Sprint review at 2pm today.",
      timestamp: now - 6 * min,
      platformMeta: {
        chatTitle: chats.projectGroup.title,
        fromUsername: users.bob.username,
        fromIsBot: false,
      },
    },
    {
      platform: "telegram",
      platformMessageId: "msg-2002",
      platformChatId: chats.projectGroup.id,
      platformChatType: chats.projectGroup.type,
      senderName: users.carol.name,
      senderId: users.carol.id,
      text: "Sounds good. I will prepare the demo for the new chat router feature.",
      timestamp: now - 5.5 * min,
      platformMeta: {
        chatTitle: chats.projectGroup.title,
        fromUsername: users.carol.username,
        fromIsBot: false,
      },
    },
    {
      platform: "telegram",
      platformMessageId: "msg-2003",
      platformChatId: chats.projectGroup.id,
      platformChatType: chats.projectGroup.type,
      senderName: users.alice.name,
      senderId: users.alice.id,
      text: "Can someone review PR #42 before the meeting?",
      timestamp: now - 4 * min,
      platformMeta: {
        chatTitle: chats.projectGroup.title,
        fromUsername: users.alice.username,
        fromIsBot: false,
      },
    },
    {
      platform: "telegram",
      platformMessageId: "msg-2004",
      platformChatId: chats.projectGroup.id,
      platformChatType: chats.projectGroup.type,
      senderName: users.bob.name,
      senderId: users.bob.id,
      text: "I will take a look at it after lunch.",
      timestamp: now - 3 * min,
      platformMeta: {
        chatTitle: chats.projectGroup.title,
        fromUsername: users.bob.username,
        fromIsBot: false,
      },
    },
    {
      platform: "telegram",
      platformMessageId: "msg-2005",
      platformChatId: chats.projectGroup.id,
      platformChatType: chats.projectGroup.type,
      senderName: users.carol.name,
      senderId: users.carol.id,
      text: "Also, the CI pipeline is green now. All tests passing.",
      timestamp: now - 2 * min,
      platformMeta: {
        chatTitle: chats.projectGroup.title,
        fromUsername: users.carol.username,
        fromIsBot: false,
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log(`Seed script starting...`);
  console.log(`Data file: ${path.resolve(DB_FILE)}\n`);

  // Ensure the data directory exists
  const dataDir = path.dirname(DB_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Initialise store and service
  const store = new ChatRouterStore(DB_FILE);
  store.init();
  const service = new ChatRouterService(store);

  // Ingest all inbound messages
  const messages = buildMessages();
  const ingestedEntries: { id: number; text: string | null }[] = [];

  for (const msg of messages) {
    const entry = service.ingestMessage(msg);
    ingestedEntries.push({ id: entry.id, text: entry.text });
    console.log(
      `  [IN]  id=${entry.id}  chat=${msg.platformChatId}  from=${msg.senderName}  "${(msg.text ?? "").slice(0, 50)}..."`,
    );
  }

  // Record outbound responses
  console.log("");

  // Response to Alice's private chat (replying to her first message)
  const resp1 = service.recordResponse({
    platform: "telegram",
    platformChatId: chats.alicePrivate.id,
    text: "Checking the deployment status now. One moment...",
    inReplyTo: ingestedEntries[0].id,
  });
  console.log(
    `  [OUT] id=${resp1.id}  chat=${chats.alicePrivate.id}  "${resp1.text}"`,
  );

  // Response in the group chat (replying to Alice's PR review request)
  const resp2 = service.recordResponse({
    platform: "telegram",
    platformChatId: chats.projectGroup.id,
    text: "PR #42 looks good. I have added some minor inline comments.",
    inReplyTo: ingestedEntries[5].id, // Alice's "Can someone review PR #42" message
  });
  console.log(
    `  [OUT] id=${resp2.id}  chat=${chats.projectGroup.id}  "${resp2.text}"`,
  );

  // Another response in the group
  const resp3 = service.recordResponse({
    platform: "telegram",
    platformChatId: chats.projectGroup.id,
    text: "Great news on the CI pipeline! Ready for the sprint review.",
  });
  console.log(
    `  [OUT] id=${resp3.id}  chat=${chats.projectGroup.id}  "${resp3.text}"`,
  );

  // Print summary
  const health = service.healthCheck();
  console.log("\n--- Seed Summary ---");
  console.log(`  Inbound messages inserted : ${messages.length}`);
  console.log(`  Outbound responses inserted: 3`);
  console.log(`  Total messages in store    : ${health.messageCount}`);
  console.log(`  Conversations in store     : ${health.conversationCount}`);

  // Close store cleanly
  store.close();
  console.log(`\nStore closed. Data written to ${path.resolve(DB_FILE)}`);
}

main();
