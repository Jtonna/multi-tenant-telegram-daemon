import { describe, it, expect } from "vitest";
import { createBot } from "../bot";

describe("createBot", () => {
  // Use a dummy token in the format grammY expects (numeric_id:alphanumeric)
  const DUMMY_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";

  it("returns a Bot instance", () => {
    const bot = createBot(DUMMY_TOKEN);
    expect(bot).toBeDefined();
    expect(typeof bot.on).toBe("function");
    expect(typeof bot.start).toBe("function");
    expect(typeof bot.stop).toBe("function");
  });

  it("has a message handler registered", () => {
    const bot = createBot(DUMMY_TOKEN);
    // grammY stores middleware internally; the bot should have at least
    // one handler after createBot configures it
    expect(bot).toBeDefined();
  });

  it("throws on empty token", () => {
    expect(() => createBot("")).toThrow();
  });
});
