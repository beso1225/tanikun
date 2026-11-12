{ pkgs, moonbit }:
let
  inherit (pkgs) lib;
  mooncakes = pkgs.callPackage ./mooncakes.nix { };
  # Sandboxed builds keep nixpkgs Node/pnpm; interactive shells use fnm and
  # corepack from .node-version instead.
  pnpm = pkgs.pnpm_12;
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../apps/api
      ../apps/web/app
      ../apps/web/cmd
      ../apps/web/fixtures
      ../apps/web/moon.mod
      ../apps/web/public/index.html
      ../apps/web/public/persistence-transactions.js
      ../apps/web/public/persistence.js
      ../apps/web/public/planner-document.js
      ../apps/web/public/sync-coordinator.js
      ../apps/web/public/sync-metadata.js
      ../apps/web/public/sync-shell.js
      ../apps/web/public/sync-store.js
      ../apps/web/public/sync-transport.js
      ../apps/web/styles
      ../docs/contracts
      ../packages
      ../scripts
      ../tests/integration
      ../spikes
      ../moon.work
      ../justfile
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
      ../wrangler.jsonc
    ];
  };
  pnpmDeps = pkgs.fetchPnpmDeps {
    pname = "tanikun";
    inherit pnpm;
    src = lib.fileset.toSource {
      root = ../.;
      fileset = lib.fileset.unions [
        ../package.json
        ../pnpm-lock.yaml
        ../pnpm-workspace.yaml
      ];
    };
    fetcherVersion = 4;
    # fetcherVersion 4 keeps only the current platform's optional packages in
    # the store, so each supported system needs its own fixed-output hash.
    # Regenerate both hashes after dependency changes.
    hash =
      if pkgs.stdenv.hostPlatform.isDarwin then
        "sha256-MZcco9Wpz9r0fnQMpU0UEkpkJ3WDVY90cBLPVujcIDY="
      else
        "sha256-3MmZgZO6Q0H15Vpc+FcXbTJSTG4TQZ624pfF7Xi2ERE=";
  };
  prepareMoon = ''
    export HOME="$TMPDIR/home"
    export MOON_HOME="$TMPDIR/moon-home"
    mkdir -p "$HOME" "$MOON_HOME"
    cp -R ${mooncakes}/registry "$MOON_HOME/registry"
    chmod -R u+w "$MOON_HOME"
    cp -R ${mooncakes}/sources .mooncakes
    chmod -R u+w .mooncakes
  '';
  warren = pkgs.stdenv.mkDerivation {
    pname = "warren";
    version = "0.4.4";
    src = "${mooncakes}/sources/moonbit-community/warren";
    nativeBuildInputs = [ moonbit ];
    postUnpack = ''chmod -R u+w "$sourceRoot"'';
    configurePhase = prepareMoon;
    buildPhase = ''
      runHook preBuild
      moon build --frozen --target native --release
      runHook postBuild
    '';
    installPhase = ''
      mkdir -p "$out/bin"
      cp _build/native/release/build/warren.exe "$out/bin/warren"
    '';
  };
  web = pkgs.stdenvNoCC.mkDerivation {
    pname = "tanikun-web";
    version = "0.1.0";
    inherit src pnpmDeps;
    nativeBuildInputs = [
      moonbit
      warren
      pkgs.nodejs_24
      pnpm
      pkgs.pnpmConfigHook
      pkgs.just
    ];
    preConfigure = prepareMoon;
    buildPhase = ''
      runHook preBuild
      just build-web
      runHook postBuild
    '';
    doCheck = true;
    checkPhase = ''
      moon fmt --check
      moon check --frozen --target js --deny-warn
      moon test --frozen --target js --deny-warn -p beso1225/tanikun-web/app -p beso1225/tanikun-web/cmd/browser
      moon build --frozen --target js --release --deny-warn
      node --test tests/integration/planner-record-reader.test.mjs tests/integration/moonbit-export.test.mjs tests/integration/tailwind.test.mjs tests/integration/planner-document.test.mjs tests/integration/persistence.test.mjs tests/integration/sync-transport.test.mjs tests/integration/sync-coordinator.test.mjs
    '';
    installPhase = ''
      mkdir -p "$out"
      cp -R apps/web/dist/. "$out/"
    '';
  };
  api = pkgs.stdenvNoCC.mkDerivation {
    pname = "tanikun-api";
    version = "0.1.0";
    inherit src pnpmDeps;
    nativeBuildInputs = [
      moonbit
      pkgs.nodejs_24
      pnpm
      pkgs.pnpmConfigHook
    ];
    configurePhase = prepareMoon;
    buildPhase = "moon build --frozen --target js --release --deny-warn";
    doCheck = true;
    checkPhase = ''
      moon fmt --check
      moon check --frozen --target js --deny-warn
      moon test --frozen --target js --deny-warn -p beso1225/tanikun-api
      node --test tests/integration/moonbit-export.test.mjs tests/integration/parse-jsonc.test.mjs
    '';
    # Keep the bridge's relative imports intact. The #176 WebAuthn spike
    # verifier is bundled separately so the release artifact can prove the
    # library's offline closure without enabling a product route. Include every
    # production module, migration, and a runtime config that does not depend
    # on the source tree's Moon project. The source config keeps its build/watch
    # hooks for local development; the packaged copy strips them and the missing
    # schema path so Wrangler can start inside the Nix output.
    installPhase = ''
      mkdir -p "$out/apps/api/bridges" "$out/apps/api/http" "$out/apps/api/repositories" "$out/apps/api/migrations" "$out/apps/api/webauthn" "$out/packages/sync-contract" "$out/_build/js/release/build/beso1225/tanikun-api"
      cp apps/api/bridges/*.mjs "$out/apps/api/bridges/"
      cp apps/api/http/*.mjs "$out/apps/api/http/"
      cp apps/api/repositories/*.mjs "$out/apps/api/repositories/"
      cp apps/api/migrations/*.sql "$out/apps/api/migrations/"
      cp packages/sync-contract/contract.mjs "$out/packages/sync-contract/"
      cp _build/js/release/build/beso1225/tanikun-api/tanikun-api.js "$out/_build/js/release/build/beso1225/tanikun-api/"
      pnpm exec esbuild apps/api/webauthn/verify.mjs \
        --bundle \
        --format=esm \
        --platform=browser \
        --target=es2022 \
        --outfile="$out/apps/api/webauthn/verify.js"
      node --input-type=module <<'NODE'
      import { readFileSync, writeFileSync } from "node:fs";
      import { parseJsonc } from "./scripts/parse-jsonc.mjs";
      const config = parseJsonc(readFileSync("wrangler.jsonc", "utf8"));
      delete config.build;
      delete config.watch_dir;
      delete config.$schema;
      writeFileSync(
        process.env.out + "/wrangler.jsonc",
        JSON.stringify(config, null, 2) + "\n",
      );
      NODE
    '';
  };
  pure = pkgs.stdenvNoCC.mkDerivation {
    pname = "tanikun-pure";
    version = "0.1.0";
    inherit src;
    nativeBuildInputs = [
      moonbit
      pkgs.nodejs_24
    ];
    configurePhase = prepareMoon;
    buildPhase = "moon build --frozen --target js --release --deny-warn packages/domain packages/requirements";
    doCheck = true;
    checkPhase = ''
      moon fmt --check
      moon check --frozen --target js --deny-warn packages/domain packages/requirements
      moon test --frozen --target js --deny-warn -p beso1225/tanikun-domain -p beso1225/tanikun-requirements
    '';
    installPhase = ''
      mkdir -p "$out"
      touch "$out/checked"
    '';
  };
  release = pkgs.runCommand "tanikun-release-0.1.0" { } ''
    mkdir -p "$out"
    ln -s ${web} "$out/web"
    ln -s ${api} "$out/api"
  '';
in
{
  inherit
    mooncakes
    pnpmDeps
    warren
    web
    api
    pure
    release
    ;
}
