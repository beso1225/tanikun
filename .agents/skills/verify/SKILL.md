---
name: verify
description: Drive the Tanikun planner web UI in Chromium, exercise a real user journey, verify local persistence reload recovery, and capture screenshots. Use when verifying planner behavior after a change, checking a feature map journey, or debugging the built page without Workers or network access.
---

# Verify Tanikun in Chromium

Tanikun is a local-first MoonBit web app. This skill drives the built static
page directly, including its IndexedDB persistence. It does not use Workers, a
network API, or internal setters.

Configured sync status, outbox, network, convergence, and fault verification
belong to the sibling `tanikun-sync-change` skill at
`../tanikun-sync-change/SKILL.md`. The static page can show `同期未設定`; that
does not prove HTTP sync.

## Launch

Build the static page from the repository root:

```sh
nix develop
pnpm install --frozen-lockfile
just setup-web          # install the repository-pinned Warren when absent
just build-web
```

Set `TANIKUN_WEB_DIST` to drive packaged assets instead of the default dist.
Linux CI runs doctor and all mapped journeys against its Nix-built web output.

Ready means these files exist:

- `apps/web/dist/index.html`
- `apps/web/dist/index.js`
- `apps/web/dist/automerge.js`
- `apps/web/dist/planner-document.js`
- `apps/web/dist/persistence-transactions.js`
- `apps/web/dist/persistence.js`
- `apps/web/dist/sync-store.js`
- `apps/web/dist/sync-metadata.js`
- `apps/web/dist/sync-coordinator.js`
- `apps/web/dist/sync-shell.js`
- `apps/web/dist/sync-transport.js`
- `apps/web/dist/sync-contract.mjs`
- `apps/web/dist/styles.css`

The driver starts its own loopback HTTP server for that directory, opens the
page in Chromium, and closes both before exiting. Do not start a second server
or reuse a long-lived page for a verification run.

## Doctor

Run this before driving when the build or Chromium environment is uncertain:

```sh
node .agents/skills/verify/scripts/doctor.mjs
```

It checks the dist files above, requires `PLAYWRIGHT_CORE`, launches Chromium,
serves the page, and waits for the app heading, saved persistence status, and
unconfigured sync status. Browser page or console errors fail the check. It
prints one JSON object and exits nonzero on failure.

## Drive

Run one live path for each mapped feature in one owned browser and server:

```sh
nix develop -c node .agents/skills/verify/scripts/doctor.mjs
nix develop -c node .agents/skills/verify/scripts/drive.mjs all
```

Pass a feature filename stem instead of `all` to isolate a failure. Supported
modes are `timetable`, `enrollment-status`, `custom-courses`, `overrides`,
`summary-profile-year`, and `local-persistence`. Each mode clears the persisted
planner document from IndexedDB and reloads, because Phase 3 restores local edits
after reload. It then waits for hydration before asserting the seed.

`local-persistence` adds the save-status and reload path: it observes the
user-visible `#persistence-status` labels, adds an offering, waits for a
non-saved label and then `保存済み`, and reloads to prove the edit survives. It
does not read `globalThis.tanikunStorage` or committed bytes.

The map lists extended checks; a mode proves its executed path, not every
sub-feature. Run `nix develop -c just test-browser` for broader regression
coverage. Timetable also checks 390px overflow, keyboard dismissal with focus
restoration, status badges, and A1/A2 winter grouping.

Configured sync status, outbox, network, convergence, and fault verification
are not part of `drive.mjs all`. Use the sibling `tanikun-sync-change` skill
and `just test-sync`.

Run doctor before first drive and after failure. Failed runs close their owned
instances in `finally`; start a fresh mode after doctor succeeds. Inspect
screenshots for visual changes and use a separate exploratory browser session
when needed. Do not mutate the user's existing planner to obtain evidence.

## Evidence

Proof artifacts go under `.cache/verify/`, which is git-ignored:

- successful journey: `.cache/verify/<feature>.png` for each executed feature
  and `.cache/verify/<mode>-trace.zip` with actions and resulting states
- failed journey: `.cache/verify/<mode>-failure.png` and
  `.cache/verify/<mode>-failure-trace.zip`

`<mode>` is the requested feature stem or `all`. An `all` run keeps six
screenshots and one combined `all-trace.zip`.

The Playwright browser regression test uses the same failure artifact paths for
the Phase 2 journey. Evidence is never deleted by cleanup.

Sync evidence under `.cache/verify/sync/` belongs to the sibling sync skill and
`just test-sync`, not this static driver.

## Cleanup

Every driver closes its loopback server, browser, and page in `finally`.
Never kill processes by name. If a run is interrupted, close only the
browser/server started by that run; do not delete `.cache/verify/`.

## Helpers

- `scripts/doctor.mjs` — read-only static build and page health check.
- `scripts/drive.mjs` — mapped static journeys, traces, and screenshots.
- [`tests/integration/planner-harness.mjs`](../../../tests/integration/planner-harness.mjs)
  — shared static server, accessibility audit, and summary assertions.
- `features/README.md` — feature map index and extended coverage.

## Proof

Check that evidence survives teardown:

```sh
nix develop -c node .agents/skills/verify/scripts/doctor.mjs
nix develop -c node .agents/skills/verify/scripts/drive.mjs all
for feature in timetable enrollment-status custom-courses overrides summary-profile-year local-persistence; do
  test -s ".cache/verify/$feature.png" || exit 1
done
test -s .cache/verify/all-trace.zip
```

All six screenshots and the action trace must remain after the driver closes
its server and browser.

## Accessibility limits

DOM audits and Chromium keyboard checks do not prove spoken announcements or
Safari behavior. Manual screen-reader evidence belongs to issue #103. Record
browser, assistive technology, actions, and observed speech before claiming it
passed.
