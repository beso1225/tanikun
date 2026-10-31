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

Set `TANIKUN_WEB_DIST` to drive packaged assets instead of the default dist.
Linux CI runs doctor and all mapped journeys against its Nix-built web output.

Ready means these files exist:

- `apps/web/dist/index.html`
- `apps/web/dist/index.js`
- `apps/web/dist/styles.css`
- `apps/web/dist/automerge.js`
- `apps/web/dist/planner-document.js`
- `apps/web/dist/persistence.js`

The driver starts its own loopback HTTP server for that directory, opens the
page in Chromium, and closes both before exiting. Do not start a second server
or reuse a long-lived page for a verification run.

## Doctor

Run this before driving when the build or Chromium environment is uncertain:

```sh
node .agents/skills/verify/scripts/doctor.mjs
```

It checks the dist files above, requires `PLAYWRIGHT_CORE`, launches Chromium,
serves the page, and waits for the app heading. It prints one JSON object and
exits nonzero on failure.

## Drive

Run one live path for each mapped feature in one owned browser and server:

```sh
nix develop -c node .agents/skills/verify/scripts/doctor.mjs
nix develop -c node .agents/skills/verify/scripts/drive.mjs all
```

Pass a feature filename stem instead of `all` to isolate a failure. Supported
modes are `timetable`, `enrollment-status`, `custom-courses`, `overrides`, and
`summary-profile-year`. Each mode clears the persisted planner document from
IndexedDB and reloads, because Phase 3 restores local edits after reload. It then
waits for hydration before asserting the seed. The map also lists extended
checks; a mode proves its executed path, not every sub-feature. Run `nix develop -c just test-browser` for broader
regression coverage. Timetable also checks 390px overflow and keyboard dismissal
with focus restoration.

Run doctor before first drive and after failure. Failed runs close their owned
instances in `finally`; start a fresh mode after doctor succeeds. Inspect
screenshots for visual changes and use a separate exploratory browser session
when needed. Do not mutate the user's existing planner to obtain evidence.

## Evidence

Proof artifacts go under `.cache/verify/`, which is git-ignored:

- successful journey: `.cache/verify/<feature>.png` and `<mode>-trace.zip`
  with actions and resulting states
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
- `scripts/drive.mjs` — mapped journeys, traces, and screenshots.
- [`tests/integration/planner-harness.mjs`](../../../tests/integration/planner-harness.mjs)
  — shared static server, accessibility audit, and summary assertions.
- `features/README.md` — feature map index.

## Proof

Check that evidence survives teardown:

```sh
nix develop -c node .agents/skills/verify/scripts/doctor.mjs
nix develop -c node .agents/skills/verify/scripts/drive.mjs all
for feature in timetable enrollment-status custom-courses overrides summary-profile-year; do
  test -s ".cache/verify/$feature.png" || exit 1
done
test -s .cache/verify/all-trace.zip
```

All five screenshots and the action trace must remain after the driver closes
its server and browser.

## Accessibility limits

DOM audits and Chromium keyboard checks do not prove spoken announcements or
Safari behavior. Manual screen-reader evidence belongs to issue #103. Record
browser, assistive technology, actions, and observed speech before claiming it
passed.
