import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "child_process";
import { createInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

describe("MCP Server E2E", () => {
  let mcpProcess: ChildProcess;
  let responseBuffer: string[] = [];

  // Helper to send JSON-RPC message and wait for response
  function sendMessage(message: object, timeoutMs = 30000): Promise<object> {
    return new Promise((resolve, reject) => {
      const messageId = (message as { id?: number }).id;
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for response to message ${messageId}`));
      }, timeoutMs);

      const checkResponse = () => {
        for (let i = 0; i < responseBuffer.length; i++) {
          try {
            const response = JSON.parse(responseBuffer[i]);
            if (response.id === messageId) {
              responseBuffer.splice(i, 1);
              clearTimeout(timeout);
              resolve(response);
              return;
            }
          } catch {
            // Skip non-JSON lines
          }
        }
        setTimeout(checkResponse, 50);
      };

      mcpProcess.stdin!.write(JSON.stringify(message) + "\n");
      checkResponse();
    });
  }

  beforeAll(async () => {
    // Build the project first
    await new Promise<void>((resolve, reject) => {
      const build = spawn("npm", ["run", "build"], {
        cwd: projectRoot,
        stdio: "pipe",
      });
      build.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Build failed with code ${code}`));
      });
    });

    // Start the MCP proxy
    mcpProcess = spawn("node", [join(projectRoot, "dist/index.js")], {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    // Collect stdout responses
    const rl = createInterface({ input: mcpProcess.stdout! });
    rl.on("line", (line) => {
      responseBuffer.push(line);
    });

    // Wait for process to start
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }, 30000);

  it("responds to initialize request", async () => {
    const response = await sendMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });

    expect(response).toHaveProperty("result");
    expect((response as { result: { protocolVersion: string } }).result).toHaveProperty(
      "protocolVersion"
    );
  }, 15000);

  it("lists tools including browser_snapshot_full alias", async () => {
    const response = await sendMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    expect(response).toHaveProperty("result");
    const result = (response as { result: { tools: { name: string }[] } }).result;
    expect(result).toHaveProperty("tools");
    expect(Array.isArray(result.tools)).toBe(true);

    // Check that browser_snapshot_full alias is injected
    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain("browser_snapshot");
    expect(toolNames).toContain("browser_snapshot_full");
  }, 15000);

  it("navigates to a page and returns summarized snapshot", async () => {
    // Navigate to a page with enough content to trigger summarization (>500 chars)
    const navResponse = await sendMessage(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "browser_navigate",
          arguments: {
            url: "https://en.wikipedia.org/wiki/Main_Page",
          },
        },
      },
      60000
    );

    expect(navResponse).toHaveProperty("result");
    const navResult = navResponse as {
      result: { content: Array<{ type: string; text: string }> };
    };

    // Find the text content in the response
    const textContent = navResult.result.content.find((c) => c.type === "text");
    expect(textContent).toBeDefined();

    // Should contain the page URL
    expect(textContent!.text).toContain("wikipedia.org");

    // Should be summarized (contains the summarized marker)
    expect(textContent!.text).toContain("(summarized)");

    // Should contain some ref values for interactive elements
    expect(textContent!.text).toMatch(/\[ref=/);
  }, 90000); // 90 second timeout for browser + API call

  it("browser_snapshot_full returns unsummarized content", async () => {
    // Use browser_snapshot_full which should NOT be summarized
    const snapshotResponse = await sendMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "browser_snapshot_full",
        arguments: {},
      },
    });

    expect(snapshotResponse).toHaveProperty("result");
    const snapshotResult = snapshotResponse as {
      result: { content: Array<{ type: string; text: string }> };
    };

    const textContent = snapshotResult.result.content.find((c) => c.type === "text");
    expect(textContent).toBeDefined();

    // Should NOT be summarized (no summarized marker)
    expect(textContent!.text).not.toContain("(summarized)");

    // Should contain the raw yaml snapshot
    expect(textContent!.text).toContain("```yaml");
  }, 30000);

  afterAll(async () => {
    // Close the browser before killing the process
    try {
      await sendMessage({
        jsonrpc: "2.0",
        id: 99,
        method: "tools/call",
        params: {
          name: "browser_close",
          arguments: {},
        },
      });
    } catch {
      // Ignore errors during cleanup
    }

    if (mcpProcess) {
      mcpProcess.kill();
    }
  });
});
