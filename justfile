default:
    @just --list

# Check formatting and types for the JavaScript target.
check:
    moon fmt --check
    moon check --target js --deny-warn

# Run all linters and format checks. Requires `pnpm install` for oxlint/oxfmt.
lint: check
    nixfmt --check flake.nix nix/*.nix
    statix check .
    deadnix --fail .
    just --fmt --check
    pnpm exec oxlint --deny-warnings
    pnpm exec oxfmt --check
    editorconfig-checker
    markdownlint-cli2 "**/*.md"
    node scripts/check-message-catalog.mjs
    node scripts/check-deployment-config.mjs
    stylelint "apps/web/styles/**/*.css"
    actionlint
    zizmor .

# Apply all formatters.
fmt:
    moon fmt
    nixfmt flake.nix nix/*.nix
    just --fmt
    pnpm exec oxfmt

# Build the MoonBit ES module; this is not yet a deployable Worker.
build:
    moon build --target js --release --deny-warn

# Test MoonBit code and the generated JavaScript export.
test: build
    moon test --target js --deny-warn \
        -p beso1225/tanikun-api \
        -p beso1225/tanikun-domain \
        -p beso1225/tanikun-requirements \
        -p beso1225/tanikun-web/app \
        -p beso1225/tanikun-web/cmd/browser
    node --test tests/integration/moonbit-export.test.mjs tests/integration/parse-jsonc.test.mjs tests/integration/deployment-config.test.mjs
    node --test tests/integration/planner-record-reader.test.mjs tests/integration/planner-document.test.mjs tests/integration/persistence.test.mjs tests/integration/auth-client.test.mjs tests/integration/auth-state.test.mjs tests/integration/auth-persistence.test.mjs tests/integration/sync-transport.test.mjs tests/integration/sync-coordinator.test.mjs tests/integration/sync-account-fence.test.mjs

# Apply versioned sync migrations to the local D1 database only.
migrate-local:
    XDG_CONFIG_HOME="$PWD/.cache/wrangler-config" WRANGLER_LOG_PATH=.wrangler/logs pnpm exec wrangler d1 migrations apply tanikun-local --local --config wrangler.jsonc

# Serve the API with local workerd; Wrangler rebuilds MoonBit on changes.
dev-api:
    WRANGLER_LOG_PATH=.wrangler/logs pnpm exec wrangler dev --local --config wrangler.jsonc \
        --var AUTH_MODE:dev_bearer --var APP_ENV:local --var DEV_AUTH:true \
        --var 'DEV_AUTH_IDENTITIES:{"local-fixture-token-alice":"dev-alice","local-fixture-token-bob":"dev-bob"}'

# Exercise HTTP against Wrangler's local Workers runtime.
# Keep Wrangler's registry and cache inside the ignored build directory.
test-worker:
    XDG_CONFIG_HOME="$PWD/.cache/wrangler-config" XDG_CACHE_HOME="$PWD/.cache/wrangler-cache" node --test tests/integration/worker-http.test.mjs

# Install the Warren version compatible with the pinned MoonBit toolchain.
setup-web:
    moon install moonbit-community/warren@0.4.4

# Build CSS and preview the page with Tailwind/Warren watchers.
dev-web: build-automerge
    just build-sync-contract apps/web/public
    node scripts/dev-web.mjs

# Generate the stylesheet Warren copies from public/.
build-css:
    pnpm exec tailwindcss -i apps/web/styles/input.css -o apps/web/public/styles.css --minify

# Verify that Tailwind extracts classes from MoonBit sources.
test-css:
    node --test tests/integration/tailwind.test.mjs

# Copy the pinned, self-contained browser Automerge bundle without a CDN.
build-automerge public_dir="apps/web/public":
    cp node_modules/@automerge/automerge/dist/iife/iife.js "{{ public_dir }}/automerge.js"
    cp node_modules/@automerge/automerge/LICENSE "{{ public_dir }}/automerge.LICENSE.txt"

# Copy the shared sync contract module into the browser artifact.
build-sync-contract output_dir="apps/web/dist":
    node scripts/build-sync-contract.mjs "{{ output_dir }}/sync-contract.mjs"

# Build static browser assets into apps/web/dist.
build-web: build-css build-automerge
    warren -C apps/web build
    just build-sync-contract

# Verify the built page in Chromium; run inside `nix develop` for Playwright.
# Set TANIKUN_WEB_DIST to test an already built directory instead of dist.
test-browser: build-web
    moon run scripts/build-allocation-fixture.mbtx
    node --test tests/integration/browser-allocations.test.mjs
    just test-browser-built

# Test existing browser assets without requiring the source build tools.
test-browser-built:
    node --test --test-timeout=60000 tests/integration/browser-display.test.mjs tests/integration/browser.test.mjs tests/integration/browser-phase2.test.mjs tests/integration/browser-persistence.test.mjs tests/integration/browser-persistence-convergence.test.mjs tests/integration/browser-sync-status.test.mjs tests/integration/auth-stale-status.test.mjs tests/integration/auth-rate-status.test.mjs tests/integration/auth-stale-logout.test.mjs tests/integration/auth-credentials.test.mjs tests/integration/auth-credential-faults.test.mjs

# Build both source artifacts unless both packaged roots are supplied.
_sync-artifacts:
    @if [ -n "${TANIKUN_WEB_DIST:-}" ] && [ -n "${TANIKUN_API_DIST:-}" ]; then \
        echo "Using prebuilt TANIKUN_WEB_DIST and TANIKUN_API_DIST"; \
    elif [ -z "${TANIKUN_WEB_DIST:-}" ] && [ -z "${TANIKUN_API_DIST:-}" ]; then \
        just build-web && \
        just build; \
    else \
        echo "TANIKUN_WEB_DIST and TANIKUN_API_DIST must be set together" >&2; \
        exit 2; \
    fi

# Run the Phase 4 dev-bearer convergence and fault suites against a real local
# Worker and D1. Set both TANIKUN_WEB_DIST and TANIKUN_API_DIST to reuse
# packaged artifacts.
test-sync: _sync-artifacts
    node --test --test-concurrency=1 --test-timeout=180000 tests/integration/sync-harness.test.mjs tests/integration/sync-harness-lifecycle.test.mjs tests/integration/packaged-api.test.mjs tests/integration/justfile.test.mjs tests/integration/sync-api-faults.test.mjs tests/integration/sync-journey.test.mjs tests/integration/sync-convergence.test.mjs tests/integration/sync-browser-faults.test.mjs

# Run the Phase 5 real passkey-session proof against a local Worker and D1. Set
# both TANIKUN_WEB_DIST and TANIKUN_API_DIST for self-contained Nix artifacts.
test-session-proof: _sync-artifacts
    node --test --test-concurrency=1 --test-timeout=240000 tests/integration/session-sync-packaged.test.mjs tests/integration/webauthn-packaged.test.mjs tests/integration/session-account-journey.test.mjs tests/integration/session-credential-journey.test.mjs tests/integration/session-replica-proof.test.mjs tests/integration/session-account-proof.test.mjs tests/integration/session-auth-faults.test.mjs tests/integration/session-response-loss.test.mjs tests/integration/session-failure-evidence.test.mjs

# Serve the isolated local PRF physical probe on https://localhost:4300.
# It serves only the probe page and never creates a credential until a human
# clicks a step. Run inside `nix develop`.
prf-probe:
    node tools/prf-probe/server.mjs

# Verify the isolated PRF probe with synthetic stubs, without a real passkey.
# Needs port 4300 and `nix develop` for Playwright.
test-prf-probe:
    node --test --test-timeout=60000 tests/integration/prf-probe-core.test.mjs tests/integration/prf-probe-server.test.mjs
    node --test --test-timeout=120000 tests/integration/prf-probe-page.test.mjs

# Verify Automerge core, change exchange, and IndexedDB through MoonBit FFI.
test-automerge: build
    moon test --target js -p beso1225/tanikun-automerge-spike
    node --test tests/integration/automerge-ffi.test.mjs

# Verify the Workers Vitest plugin with a local D1 binding.
test-d1: build
    XDG_CONFIG_HOME="$PWD/.cache/wrangler-config" WRANGLER_LOG_PATH=.wrangler/logs pnpm exec vitest run --config vitest.config.mts

# Install the mutation-testing tool inside `nix develop` (network required).
turtles_version := "0.4.5"
setup-mutation:
    moon install f4ah6o/turtles/cmd/turtles@{{ turtles_version }}

# Run mutation testing inside `nix develop`; not a CI gate yet.
mutate:
    @command -v turtles >/dev/null || (echo "run: just setup-mutation" >&2; exit 1)
    turtles --dir packages/domain --target js --jobs 2 --fail-under 0 --json .cache/turtles-domain.json
    node scripts/mutate-requirements.mjs
