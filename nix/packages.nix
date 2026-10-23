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
      ../apps/web/moon.mod
      ../apps/web/public/index.html
      ../apps/web/styles
      ../packages
      ../scripts
      ../tests/integration
      ../spikes
      ../moon.work
      ../justfile
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
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
        "sha256-D0ORisgfIjG5o43eI2hsMEriyNsv33dk5SxulPo6xaw="
      else
        "sha256-MShHKMGDGBgq5xmOfLILYEBUNPa6CVnJO94C4qLb66E=";
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
      moon test --frozen --target js --deny-warn -p beso1225/tanikun-web/app
      moon build --frozen --target js --release --deny-warn
      node --test tests/integration/moonbit-export.test.mjs tests/integration/tailwind.test.mjs
    '';
    installPhase = ''
      mkdir -p "$out"
      cp -R apps/web/dist/. "$out/"
    '';
  };
  api = pkgs.stdenvNoCC.mkDerivation {
    pname = "tanikun-api";
    version = "0.1.0";
    inherit src;
    nativeBuildInputs = [
      moonbit
      pkgs.nodejs_24
    ];
    configurePhase = prepareMoon;
    buildPhase = "moon build --frozen --target js --release --deny-warn";
    doCheck = true;
    checkPhase = ''
      moon fmt --check
      moon check --frozen --target js --deny-warn
      moon test --frozen --target js --deny-warn -p beso1225/tanikun-api
      node --test tests/integration/moonbit-export.test.mjs
    '';
    # Keep the bridge's relative import intact; no npm/runtime dependency is needed.
    installPhase = ''
      mkdir -p "$out/apps/api/bridges" "$out/_build/js/release/build/beso1225/tanikun-api"
      cp apps/api/bridges/worker.mjs "$out/apps/api/bridges/"
      cp _build/js/release/build/beso1225/tanikun-api/tanikun-api.js "$out/_build/js/release/build/beso1225/tanikun-api/"
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
