{
  description = "Tanikun development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "aarch64-darwin" "x86_64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      projectFor = system:
        let
          pkgs = import nixpkgs {
            inherit system;
            config.allowUnfreePredicate = package:
              nixpkgs.lib.getName package == "moonbit";
          };
          moonbit = pkgs.callPackage ./nix/moonbit.nix { };
          tools = [
            moonbit
            pkgs.nodejs_24
            pkgs.pnpm_10
            pkgs.just
            # The browser test uses nixpkgs' Playwright core and browsers so the
            # test never downloads a browser or writes outside the sandbox.
            pkgs.playwright
            pkgs.playwright-driver.browsers
          ];
        in
        { inherit pkgs moonbit tools; } // import ./nix/packages.nix { inherit pkgs moonbit; };
    in
    {
      packages = forAllSystems (system:
        let project = projectFor system;
        in {
          inherit (project) moonbit mooncakes pnpmDeps warren web api release;
          default = project.release;
        });

      devShells = forAllSystems (system:
        let project = projectFor system;
        in {
          default = project.pkgs.mkShell {
            packages = project.tools ++ [ project.pkgs.direnv ];
            shellHook = ''
              export MOON_HOME="$PWD/.direnv/moon"
              mkdir -p "$MOON_HOME/bin"
              export PATH="$MOON_HOME/bin:$PATH"
              export PLAYWRIGHT_CORE="${project.pkgs.playwright}"
              export PLAYWRIGHT_BROWSERS_PATH="${project.pkgs.playwright-driver.browsers}"
            '';
          };
        });

      checks = forAllSystems (system:
        let project = projectFor system;
        in {
          moonbit-js = project.api;
          web = project.web;
          release = project.pkgs.runCommand "tanikun-release-check" {
            nativeBuildInputs = [ project.pkgs.nodejs_24 ];
          } ''
            TANIKUN_RELEASE=${project.release} node --test ${./tests/integration/release.test.mjs}
            touch "$out"
          '';
        });
    };
}
