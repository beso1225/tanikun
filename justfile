default:
    @just --list

# Check formatting and types for the JavaScript target.
check:
    moon fmt --check
    moon check --target js --deny-warn

# Build the MoonBit ES module; this is not yet a deployable Worker.
build:
    moon build --target js --release --deny-warn

# Test MoonBit code and the generated JavaScript export.
test: build
    moon test --target js --deny-warn -p beso1225/tanikun-api -p beso1225/tanikun-web/app
    node --test tests/integration/moonbit-export.test.mjs

# Serve the API with local workerd; Wrangler rebuilds MoonBit on changes.
dev-api:
    WRANGLER_LOG_PATH=.wrangler/logs pnpm exec wrangler dev --local --config wrangler.jsonc

# Exercise HTTP against Wrangler's local Workers runtime.
# Keep Wrangler's registry and cache inside the ignored build directory.
test-worker:
    XDG_CONFIG_HOME="$PWD/.cache/wrangler-config" XDG_CACHE_HOME="$PWD/.cache/wrangler-cache" node --test tests/integration/worker-http.test.mjs

# Install the Warren version compatible with the pinned MoonBit toolchain.
setup-web:
    moon install moonbit-community/warren@0.4.4

# Build CSS and preview the page with Tailwind/Warren watchers.
dev-web:
    node scripts/dev-web.mjs

# Generate the stylesheet Warren copies from public/.
build-css:
    pnpm exec tailwindcss -i apps/web/styles/input.css -o apps/web/public/styles.css --minify

# Verify that Tailwind extracts classes from MoonBit sources.
test-css:
    node --test tests/integration/tailwind.test.mjs

# Build static browser assets into apps/web/dist.
build-web: build-css
    warren -C apps/web build

# Verify the built page in Chromium; run inside `nix develop` for Playwright.
# Set TANIKUN_WEB_DIST to test an already built directory instead of dist.
test-browser: build-web
    node --test tests/integration/browser.test.mjs

# Verify Automerge core, change exchange, and IndexedDB through MoonBit FFI.
test-automerge: build
    moon test --target js -p beso1225/tanikun-automerge-spike
    node --test tests/integration/automerge-ffi.test.mjs

# Verify the Workers Vitest plugin with a local D1 binding.
test-d1:
    XDG_CONFIG_HOME="$PWD/.cache/wrangler-config" WRANGLER_LOG_PATH=.wrangler/logs pnpm exec vitest run --config vitest.config.mts
