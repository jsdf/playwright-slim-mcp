// Test fixtures for integration tests

// A small snapshot (< 500 chars) that should pass through unchanged
export const smallSnapshot = `### Page
- Page URL: https://example.com
- Page Title: Simple Page
### Snapshot
\`\`\`yaml
- heading "Welcome" [ref=h1]
- button "Submit" [ref=btn1]
- link "Home" [ref=link1]
\`\`\``;

// A large snapshot (> 500 chars) that should be summarized
export const largeSnapshot = `### Page
- Page URL: https://example.com/dashboard
- Page Title: User Dashboard - My Application
### Snapshot
\`\`\`yaml
- banner:
  - heading "My Application" [level=1]
  - navigation:
    - link "Home" [ref=nav-home]
    - link "Dashboard" [ref=nav-dash]
    - link "Settings" [ref=nav-settings]
    - link "Profile" [ref=nav-profile]
    - link "Logout" [ref=nav-logout]
- main:
  - heading "Welcome back, John!" [level=2]
  - region "Statistics":
    - text "Total Projects: 42"
    - text "Active Tasks: 17"
    - text "Completed: 156"
  - region "Recent Activity":
    - list:
      - listitem "Created new project 'Website Redesign'" [ref=activity-1]
      - listitem "Completed task 'Update documentation'" [ref=activity-2]
      - listitem "Added comment on 'Bug fix #234'" [ref=activity-3]
      - listitem "Assigned to 'Feature request #567'" [ref=activity-4]
      - listitem "Closed issue 'Performance optimization'" [ref=activity-5]
  - region "Quick Actions":
    - button "New Project" [ref=btn-new-project]
    - button "Create Task" [ref=btn-new-task]
    - button "View Reports" [ref=btn-reports]
    - button "Export Data" [ref=btn-export]
  - table "Projects":
    - row:
      - cell "Website Redesign"
      - cell "In Progress"
      - button "Edit" [ref=edit-1]
      - button "Delete" [ref=del-1]
    - row:
      - cell "Mobile App"
      - cell "Planning"
      - button "Edit" [ref=edit-2]
      - button "Delete" [ref=del-2]
    - row:
      - cell "API Integration"
      - cell "Complete"
      - button "Edit" [ref=edit-3]
      - button "Delete" [ref=del-3]
- footer:
  - link "Privacy Policy" [ref=footer-privacy]
  - link "Terms of Service" [ref=footer-terms]
  - link "Contact Us" [ref=footer-contact]
\`\`\``;

// Text without a snapshot pattern
export const noSnapshotText = `This is just some regular text without any page snapshot.
It should pass through completely unchanged.`;

// Text with prefix and suffix around the snapshot
export const snapshotWithContext = `Tool executed successfully.

${largeSnapshot}

Additional information about the page interaction.`;

// Events section with repeated lines
export const eventsWithRepeats = `### Events
- [LOG] MOCKED: Segment tracked "Exp Assignment" wit...js?v=78a91138:7431
- [LOG] MOCKED: Segment tracked "Exp Assignment" wit...js?v=78a91138:7431
- [LOG] MOCKED: Segment tracked "Exp Assignment" wit...js?v=78a91138:7431
- [LOG] MOCKED: Segment tracked "Exp Assignment" wit...js?v=78a91138:7431
- [LOG] MOCKED: Segment tracked "Exp Assignment" wit...js?v=78a91138:7431
- [LOG] MOCKED: Segment tracked "Command Center Open"...js?v=78a91138:7431
- [ERROR] Warning: validateDOMNesting(...): %s canno...js?v=78a91138:7431`;

// Events section without repeats
export const eventsNoRepeats = `### Events
- [LOG] First message
- [LOG] Second message
- [ERROR] Some error`;

// Full response with both snapshot and events
export const fullResponseWithEvents = `### Ran Playwright code
await page.click();
${smallSnapshot}
${eventsWithRepeats}`;
