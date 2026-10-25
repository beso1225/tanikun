---
name: tanikun-toolchain-update
description: "Update Tanikun toolchain pins for MoonBit, Node.js, pnpm, Warren, Nix actions, or the mooncakes source closure. Use when a version update needs hashes, lockfile changes, and full CI verification."
---

# Tanikun toolchain update

Use this skill for a version update. Keep the update in its own pull request. Do
not mix it with a feature or a behavior change.

## Find every pin

| Tool      | Files                                                                                         |
| --------- | --------------------------------------------------------------------------------------------- |
| MoonBit   | `nix/moonbit.nix` version, distribution hashes, core hash                                     |
| Node.js   | `.node-version`, `.github/workflows/ci.yml` setup and cache key                               |
| pnpm      | `package.json` `packageManager`, CI corepack step and cache key, `nix/packages.nix` `pnpm_12` |
| Warren    | `nix/packages.nix` version, `nix/mooncakes-lock.json` entry, `justfile` `setup-web`           |
| mooncakes | `nix/mooncakes-lock.json`, `nix/mooncakes.nix`                                                |
| turtles   | `justfile` `turtles_version`                                                                  |
| nixpkgs   | `flake.lock`                                                                                  |

Search for the old version before editing. A missed pin causes a split toolchain.

## Before changing anything

- Read the upstream release note for the tool.
- Check compatibility between MoonBit, Warren, and turtles. Do not assume the
  newest turtles works with the pinned MoonBit.
- Keep both `aarch64-darwin` and `x86_64-linux` hashes.
- Keep the core bundle hash separate from the compiler distribution hash.

## MoonBit

1. Update `version` in `nix/moonbit.nix`.
2. Update the two distribution hashes and the core hash.
3. Let Nix report the expected hash when the old one fails:

   ```sh
   nix build path:.#moonbit --no-link
   ```

4. Copy the hash from the error, not from an unrelated platform.
5. Run the pure build and tests.

If the update changes MoonBit syntax, warnings, or the standard library, update
code and tests in a separate commit. Run `tanikun-mutation-refresh` after the
toolchain is stable.

## Node.js and pnpm

1. Update `.node-version`.
2. Update `packageManager` in `package.json`.
3. Update the CI cache key and corepack prepare version.
4. Update `nix/packages.nix` only when the nixpkgs pnpm package must change.
5. Run:

```sh
pnpm install --frozen-lockfile
just test
just lint
```

Do not install Node.js or pnpm globally to make a local command work.

## Mooncakes and Warren

1. Update `nix/mooncakes-lock.json`.
2. Keep the archive checksums.
3. Update the Warren version in `nix/packages.nix`, `nix/mooncakes-lock.json`, and `justfile`
   together.
4. Build the closure:

```sh
nix build path:.#mooncakes --no-link
nix build path:.#warren --no-link
```

## Verify

```sh
nix flake check path:. -L
nix build path:.#release
just test
just lint
```

Run the full Linux CI. A pin update is not complete when only the local macOS
build passes.

## Handoff

Report:

- old and new versions;
- every file changed;
- regenerated hashes;
- compatibility notes;
- CI results for both supported systems;
- follow-up work.

Do not update nixpkgs, MoonBit, and pnpm in one pull request unless the user
asks for that combined update.
