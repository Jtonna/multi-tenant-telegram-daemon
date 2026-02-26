import { ChatRouterClient } from "./client";

// ---------------------------------------------------------------------------
// CLI adapter — parses process.argv and dispatches to ChatRouterClient
// ---------------------------------------------------------------------------

const COMMANDS = ["health", "conversations", "timeline", "ingest", "respond"] as const;
export type CliCommand = (typeof COMMANDS)[number];

export function isCliCommand(arg: string): arg is CliCommand {
  return (COMMANDS as readonly string[]).includes(arg);
}

// ---------------------------------------------------------------------------
// Arg parsing helpers
// ---------------------------------------------------------------------------

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string>;
}

/**
 * Minimal argv parser. Supports --key value pairs and positional arguments.
 * No external libraries — just splits on `--`.
 */
function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = "true";
        i += 1;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }

  return { positional, flags };
}

// ---------------------------------------------------------------------------
// stdin reader
// ---------------------------------------------------------------------------

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handleHealth(client: ChatRouterClient): Promise<void> {
  const result = await client.health();
  console.log(JSON.stringify(result, null, 2));
}

async function handleConversations(
  client: ChatRouterClient,
  flags: Record<string, string>,
): Promise<void> {
  const result = await client.conversations({
    platform: flags.platform,
    limit: flags.limit ? Number(flags.limit) : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function handleTimeline(
  client: ChatRouterClient,
  positional: string[],
  flags: Record<string, string>,
): Promise<void> {
  const after = flags.after ? Number(flags.after) : undefined;
  const before = flags.before ? Number(flags.before) : undefined;
  const limit = flags.limit ? Number(flags.limit) : undefined;

  // If platform and chatId are provided, use per-conversation timeline
  if (positional.length >= 2) {
    const [platform, chatId] = positional;
    const result = await client.timeline(platform, chatId, {
      after,
      before,
      limit,
    });
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Unified timeline
    const result = await client.unifiedTimeline({ after, before, limit });
    console.log(JSON.stringify(result, null, 2));
  }
}

async function handleIngest(
  client: ChatRouterClient,
  flags: Record<string, string>,
): Promise<void> {
  const jsonStr = flags.json ?? (await readStdin());
  const body = JSON.parse(jsonStr);
  const result = await client.ingest(body);
  console.log(JSON.stringify(result, null, 2));
}

async function handleRespond(
  client: ChatRouterClient,
  flags: Record<string, string>,
): Promise<void> {
  const jsonStr = flags.json ?? (await readStdin());
  const body = JSON.parse(jsonStr);
  const result = await client.respond(body);
  console.log(JSON.stringify(result, null, 2));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run a CLI command. `args` should be everything after the command name,
 * e.g. for `chat-router timeline telegram 123 --limit 10`,
 * args = ["timeline", "telegram", "123", "--limit", "10"].
 */
export async function runCli(args: string[]): Promise<void> {
  const command = args[0] as CliCommand;
  const rest = args.slice(1);
  const { positional, flags } = parseArgs(rest);

  const baseUrl =
    process.env.CHAT_ROUTER_URL || "http://localhost:3100";
  const client = new ChatRouterClient(baseUrl);

  try {
    switch (command) {
      case "health":
        await handleHealth(client);
        break;
      case "conversations":
        await handleConversations(client, flags);
        break;
      case "timeline":
        await handleTimeline(client, positional, flags);
        break;
      case "ingest":
        await handleIngest(client, flags);
        break;
      case "respond":
        await handleRespond(client, flags);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.error(`Available commands: ${COMMANDS.join(", ")}`);
        process.exit(1);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
