#!/usr/bin/env node

import { spawn, spawnSync, ChildProcess } from "child_process";
import { createInterface } from "readline";
import { appendFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ES module equivalents of __filename and __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Logger setup - logs to logs/ directory relative to package root
const LOG_DIR = join(__dirname, "..", "logs");
const LOG_FILE = join(LOG_DIR, `mcp-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);

function ensureLogDir(): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // Ignore if already exists
  }
}

function log(level: "INFO" | "ERROR" | "DEBUG", message: string, data?: unknown): void {
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

// Tools that return snapshots after actions - these get summarized
const SUMMARIZE_TOOLS = new Set([
  "browser_click",
  "browser_type",
  "browser_press_key",
  "browser_select_option",
  "browser_hover",
  "browser_drag",
  "browser_navigate",
  "browser_navigate_back",
  "browser_handle_dialog",
  "browser_file_upload",
  "browser_fill_form",
  "browser_snapshot", // Also summarize explicit snapshots
]);

// Pattern to find the Page Snapshot section
const SNAPSHOT_PATTERN =
  /### Page state\n- Page URL: ([^\n]+)\n- Page Title: ([^\n]+)\n- Page Snapshot:\n```yaml\n([\s\S]*?)```/;

function summarizeSnapshot(fullText: string): string {
  const match = fullText.match(SNAPSHOT_PATTERN);
  if (!match) {
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
    const result = spawnSync(
      "claude",
      ["--print", prompt, "--model", "haiku", "--no-session-persistence"],
      {
        encoding: "utf-8",
        timeout: 30000, // 30 second timeout
        maxBuffer: 1024 * 1024 * 5, // 5MB buffer
      }
    );

    if (result.status !== 0 || result.error) {
      log("ERROR", "Claude summarization failed", {
        status: result.status,
        error: result.error?.message,
        stderr: result.stderr?.slice(0, 500),
      });
      console.error(
        "[playwright-slim-mcp] Claude summarization failed:",
        result.stderr || result.error
      );
      return fullText; // Fall back to original
    }

    const summary = result.stdout.trim();
    log("INFO", "Summarization complete", {
      originalSize: snapshotYaml.length,
      summarySize: summary.length,
    });

    // Replace the snapshot section with the summary
    const newPageState = `### Page state
- Page URL: ${pageUrl}
- Page Title: ${pageTitle}
- Page Snapshot (summarized):
${summary}`;

    return fullText.replace(fullMatch, newPageState);
  } catch (err) {
    log("ERROR", "Error running Claude", { error: String(err) });
    console.error("[playwright-slim-mcp] Error running Claude:", err);
    return fullText; // Fall back to original
  }
}

function processToolResult(toolName: string, result: unknown): unknown {
  if (!SUMMARIZE_TOOLS.has(toolName)) {
    return result;
  }

  // Handle the MCP result format - content array with text items
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content: unknown[] }).content;
    if (Array.isArray(content)) {
      return {
        ...result,
        content: content.map((item) => {
          if (
            item &&
            typeof item === "object" &&
            "type" in item &&
            item.type === "text" &&
            "text" in item
          ) {
            return {
              ...item,
              text: summarizeSnapshot(item.text as string),
            };
          }
          return item;
        }),
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

          const willSummarize = SUMMARIZE_TOOLS.has(toolName);
          log("INFO", "Tool response", {
            id: message.id,
            tool: toolName,
            willSummarize,
            hasError: !!message.error,
          });

          // Process the result to summarize snapshots
          if (message.result) {
            message.result = processToolResult(toolName, message.result);
          }
        }

        // Send processed message to Claude Code
        process.stdout.write(JSON.stringify(message) + "\n");
      } catch {
        // Forward non-JSON lines as-is
        process.stdout.write(line + "\n");
      }
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
  }
}

const proxy = new PlaywrightMCPProxy();
proxy.start().catch((err) => {
  console.error("Failed to start Playwright MCP proxy:", err);
  process.exit(1);
});
