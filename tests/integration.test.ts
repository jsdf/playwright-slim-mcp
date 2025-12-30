import { describe, it, expect, beforeAll } from "vitest";
import { summarizeSnapshot, SNAPSHOT_PATTERN } from "../src/index.js";
import {
  smallSnapshot,
  largeSnapshot,
  noSnapshotText,
  snapshotWithContext,
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
