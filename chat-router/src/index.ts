import { ChatRouterStore } from "./db/store";
import { ChatRouterService } from "./service";
import { createServer } from "./api/server";
import { isCliCommand, runCli } from "./cli/adapter";
import { attachWebSocket } from "./ws/adapter";

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
  const app = createServer(service);

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
