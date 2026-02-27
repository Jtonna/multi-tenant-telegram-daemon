import "dotenv/config";
import fs from "fs";
import path from "path";
import util from "util";
import { ChatRouterStore } from "./db/store";
import { ChatRouterService } from "./service";
import { createServer } from "./api/server";
import { isCliCommand, runCli } from "./cli/adapter";
import { attachWebSocket } from "./ws/adapter";
import type { AcsTriggerConfig } from "./acs/trigger";

// ---------------------------------------------------------------------------
// File logging setup
// ---------------------------------------------------------------------------

const logsDir = path.join(__dirname, "..", "logs");
fs.mkdirSync(logsDir, { recursive: true });

const logFilePath = path.join(logsDir, "chat-router.log");
const logStream = fs.createWriteStream(logFilePath, { flags: "a" });

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = (...args: any[]) => {
  const timestamp = new Date().toISOString();
  const message = util.format(...args);
  logStream.write(`[${timestamp}] [LOG] ${message}\n`);
  originalConsoleLog(...args);
};

console.error = (...args: any[]) => {
  const timestamp = new Date().toISOString();
  const message = util.format(...args);
  logStream.write(`[${timestamp}] [ERROR] ${message}\n`);
  originalConsoleError(...args);
};

// ---------------------------------------------------------------------------
// Mode detection: CLI command vs daemon server
// ---------------------------------------------------------------------------

const firstArg = process.argv[2];

if (firstArg && isCliCommand(firstArg)) {
  // CLI mode — forward remaining args to the CLI adapter
  runCli(process.argv.slice(2));
} else {
  // Daemon mode — start the HTTP server
  const PORT = parseInt(process.env.CHAT_ROUTER_PORT || "3100", 10);
  const DATA_DIR = process.env.CHAT_ROUTER_DATA_DIR || "./data";

  const store = new ChatRouterStore(`${DATA_DIR}/chat-router.db`);
  store.init();
  const service = new ChatRouterService(store);

  // ACS auto-trigger configuration
  const ACS_URL = process.env.ACS_URL || "http://127.0.0.1:8377";
  const ACS_JOB = process.env.ACS_JOB_NAME;
  let acsConfig: AcsTriggerConfig | undefined;

  if (ACS_JOB) {
    const ROUTER_SELF_URL = process.env.ROUTER_SELF_URL || `http://localhost:${PORT}`;
    acsConfig = { acsBaseUrl: ACS_URL, jobName: ACS_JOB, routerUrl: ROUTER_SELF_URL };
    console.log(`[acs] Auto-trigger enabled: ${ACS_JOB} via ${ACS_URL}`);
  } else {
    console.log("[acs] Auto-trigger disabled (ACS_JOB_NAME not set)");
  }

  const app = createServer(service, acsConfig);

  const server = app.listen(PORT, () => {
    console.log(`Chat router listening on http://localhost:${PORT}`);
  });

  attachWebSocket(server, service);

  // Graceful shutdown on SIGINT/SIGTERM
  function shutdown(signal: string) {
    console.log(`\nReceived ${signal}. Shutting down...`);
    server.close(() => {
      store.close();
      console.log("Chat router stopped.");
      process.exit(0);
    });
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
