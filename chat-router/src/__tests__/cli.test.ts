import { describe, it, expect } from "vitest";
import { isCliCommand } from "../cli/adapter";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CLI adapter", () => {
  // ----- isCliCommand -----

  describe("isCliCommand()", () => {
    it("returns true for 'health'", () => {
      expect(isCliCommand("health")).toBe(true);
    });

    it("returns true for 'conversations'", () => {
      expect(isCliCommand("conversations")).toBe(true);
    });

    it("returns true for 'timeline'", () => {
      expect(isCliCommand("timeline")).toBe(true);
    });

    it("returns true for 'ingest'", () => {
      expect(isCliCommand("ingest")).toBe(true);
    });

    it("returns true for 'respond'", () => {
      expect(isCliCommand("respond")).toBe(true);
    });

    it("returns false for an unknown command", () => {
      expect(isCliCommand("unknown")).toBe(false);
    });

    it("returns false for an empty string", () => {
      expect(isCliCommand("")).toBe(false);
    });

    it("returns false for a command with wrong casing", () => {
      expect(isCliCommand("Health")).toBe(false);
    });

    it("returns false for a partial match", () => {
      expect(isCliCommand("heal")).toBe(false);
    });
  });
});
