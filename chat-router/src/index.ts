import { ChatRouterStore } from "./db/store";
import { ChatRouterService } from "./service";
import { createServer } from "./api/server";

const PORT = parseInt(process.env.CHAT_ROUTER_PORT || "3100", 10);
const DATA_DIR = process.env.CHAT_ROUTER_DATA_DIR || "./data";

const store = new ChatRouterStore(`${DATA_DIR}/chat-router.json`);
store.init();
const service = new ChatRouterService(store);
const app = createServer(service);

const server = app.listen(PORT, () => {
  console.log(`Chat router listening on http://localhost:${PORT}`);
});

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
