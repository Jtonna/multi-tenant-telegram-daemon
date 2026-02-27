import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildPrompt, triggerAcsJob, type AcsTriggerConfig } from "../trigger";
import type { TimelineEntry } from "../../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: 1,
    direction: "in",
    platform: "telegram",
    platformMessageId: "msg-1",
    platformChatId: "chat-100",
    platformChatType: "private",
    senderName: "Alice",
    senderId: "user-1",
    text: "Hello world",
    timestamp: Date.now(),
    platformMeta: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<AcsTriggerConfig> = {}): AcsTriggerConfig {
  return {
    acsBaseUrl: "http://localhost:3000",
    jobName: "test-job",
    routerUrl: "http://router:8080",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: buildPrompt
// ---------------------------------------------------------------------------

describe("buildPrompt", () => {
  it("should build correct prompt structure with all metadata fields", () => {
    const entry = makeEntry({
      platform: "telegram",
      platformChatId: "chat-123",
      id: 42,
      text: "Test message",
    });

    const prompt = buildPrompt(entry, "http://router:8080");

    expect(prompt).toBe(
      "[ROUTER=http://router:8080] [PLATFORM=telegram] [CHAT_ID=chat-123] [IN_REPLY_TO=42] User message: Test message"
    );
  });

  it("should include entry.text containing newlines", () => {
    const entry = makeEntry({
      text: "Line 1\nLine 2\nLine 3",
    });

    const prompt = buildPrompt(entry, "http://router:8080");

    expect(prompt).toContain("Line 1\nLine 2\nLine 3");
    expect(prompt).toMatch(/User message: Line 1\nLine 2\nLine 3$/);
  });

  it("should include entry.text containing double quotes", () => {
    const entry = makeEntry({
      text: 'She said "hello" to me',
    });

    const prompt = buildPrompt(entry, "http://router:8080");

    expect(prompt).toContain('She said "hello" to me');
    expect(prompt).toMatch(/User message: She said "hello" to me$/);
  });
});

// ---------------------------------------------------------------------------
// Tests: triggerAcsJob
// ---------------------------------------------------------------------------

describe("triggerAcsJob", () => {
  let fetchMock: any;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("should return false for outbound messages (direction='out')", async () => {
    const entry = makeEntry({ direction: "out" });
    const config = makeConfig();

    const result = await triggerAcsJob(config, entry);

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should return false when entry.text is null", async () => {
    const entry = makeEntry({ text: null });
    const config = makeConfig();

    const result = await triggerAcsJob(config, entry);

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should escape double quotes in the prompt", async () => {
    const entry = makeEntry({ text: 'Message with "quotes"' });
    const config = makeConfig();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ run_id: "run-123" }),
    });

    await triggerAcsJob(config, entry);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callBody = fetchMock.mock.calls[0][1].body;
    const parsedBody = JSON.parse(callBody);

    expect(parsedBody.args).toContain('\\"quotes\\"');
    expect(parsedBody.args).not.toContain('"quotes"');
  });

  it("should send correct POST request to ACS", async () => {
    const entry = makeEntry({
      id: 42,
      platform: "telegram",
      platformChatId: "chat-456",
      text: "Test message",
    });
    const config = makeConfig({
      acsBaseUrl: "http://acs.example.com",
      jobName: "my-job",
      routerUrl: "http://router:9000",
    });

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ run_id: "run-123" }),
    });

    await triggerAcsJob(config, entry);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toBe("http://acs.example.com/api/jobs/my-job/trigger");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");

    const parsedBody = JSON.parse(options.body);
    expect(parsedBody.args).toContain("[ROUTER=http://router:9000]");
    expect(parsedBody.args).toContain("[PLATFORM=telegram]");
    expect(parsedBody.args).toContain("[CHAT_ID=chat-456]");
    expect(parsedBody.args).toContain("[IN_REPLY_TO=42]");
    expect(parsedBody.args).toContain("User message: Test message");
  });

  it("should return true on successful trigger", async () => {
    const entry = makeEntry();
    const config = makeConfig();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ run_id: "run-456" }),
    });

    const result = await triggerAcsJob(config, entry);

    expect(result).toBe(true);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Triggering test-job for entry 1")
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Triggered run_id=run-456")
    );
  });

  it("should return false on non-ok response", async () => {
    const entry = makeEntry();
    const config = makeConfig();

    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const result = await triggerAcsJob(config, entry);

    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Trigger failed (500): Internal Server Error")
    );
  });

  it("should return false on network error", async () => {
    const entry = makeEntry();
    const config = makeConfig();

    fetchMock.mockRejectedValue(new Error("Network failure"));

    const result = await triggerAcsJob(config, entry);

    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Trigger error:"),
      "Network failure"
    );
  });

  it("should send the full message including content after newlines", async () => {
    const entry = makeEntry({
      text: "First line\nSecond line\nThird line",
    });
    const config = makeConfig();

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ run_id: "run-789" }),
    });

    await triggerAcsJob(config, entry);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callBody = fetchMock.mock.calls[0][1].body;
    const parsedBody = JSON.parse(callBody);

    expect(parsedBody.args).toContain("First line");
    expect(parsedBody.args).toContain("Second line");
    expect(parsedBody.args).toContain("Third line");
    expect(parsedBody.args).toMatch(/First line\nSecond line\nThird line/);
  });
});
