import { describe, it, expect, beforeAll } from "vitest";
import { summarizeSnapshot, summarizeEvents, SNAPSHOT_PATTERN, EVENTS_PATTERN } from "../src/index.js";
import {
  smallSnapshot,
  largeSnapshot,
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
});

describe("SNAPSHOT_PATTERN regex", () => {
  it("matches valid snapshot format", () => {
    const match = largeSnapshot.match(SNAPSHOT_PATTERN);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("https://example.com/dashboard");
    expect(match![2]).toBe("User Dashboard - My Application");
    expect(match![3]).toContain("banner:");
  });

  it("does not match text without snapshot", () => {
    const match = noSnapshotText.match(SNAPSHOT_PATTERN);
    expect(match).toBeNull();
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
