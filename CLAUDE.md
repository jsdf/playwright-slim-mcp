# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run build    # Compile TypeScript to dist/
npm run dev      # Watch mode for development
npm start        # Run the compiled proxy
```

## What This Is

An MCP proxy server that sits between Claude Code and `@anthropic-ai/mcp-playwright`. It intercepts Playwright responses containing accessibility tree snapshots and summarizes them using Claude CLI (Haiku model) to reduce context window usage.

## Architecture

Single-file implementation in `src/index.ts`:

- **PlaywrightMCPProxy class**: Spawns the real Playwright MCP as a child process, pipes JSON-RPC messages between Claude Code (stdin/stdout) and the Playwright process
- **Request tracking**: Maps request IDs to tool names via `pendingRequests` Map to know which responses need summarization
- **summarizeSnapshot()**: Extracts the `### Page state` section, calls Claude CLI synchronously to summarize, preserves `[ref=XXX]` values for interactive elements
- **SUMMARIZE_TOOLS**: Set of tool names (browser_click, browser_navigate, etc.) whose responses get summarized

## Key Implementation Details

- Snapshots under 500 chars pass through unchanged
- Uses synchronous `spawnSync("claude", [...])` with 30s timeout for summarization
- Falls back to original content on any Claude CLI failure
- Regex pattern `SNAPSHOT_PATTERN` extracts URL, title, and YAML snapshot from responses
