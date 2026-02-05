import { describe, it, expect, beforeAll } from "vitest";
import { summarizeSnapshot, summarizeEvents, parsePlaywrightResponse, EVENTS_PATTERN } from "../src/index.js";
import {
  smallSnapshot,
  smallSnapshotWithConsole,
  largeSnapshot,
  largeSnapshotWithConsole,
  noSnapshotText,
  snapshotWithContext,
  eventsWithRepeats,
  eventsNoRepeats,
  fullResponseWithEvents,
} from "./fixtures.js";

describe("summarizeSnapshot", () => {
  beforeAll(() => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is required for integration tests"
      );
    }
  });

  it("passes through text without snapshot pattern unchanged", async () => {
    const result = await summarizeSnapshot(noSnapshotText);
    expect(result).toBe(noSnapshotText);
  });

  it("passes through small snapshots (< 500 chars) unchanged", async () => {
    const result = await summarizeSnapshot(smallSnapshot);
    expect(result).toBe(smallSnapshot);
  });

  it("summarizes large snapshots via Anthropic API", async () => {
    const result = await summarizeSnapshot(largeSnapshot);

    // Should be different from input (summarized)
    expect(result).not.toBe(largeSnapshot);

    // Should contain the URL and title
    expect(result).toContain("https://example.com/dashboard");
    expect(result).toContain("User Dashboard");

    // Should indicate it's summarized
    expect(result).toContain("(summarized)");

    // Should be shorter than the original
    expect(result.length).toBeLessThan(largeSnapshot.length);
  }, 30000); // 30 second timeout for API call

  it("preserves [ref=...] values in summarized output", async () => {
    const result = await summarizeSnapshot(largeSnapshot);

    // Should contain at least some ref values for interactive elements
    const refPattern = /\[ref=[^\]]+\]/g;
    const refs = result.match(refPattern);

    expect(refs).not.toBeNull();
    expect(refs!.length).toBeGreaterThan(0);
  }, 30000);

  it("handles snapshot with surrounding context", async () => {
    const result = await summarizeSnapshot(snapshotWithContext);

    // Should still contain the prefix and suffix
    expect(result).toContain("Tool executed successfully.");
    expect(result).toContain("Additional information about the page interaction.");

    // Should be summarized (shorter overall)
    expect(result.length).toBeLessThan(snapshotWithContext.length);
  }, 30000);

  it("summarizes new format snapshots (with Console line)", async () => {
    const result = await summarizeSnapshot(largeSnapshotWithConsole);

    // Should be different from input (summarized)
    expect(result).not.toBe(largeSnapshotWithConsole);

    // Should contain the URL and title
    expect(result).toContain("https://example.com/dashboard");
    expect(result).toContain("User Dashboard");

    // Should indicate it's summarized
    expect(result).toContain("(summarized)");

    // Should be shorter than the original
    expect(result.length).toBeLessThan(largeSnapshotWithConsole.length);
  }, 30000);

  it("passes through small new-format snapshots unchanged", async () => {
    const result = await summarizeSnapshot(smallSnapshotWithConsole);
    expect(result).toBe(smallSnapshotWithConsole);
  });
});

describe("parsePlaywrightResponse", () => {
  it("parses valid snapshot format (old format without Console line)", () => {
    const parsed = parsePlaywrightResponse(largeSnapshot);
    expect(parsed).not.toBeNull();
    expect(parsed!.url).toBe("https://example.com/dashboard");
    expect(parsed!.title).toBe("User Dashboard - My Application");
    expect(parsed!.snapshotYaml).toContain("banner:");
  });

  it("parses valid snapshot format (new format with Console line)", () => {
    const parsed = parsePlaywrightResponse(largeSnapshotWithConsole);
    expect(parsed).not.toBeNull();
    expect(parsed!.url).toBe("https://example.com/dashboard");
    expect(parsed!.title).toBe("User Dashboard - My Application");
    expect(parsed!.snapshotYaml).toContain("banner:");
    // Ensure fullMatch includes the Console line
    expect(parsed!.fullMatch).toContain("- Console: 5 errors, 2 warnings");
  });

  it("returns null for text without snapshot", () => {
    const parsed = parsePlaywrightResponse(noSnapshotText);
    expect(parsed).toBeNull();
  });
});

describe("summarizeEvents", () => {
  it("collapses consecutive duplicate lines", () => {
    const result = summarizeEvents(eventsWithRepeats);

    // Should contain the first instance
    expect(result).toContain('- [LOG] MOCKED: Segment tracked "Exp Assignment"');

    // Should have [repeated N times] for the 5 duplicates
    expect(result).toContain("[repeated 5 times]");

    // Should still contain unique lines
    expect(result).toContain('- [LOG] MOCKED: Segment tracked "Command Center Open"');
    expect(result).toContain("- [ERROR] Warning: validateDOMNesting");

    // Should be shorter
    expect(result.length).toBeLessThan(eventsWithRepeats.length);
  });

  it("passes through events without repeats unchanged", () => {
    const result = summarizeEvents(eventsNoRepeats);
    expect(result).toBe(eventsNoRepeats);
  });

  it("passes through text without events section unchanged", () => {
    const result = summarizeEvents(noSnapshotText);
    expect(result).toBe(noSnapshotText);
  });

  it("handles full response with both snapshot and events", () => {
    const result = summarizeEvents(fullResponseWithEvents);

    // Should preserve content before events
    expect(result).toContain("### Ran Playwright code");
    expect(result).toContain("### Page");

    // Should collapse repeated events
    expect(result).toContain("[repeated 5 times]");
  });
});

describe("EVENTS_PATTERN regex", () => {
  it("matches events section", () => {
    const match = eventsWithRepeats.match(EVENTS_PATTERN);
    expect(match).not.toBeNull();
    expect(match![1]).toContain("[LOG]");
  });

  it("does not match text without events", () => {
    const match = noSnapshotText.match(EVENTS_PATTERN);
    expect(match).toBeNull();
  });
});
