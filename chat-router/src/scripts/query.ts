// ---------------------------------------------------------------------------
// query.ts — Query the running chat router via HTTP REST API
// Usage: npm run query [base-url]
// ---------------------------------------------------------------------------

const BASE_URL = process.argv[2] || "http://localhost:3100";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(endpoint: string): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — GET ${url}`);
  }
  return res.json() as Promise<T>;
}

function printSection(title: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(60)}\n`);
}

function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

async function queryHealth(): Promise<void> {
  printSection("Health Check  (GET /api/health)");
  const data = await fetchJson("/api/health");
  printJson(data);
}

async function queryConversations(): Promise<
  Array<{ platform: string; platformChatId: string; label: string }>
> {
  printSection("Conversations  (GET /api/conversations)");
  const data = await fetchJson<
    Array<{ platform: string; platformChatId: string; label: string }>
  >("/api/conversations");
  printJson(data);
  return data;
}

async function queryUnifiedTimeline(): Promise<void> {
  printSection("Unified Timeline  (GET /api/timeline?limit=20)");
  const data = await fetchJson("/api/timeline?limit=20");
  printJson(data);
}

async function queryConversationTimeline(
  platform: string,
  chatId: string,
  label: string,
): Promise<void> {
  const endpoint = `/api/timeline/${encodeURIComponent(platform)}/${encodeURIComponent(chatId)}`;
  printSection(`Timeline for "${label}"  (GET ${endpoint})`);
  const data = await fetchJson(endpoint);
  printJson(data);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Querying chat router at: ${BASE_URL}\n`);

  try {
    // 1. Health check
    await queryHealth();

    // 2. List conversations
    const conversations = await queryConversations();

    // 3. Unified timeline
    await queryUnifiedTimeline();

    // 4. Per-conversation timelines
    if (conversations.length > 0) {
      for (const convo of conversations) {
        await queryConversationTimeline(
          convo.platform,
          convo.platformChatId,
          convo.label,
        );
      }
    } else {
      console.log("\nNo conversations found. Run the seed script first.");
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log("  Done.");
    console.log(`${"=".repeat(60)}\n`);
  } catch (err) {
    console.error("\nFailed to query chat router:");
    console.error(
      `  ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error(
      `\nMake sure the chat router is running (npm run dev) and reachable at ${BASE_URL}`,
    );
    process.exit(1);
  }
}

main();
