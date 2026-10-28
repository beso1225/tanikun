---
name: verify
description: Drive the Tanikun planner web UI in Chromium, exercise a real user journey, and capture screenshots. Use when verifying planner behavior after a change, checking a feature map journey, or debugging the built page without Workers or network access.
---

# Verify Tanikun in Chromium

Tanikun is a local-first MoonBit web app. This skill drives the built static
page directly. It does not use Workers, a network API, or internal setters.

## Launch

Build the static page from the repository root:

```sh
nix develop
just build-web
```

Ready means these files exist:

- `apps/web/dist/index.html`
- `apps/web/dist/index.js`
- `apps/web/dist/styles.css`

The driver starts its own loopback HTTP server for that directory, opens the
page in Chromium, and closes both before exiting. Do not start a second server
or reuse a long-lived page for a verification run.

## Doctor

Run this before driving when the build or Chromium environment is uncertain:

```sh
node .agents/skills/verify/scripts/doctor.mjs
```

It checks the three dist files, requires `PLAYWRIGHT_CORE`, launches Chromium,
serves the page, and waits for the app heading. It prints one JSON object and
exits nonzero on failure.

## Drive

The current proof journey is the timetable surface:

```sh
node .agents/skills/verify/scripts/drive.mjs timetable
```

It:

1. starts the static server from `tests/integration/planner-harness.mjs`
2. opens the four-tab planner with W grouped under A
3. checks the initial summary totals and accessibility audit
4. switches S1 to S2 and back
5. writes `.cache/verify/timetable.png`
6. closes the page, browser, and server

The feature map lists the other journeys and their stable selectors. Add a new
mode to `drive.mjs` before claiming a new feature is verified by this skill.

## Evidence

Proof artifacts go under `.cache/verify/`, which is git-ignored:

- successful journey: `.cache/verify/<feature>.png`
- failed journey: `.cache/verify/<feature>-failure.png` and
  `.cache/verify/<feature>-failure-trace.zip`

The Playwright browser regression test uses the same failure artifact paths for
the Phase 2 journey. Evidence is never deleted by cleanup.

## Cleanup

Every driver closes its loopback server, browser, and page in `finally`.
Never kill processes by name. If a run is interrupted, close only the
browser/server started by that run; do not delete `.cache/verify/`.

## Helpers

- `scripts/doctor.mjs` — read-only environment and page health check.
- `scripts/drive.mjs` — timetable journey and screenshot capture.
- [`tests/integration/planner-harness.mjs`](../../../tests/integration/planner-harness.mjs)
  — shared static server, accessibility audit, and summary assertions.
- `features/README.md` — feature map index.

## Proof

Executed on 2026-10-28:

```sh
nix develop -c node .agents/skills/verify/scripts/doctor.mjs
nix develop -c node .agents/skills/verify/scripts/drive.mjs timetable
test -s .cache/verify/timetable.png
```

The screenshot existed after the driver closed its server and browser.
