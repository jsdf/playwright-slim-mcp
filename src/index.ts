#!/usr/bin/env node

import { spawn, ChildProcess } from "child_process";
import { createInterface } from "readline";
import { appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";

// ES module equivalents of __filename and __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Logger setup - logs to logs/ directory relative to package root
// Set DEBUG=1 or PLAYWRIGHT_SLIM_DEBUG=1 to enable file logging
const DEBUG_ENABLED = process.env.DEBUG === "1" || process.env.PLAYWRIGHT_SLIM_DEBUG === "1";
const LOG_DIR = join(__dirname, "..", "logs");
const LOG_FILE = join(LOG_DIR, `mcp-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);

function ensureLogDir(): void {
  if (!DEBUG_ENABLED) return;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // Ignore if already exists
  }
}

function log(level: "INFO" | "ERROR" | "DEBUG", message: string, data?: unknown): void {
  if (!DEBUG_ENABLED) return;

  const timestamp = new Date().toISOString();
  const logLine = data
    ? `[${timestamp}] [${level}] ${message} ${JSON.stringify(data)}\n`
    : `[${timestamp}] [${level}] ${message}\n`;

  try {
    appendFileSync(LOG_FILE, logLine);
  } catch {
    // Silently ignore logging errors to not break MCP communication
  }
}

// Tool alias: browser_snapshot_full -> browser_snapshot (without summarization)
const TOOL_ALIASES: Record<string, string> = {
  browser_snapshot_full: "browser_snapshot",
};

// Tools that should NOT have their responses summarized
const SKIP_SUMMARIZE_TOOLS = new Set([
  "browser_snapshot_full", // Explicit full snapshot request
]);

// Pattern to find the Page Snapshot section (new Playwright MCP format)
export const SNAPSHOT_PATTERN =
  /### Page\n- Page URL: ([^\n]+)\n- Page Title: ([^\n]+)\n### Snapshot\n```yaml\n([\s\S]*?)```/;

// Pattern to find the Events section
export const EVENTS_PATTERN = /### Events\n([\s\S]*?)(?=\n###|$)/;

/**
 * Collapse consecutive duplicate lines in the Events section.
 * Repeats are shown as the first instance followed by "[repeated N times]".
 */
export function summarizeEvents(fullText: string): string {
  const match = fullText.match(EVENTS_PATTERN);
  if (!match) {
    return fullText;
  }

  const [fullMatch, eventsContent] = match;
  const lines = eventsContent.split("\n");

  const outputLines: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const currentLine = lines[i];
    let count = 1;

    // Count consecutive identical lines
    while (i + count < lines.length && lines[i + count] === currentLine) {
      count++;
    }

    outputLines.push(currentLine);
    if (count > 1) {
      outputLines.push(`  [repeated ${count} times]`);
    }

    i += count;
  }

  // Only replace if we reduced line count
  if (outputLines.length >= lines.length) {
    return fullText;
  }

  log("DEBUG", "Summarized events section", {
    originalLines: lines.length,
    summarizedLines: outputLines.length,
  });

  const newEventsSection = `### Events\n${outputLines.join("\n")}`;
  return fullText.replace(fullMatch, newEventsSection);
}

// Initialize Anthropic client - reads ANTHROPIC_API_KEY from environment
const anthropic = new Anthropic();

// Model for summarization - can be overridden via env var
const SUMMARIZE_MODEL = process.env.PLAYWRIGHT_SLIM_MODEL || "claude-3-5-haiku-latest";

export async function summarizeSnapshot(fullText: string): Promise<string> {
  const match = fullText.match(SNAPSHOT_PATTERN);
  if (!match) {
    log("DEBUG", "SNAPSHOT_PATTERN did not match", {
      textLength: fullText.length,
      textPreview: fullText.slice(0, 500),
    });
    return fullText; // No snapshot found, return as-is
  }

  const [fullMatch, pageUrl, pageTitle, snapshotYaml] = match;

  // Skip summarization for small snapshots (< 500 chars)
  if (snapshotYaml.length < 500) {
    log("DEBUG", "Skipping summarization for small snapshot", {
      size: snapshotYaml.length,
    });
    return fullText;
  }

  log("INFO", "Summarizing snapshot", {
    url: pageUrl,
    title: pageTitle,
    snapshotSize: snapshotYaml.length,
  });

  const prompt = `Summarize this page accessibility snapshot very concisely (max ~10 lines).
  Include the main headings, key interactive elements, and any form fields.
Keep [ref=XXX] values for ALL interactive elements (buttons, links, inputs, tabs, checkboxes), unless they are repeating elements like buttons in a table. In that case include the first 3 of that type and then describe the rest as "N more similar items".
Format: Brief description, then list key elements with their refs.
Omit: decorative images, generic containers, style details.

Page: ${pageTitle}
URL: ${pageUrl}

\`\`\`yaml
${snapshotYaml}
\`\`\``;

  try {
    const message = await anthropic.messages.create({
      model: SUMMARIZE_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    // Extract text from the response
    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      const err = new Error("Anthropic API returned no text content");
      log("ERROR", "No text in Anthropic response", { content: message.content });
      throw err;
    }

    const summary = textBlock.text.trim();
    log("INFO", "Summarization complete", {
      originalSize: snapshotYaml.length,
      summarySize: summary.length,
      summary,
    });

    // Replace the snapshot section with the summary
    const newPageState = `### Page
- Page URL: ${pageUrl}
- Page Title: ${pageTitle}
### Snapshot (summarized)
${summary}`;

    return fullText.replace(fullMatch, newPageState);
  } catch (err) {
    log("ERROR", "Error calling Anthropic API", { error: String(err) });
    throw new Error(`Anthropic API error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function processToolResult(toolName: string, result: unknown): Promise<unknown> {
  if (SKIP_SUMMARIZE_TOOLS.has(toolName)) {
    return result;
  }

  // Handle the MCP result format - content array with text items
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content: unknown[] }).content;
    if (Array.isArray(content)) {
      const processedContent = await Promise.all(
        content.map(async (item) => {
          if (
            item &&
            typeof item === "object" &&
            "type" in item &&
            item.type === "text" &&
            "text" in item
          ) {
            let text = item.text as string;
            text = await summarizeSnapshot(text);
            text = summarizeEvents(text);
            return {
              ...item,
              text,
            };
          }
          return item;
        })
      );
      return {
        ...result,
        content: processedContent,
      };
    }
  }

  return result;
}

class PlaywrightMCPProxy {
  private playwrightProcess: ChildProcess | null = null;
  private pendingRequests = new Map<string | number, string>(); // id -> method name

  async start(): Promise<void> {
    ensureLogDir();

    // Spawn the real Playwright MCP, passing through any CLI arguments
    const args = ["@playwright/mcp", ...process.argv.slice(2)];
    log("INFO", "Starting playwright-slim-mcp proxy", {
      args: process.argv.slice(2),
      logFile: LOG_FILE,
      pid: process.pid,
    });

    this.playwrightProcess = spawn("npx", args, {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env },
    });

    if (!this.playwrightProcess.stdout || !this.playwrightProcess.stdin) {
      log("ERROR", "Failed to spawn Playwright MCP");
      throw new Error("Failed to spawn Playwright MCP");
    }

    log("INFO", "Playwright MCP spawned", { pid: this.playwrightProcess.pid });

    // Read from stdin (Claude Code) and forward to Playwright MCP
    const stdinReader = createInterface({ input: process.stdin });

    // Clean up child process when stdin closes (parent disconnects)
    stdinReader.on("close", () => {
      log("INFO", "stdin closed, shutting down");
      this.playwrightProcess?.kill();
      process.exit(0);
    });

    stdinReader.on("line", (line) => {
      try {
        const message = JSON.parse(line);

        // Track tool call requests so we know which tool was called
        if (message.method === "tools/call" && message.id !== undefined) {
          const originalName = message.params?.name || "";
          this.pendingRequests.set(message.id, originalName);

          log("INFO", "Tool call", {
            id: message.id,
            tool: originalName,
            params: message.params?.arguments,
          });

          // Rewrite aliased tool names to their real counterparts
          if (originalName in TOOL_ALIASES) {
            log("DEBUG", "Rewriting aliased tool", {
              from: originalName,
              to: TOOL_ALIASES[originalName],
            });
            message.params.name = TOOL_ALIASES[originalName];
            this.playwrightProcess?.stdin?.write(
              JSON.stringify(message) + "\n"
            );
            return;
          }
        }

        // Forward to Playwright MCP
        this.playwrightProcess?.stdin?.write(line + "\n");
      } catch {
        // Forward non-JSON lines as-is
        this.playwrightProcess?.stdin?.write(line + "\n");
      }
    });

    // Read from Playwright MCP and process before sending to stdout (Claude Code)
    const stdoutReader = createInterface({
      input: this.playwrightProcess.stdout,
    });
    stdoutReader.on("line", (line) => {
      this.processLine(line).catch((err) => {
        log("ERROR", "Error processing line", { error: String(err) });
        // Try to extract request ID and return MCP error response
        try {
          const message = JSON.parse(line);
          if (message.id !== undefined) {
            const errorResponse = {
              jsonrpc: "2.0",
              id: message.id,
              error: {
                code: -32000,
                message: `Summarization failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            };
            process.stdout.write(JSON.stringify(errorResponse) + "\n");
            return;
          }
        } catch {
          // Couldn't parse as JSON, fall through
        }
        // Forward original line if we can't construct an error response
        process.stdout.write(line + "\n");
      });
    });

    // Handle process exit
    this.playwrightProcess.on("exit", (code) => {
      log("INFO", "Playwright MCP exited", { code });
      process.exit(code || 0);
    });

    process.on("SIGINT", () => {
      log("INFO", "Received SIGINT, shutting down");
      this.playwrightProcess?.kill();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      log("INFO", "Received SIGTERM, shutting down");
      this.playwrightProcess?.kill();
      process.exit(0);
    });

    process.on("SIGHUP", () => {
      log("INFO", "Received SIGHUP, shutting down");
      this.playwrightProcess?.kill();
      process.exit(0);
    });

    // Catch-all for any exit path
    process.on("exit", () => {
      this.playwrightProcess?.kill();
    });
  }

  private async processLine(line: string): Promise<void> {
    try {
      const message = JSON.parse(line);

      // Inject aliased tools into tools/list response
      if (message.result?.tools && Array.isArray(message.result.tools)) {
        const snapshotTool = message.result.tools.find(
          (t: { name: string }) => t.name === "browser_snapshot"
        );
        if (snapshotTool) {
          message.result.tools.push({
            ...snapshotTool,
            name: "browser_snapshot_full",
            description:
              "Capture full accessibility snapshot without summarization",
            annotations: {
              ...snapshotTool.annotations,
              title: "Full page snapshot (unsummarized)",
            },
          });
        }
      }

      // Check if this is a response to a tool call
      if (message.id !== undefined && this.pendingRequests.has(message.id)) {
        const toolName = this.pendingRequests.get(message.id)!;
        this.pendingRequests.delete(message.id);

        const willSummarize = !SKIP_SUMMARIZE_TOOLS.has(toolName);
        log("INFO", "Tool response", {
          id: message.id,
          tool: toolName,
          willSummarize,
          hasError: !!message.error,
        });

        // Process the result to summarize snapshots
        if (message.result) {
          message.result = await processToolResult(toolName, message.result);
        }
      }

      // Send processed message to Claude Code
      process.stdout.write(JSON.stringify(message) + "\n");
    } catch {
      // Forward non-JSON lines as-is
      process.stdout.write(line + "\n");
    }
  }
}

const proxy = new PlaywrightMCPProxy();
proxy.start().catch((err) => {
  console.error("Failed to start Playwright MCP proxy:", err);
  process.exit(1);
});
