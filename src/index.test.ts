import { describe, it, expect } from "vitest";
import { parsePlaywrightResponse, summarizeEvents } from "./index.js";

// Fixture: Old format (no Console line)
const OLD_FORMAT_FIXTURE = `### Ran Playwright code
\`\`\`js
await page.goto('http://localhost:8090');
\`\`\`
### Page
- Page URL: http://localhost:8090/workspaces/9/
- Page Title: Clay | Clay Starter Table
### Snapshot
\`\`\`yaml
- generic [ref=e1]:
  - banner [ref=e4]:
    - navigation [ref=e6]:
      - button "logo" [ref=e9]
\`\`\`
### Events
- Some event`;

// Fixture: New format (with Console line)
const NEW_FORMAT_FIXTURE = `### Ran Playwright code
\`\`\`js
await page.goto('http://localhost:8090');
\`\`\`
### Page
- Page URL: http://localhost:8090/workspaces/9/workbooks/wb_0t7yf0aQsZAw5Kgsnfb
- Page Title: Clay | Clay Starter Table
- Console: 18 errors, 8 warnings
### Snapshot
\`\`\`yaml
- generic [ref=e1]:
  - banner [ref=e4]:
    - navigation [ref=e6]:
      - button "logo" [ref=e9]
      - link "Home" [ref=e10]
\`\`\`
### Events
- [LOG] something
- [ERROR] an error`;

// Fixture: New format with multiple extra lines after Page Title
const NEW_FORMAT_MULTI_LINE_FIXTURE = `### Page
- Page URL: http://example.com/
- Page Title: Example Page
- Console: 5 errors
- Viewport: 1920x1080
### Snapshot
\`\`\`yaml
- heading "Hello World" [ref=e1]
\`\`\``;

// Fixture: Minimal valid snapshot
const MINIMAL_FIXTURE = `### Page
- Page URL: http://test.com
- Page Title: Test
### Snapshot
\`\`\`yaml
- button [ref=e1]
\`\`\``;

// Fixture: No snapshot section
const NO_SNAPSHOT_FIXTURE = `### Page
- Page URL: http://test.com
- Page Title: Test
### Events
- some event`;

// Fixture: No Page section
const NO_PAGE_FIXTURE = `### Ran Playwright code
\`\`\`js
await page.click('button');
\`\`\`
### Events
- clicked button`;

// Fixture: Empty snapshot YAML
const EMPTY_SNAPSHOT_FIXTURE = `### Page
- Page URL: http://test.com
- Page Title: Test
### Snapshot
\`\`\`yaml

\`\`\``;

describe("parsePlaywrightResponse", () => {
  it("parses old format (no Console line)", () => {
    const result = parsePlaywrightResponse(OLD_FORMAT_FIXTURE);
    expect(result).not.toBeNull();
    expect(result!.url).toBe("http://localhost:8090/workspaces/9/");
    expect(result!.title).toBe("Clay | Clay Starter Table");
    expect(result!.snapshotYaml).toContain("- generic [ref=e1]:");
    expect(result!.snapshotYaml).toContain('- button "logo" [ref=e9]');
  });

  it("parses new format (with Console line)", () => {
    const result = parsePlaywrightResponse(NEW_FORMAT_FIXTURE);
    expect(result).not.toBeNull();
    expect(result!.url).toBe(
      "http://localhost:8090/workspaces/9/workbooks/wb_0t7yf0aQsZAw5Kgsnfb"
    );
    expect(result!.title).toBe("Clay | Clay Starter Table");
    expect(result!.snapshotYaml).toContain("- generic [ref=e1]:");
    expect(result!.snapshotYaml).toContain('- link "Home" [ref=e10]');
  });

  it("parses new format with multiple extra lines", () => {
    const result = parsePlaywrightResponse(NEW_FORMAT_MULTI_LINE_FIXTURE);
    expect(result).not.toBeNull();
    expect(result!.url).toBe("http://example.com/");
    expect(result!.title).toBe("Example Page");
    expect(result!.snapshotYaml).toContain('- heading "Hello World" [ref=e1]');
  });

  it("parses minimal valid snapshot", () => {
    const result = parsePlaywrightResponse(MINIMAL_FIXTURE);
    expect(result).not.toBeNull();
    expect(result!.url).toBe("http://test.com");
    expect(result!.title).toBe("Test");
    expect(result!.snapshotYaml).toBe("- button [ref=e1]\n");
  });

  it("returns null for no snapshot section", () => {
    const result = parsePlaywrightResponse(NO_SNAPSHOT_FIXTURE);
    expect(result).toBeNull();
  });

  it("returns null for no Page section", () => {
    const result = parsePlaywrightResponse(NO_PAGE_FIXTURE);
    expect(result).toBeNull();
  });

  it("handles empty snapshot YAML", () => {
    const result = parsePlaywrightResponse(EMPTY_SNAPSHOT_FIXTURE);
    expect(result).not.toBeNull();
    expect(result!.snapshotYaml).toBe("\n");
  });

  it("fullMatch includes all content from Page through Snapshot", () => {
    const result = parsePlaywrightResponse(NEW_FORMAT_FIXTURE);
    expect(result).not.toBeNull();
    expect(result!.fullMatch).toContain("### Page");
    expect(result!.fullMatch).toContain("- Console: 18 errors, 8 warnings");
    expect(result!.fullMatch).toContain("### Snapshot");
    expect(result!.fullMatch).toContain("```yaml");
    expect(result!.fullMatch).toContain("```");
    // Should NOT include Events section
    expect(result!.fullMatch).not.toContain("### Events");
  });
});

describe("summarizeEvents", () => {
  it("collapses consecutive duplicate lines", () => {
    const input = `### Page
- Page URL: http://test.com
- Page Title: Test
### Events
- [LOG] same message
- [LOG] same message
- [LOG] same message
- [LOG] different message`;

    const result = summarizeEvents(input);
    expect(result).toContain("[repeated 3 times]");
    expect(result).toContain("- [LOG] different message");
  });

  it("preserves text without Events section", () => {
    const input = "### Page\n- Some content";
    const result = summarizeEvents(input);
    expect(result).toBe(input);
  });
});
