---
summary: "Living project registry and rolling recent activity log"
read_when:
  - Every main session
---

# MEMORY.md - Living Memory

_This file is fully rewritten on every compaction. It holds: (1) current active projects, and (2) a rolling 7-day activity log. Entries older than 7 days are dropped from here — they live in the daily logs._

## Active Projects

| Project | Description | Folder | Channel |
|---------|-------------|--------|---------|
| | | | |

_(One row per project. Keep descriptions short. Add Discord/channel IDs when relevant.)_

## Recent Activity

_Rolling 7-day log. Format: `[DATE TIME] (Project): task description`. Drop entries older than 7 days on each rewrite._

<!-- Example:
[2026-02-26 14:30] (investment-research): Completed 10-step master-research run on IONQ/RGTI/NVTS, posted final report to #investment-research
[2026-02-25 09:00] (LiveCase): Improved Playwright tests for AI chat grading
-->

## Notes & Context

_(Catch-all for anything worth remembering that doesn't fit the above — decisions made, things to follow up on, ongoing threads.)_
