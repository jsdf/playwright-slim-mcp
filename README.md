# playwright-slim-mcp

A proxy MCP server for Playwright that summarizes accessibility snapshots using Claude Haiku to reduce context usage.

## Problem

The official `@playwright/mcp` returns full accessibility tree snapshots after every action (click, type, navigate, etc.). These snapshots can be 2-10KB+ each, quickly consuming context window.

## Solution

This proxy:
1. Forwards all requests to the real Playwright MCP
2. Intercepts responses containing page snapshots
3. Uses Anthropic API (Claude Haiku) to summarize snapshots to ~10 lines
4. Preserves `[ref=XXX]` values for interactive elements so you can still click/type

## Installation

```bash
cd ~/code/playwright-slim-mcp
npm install
npm run build
```

## Usage

In your Claude Code MCP config (`~/.claude.json`), replace the Playwright MCP with this proxy:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "node",
      "args": ["/path/to/playwright-slim-mcp/dist/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

## Requirements

- `ANTHROPIC_API_KEY` environment variable
- Node.js 18+

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `PLAYWRIGHT_SLIM_MODEL` | No | Model for summarization (default: `claude-3-5-haiku-latest`) |
| `DEBUG` or `PLAYWRIGHT_SLIM_DEBUG` | No | Set to `1` to enable file logging to `logs/` |

## Configuration

The proxy summarizes snapshots for these tools:
- `browser_click`
- `browser_type`
- `browser_press_key`
- `browser_select_option`
- `browser_hover`
- `browser_drag`
- `browser_navigate`
- `browser_navigate_back`
- `browser_handle_dialog`
- `browser_file_upload`
- `browser_fill_form`
- `browser_snapshot`

Small snapshots (<500 chars) are passed through unchanged.

### Unsummarized Snapshots

Use `browser_snapshot_full` to get the raw accessibility tree without summarization. This tool is automatically added as an alias.

## Testing

```bash
# Create .env file with your API key
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# Run tests (includes real API calls and browser tests)
npm test
```

## Example

**Before (2KB+):**
```yaml
- generic [ref=e327]:
  - generic [ref=e328]:
    - heading "Go back James's Workspace" [level=4] [ref=e329]:
      - button "Go back" [ref=e330] [cursor=pointer]:
        - img [ref=e331]
      - text: James's Workspace
    # ... 100+ more lines
```

**After (~200 bytes):**
```
Admin settings for "James's Workspace"
Tabs: Overview [e343], Feature flags [e348, selected], Members [e353], Tables [e358]
Actions: Go back [e330], Impersonate [e334]
```
