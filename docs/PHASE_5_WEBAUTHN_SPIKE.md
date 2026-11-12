# Phase 5 WebAuthn verifier spike

This page records the bounded feasibility spike for
[#176](https://github.com/beso1225/tanikun/issues/176) at base commit
`de9d86f43bad22c78c366845f6e178a28235dd4a`. It recommends a maintained
verification library and records what actually ran in the pinned Workers
runtime and the Nix release artifact. It does not define the Phase 5
authentication or session contract. [#177](https://github.com/beso1225/tanikun/issues/177)
owns those decisions.

## Scope

The spike compares WebAuthn verification libraries, exercises synthetic
registration and assertion fixtures in workerd, and proves that the selected
library can be bundled into the self-contained Nix API artifact. The product
boundary stays inactive:

- `apps/api/bridges/worker.mjs` does not import the spike verifier.
- No signup, login, session, cookie, challenge, credential, or identity route
  is added.
- No D1 migration or production identity resolver changes.
- No E2EE, PRF recovery, device-key transfer, sharing, catalogue import, or
  backup work.

[ADR-0014](adr/0014-local-development-auth.md) remains the
local-development authentication contract. The spike adds no deployment or
public enablement.

## Candidate comparison

Versions and metadata were read from the npm registry on 2026-11-12.

| Candidate                                                                                            | Version and license        | Algorithm coverage                                                                                                                                                                               | Worker compatibility                                                                                                                                                           | Assessment                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@simplewebauthn/server`](https://github.com/MasterKale/SimpleWebAuthn/tree/master/packages/server) | `14.1.0`, MIT, Node `>=22` | Default registration algorithms: EdDSA (`-8`), ES256 (`-7`), RS256 (`-257`). Registration supports `none`, packed, TPM, Android Key, Android SafetyNet, Apple, and FIDO U2F attestation formats. | The official project README lists "other compatible runtimes (Cloudflare Workers, Bun, etc...)". The helper module documents its Web API target, including Cloudflare Workers. | Complete registration and assertion verification, maintained, and offline-bundleable. Selected.                                                                                              |
| [`@passwordless-id/webauthn`](https://github.com/passwordless-id/webauthn)                           | `2.4.1`, MIT, Node `>=19`  | ES256 (`-7`) and RS256 (`-257`). EdDSA is not supported.                                                                                                                                         | The official README lists Cloudflare Workers and "all other JS platforms that support WebCrypto API". There are no runtime dependencies.                                       | Smaller alternative, but its registration verification returns parsed registration data and does not verify attestation statements. It is not a complete attestation verifier. Not selected. |
| [`fido2-lib`](https://github.com/webauthn-open-source/fido2-lib)                                     | `4.0.1`, MIT, Node `>=22`  | ES256 (`-7`), RS256 (`-257`), and EdDSA (`-8`) are represented.                                                                                                                                  | The official README documents Node and Deno. It makes no Cloudflare Workers support claim. Its dependency set includes `cbor-x`, `pkijs`, `jose`, and `tldts`.                 | Capable Node-oriented library without an official Workers support statement. Not selected for this runtime.                                                                                  |

Primary sources:

- [SimpleWebAuthn package README](https://github.com/MasterKale/SimpleWebAuthn/tree/master/packages/server#readme)
- [SimpleWebAuthn server documentation](https://simplewebauthn.dev/docs/packages/server)
- [SimpleWebAuthn supported algorithms](https://github.com/MasterKale/SimpleWebAuthn/blob/master/packages/server/src/registration/generateRegistrationOptions.ts)
- [Passwordless.id README](https://github.com/passwordless-id/webauthn#supported-platforms)
- [Passwordless.id server verification source](https://github.com/passwordless-id/webauthn/blob/main/src/server.ts)
- [fido2-lib README](https://github.com/webauthn-open-source/fido2-lib#overview)
- [fido2-lib package manifest](https://github.com/webauthn-open-source/fido2-lib/blob/master/package.json)

## Recommendation

Select `@simplewebauthn/server@14.1.0`.

Among the compared candidates, it is the only one with official Workers
support and complete registration and assertion verification, including
attestation-format handling, plus a dependency closure that bundles and
verifies in the pinned runtime without Node compatibility flags. The tradeoff
is a larger build-time dependency closure and a larger packaged module. The
spike keeps the selected registration algorithm set to ES256 and does not
enable the library in a product route.

## Source proof in workerd

The focused test is
[`apps/api/test/webauthn.test.mts`](../apps/api/test/webauthn.test.mts). The
fixtures are generated at test time by
[`apps/api/test/webauthn-fixtures.mjs`](../apps/api/test/webauthn-fixtures.mjs)
with a disposable P-256 key, a fictional RP ID (`planner.tanikun.test`), and a
fictional origin (`https://planner.tanikun.test`). No real credential, passkey,
planner record, or secret is used.

The test calls the real `verifyRegistrationResponse` and
`verifyAuthenticationResponse` exports from
[`apps/api/webauthn/verify.mjs`](../apps/api/webauthn/verify.mjs). It does not
mock or replace library verification. The fixture helper uses the library's
own `isoCBOR`, `isoBase64URL`, and `isoUint8Array` helpers for WebAuthn data
encoding. It uses `@peculiar/asn1-ecc` and `@peculiar/asn1-schema` only to
DER-encode synthetic ECDSA signatures, because Web Crypto produces raw `r || s`
signatures while WebAuthn assertions carry ASN.1 DER.

Registration uses `fmt: "packed"` self-attestation. That path verifies a real
ECDSA signature over the authenticator data and client-data hash with the
credential key. Assertion verification verifies a separate ECDSA signature.
The positive fixture passes before each negative case derives from it.

| Case                                               | Expected and observed result               |
| -------------------------------------------------- | ------------------------------------------ |
| Registration, synthetic packed self-attestation    | `verified: true`                           |
| Assertion, synthetic ES256 signature               | `verified: true`                           |
| Registration with a modified attestation signature | `verified: false`                          |
| Assertion with a modified signature                | `verified: false`                          |
| Wrong challenge, registration and assertion        | throws `Unexpected ... response challenge` |
| Wrong origin, registration and assertion           | throws `Unexpected response origin`        |
| Wrong RP ID, registration and assertion            | throws `Unexpected RP ID hash`             |

The test file has 8 cases, all passing. Each negative case first checks that
its base registration and assertion fixtures still verify. `just test-d1`
passed 158 tests across 6 files, including the 8 WebAuthn cases. Commands ran
with Node.js 24.22.1 and pnpm 12.9.0 from `nix develop`. The source runtime is
`@cloudflare/vitest-plugin@1.4.6` with Vitest `5.0.5`, which resolves
`workerd 1.20261019.1` through `miniflare 5.20261019.1-beta`. The Worker
compatibility date is `2026-10-12`. No `compatibility_flags` are required.

Commands:

```sh
nix develop
pnpm install --frozen-lockfile
just build
pnpm exec vitest run --config vitest.config.mts apps/api/test/webauthn.test.mts
just test-d1
```

`just build` is required before the focused Vitest command because the test
Worker fixture imports the MoonBit release build.

## Packaged proof in workerd

The Nix API derivation in [`nix/packages.nix`](../nix/packages.nix) now installs
the pinned pnpm dependencies and bundles
`apps/api/webauthn/verify.mjs` with esbuild `0.28.2` into
`apps/api/webauthn/verify.js` in the output. The bundle is 683,804 bytes and
has no external static imports. The API output still contains the production
bridge and modules, but it does not contain `node_modules`.

[`tests/integration/webauthn-packaged.test.mjs`](../tests/integration/webauthn-packaged.test.mjs)
proves runtime loading of that packaged module, not just its existence:

1. It reads the bundle from `TANIKUN_API_DIST`.
2. It resolves the API root and asserts that it is outside the source checkout.
3. It writes a temporary Worker outside the checkout that imports the bundle
   by absolute path.
4. It starts `wrangler dev` in that temporary directory with no
   `node_modules` or source checkout available to the Worker import.
5. It sends the same synthetic registration, assertion, modified-signature,
   wrong-challenge, wrong-origin, and wrong-RP-ID cases to workerd.
6. It asserts the positive results, the rejected mutations, and the rejected
   wrong values.

`just test-sync` includes this file. In the CI packaged mode it runs with
`TANIKUN_API_DIST="$PWD/result-api"`, so the verified code comes from the Nix
artifact. The Node-only release test also checks the bundle's presence and
self-containment, but the workerd packaged test is the runtime proof.

The packaged runtime uses `wrangler@4.151.1`, which resolves
`workerd 1.20261012.1` through `miniflare 5.20261012.1-beta`. The source
Vitest runtime and the packaged Wrangler runtime therefore use two adjacent
pinned workerd builds. Both are the repository's existing transitive pins; the
spike did not change them.

Commands:

```sh
nix develop
pnpm install --frozen-lockfile
api=$(nix build path:.#api --no-link --print-out-paths)
TANIKUN_API_DIST="$api" node --test --test-timeout=120000 tests/integration/webauthn-packaged.test.mjs
nix build path:.#web path:.#api --offline --rebuild --no-link
nix flake check path:. -L
```

Observed on the Darwin workstation:

- The packaged workerd proof passed against the Nix API output.
- `nix build path:.#web path:.#api --offline --rebuild --no-link` passed, so
  the bundle is produced from the fixed pnpm dependency closure without
  network access.
- `nix flake check path:. -L` passed, including the release artifacts and 150
  pure-package tests.
- The production `apps/api/bridges/worker.mjs` is unchanged and does not
  reference the spike.

### Bundling flags and tradeoffs

esbuild is invoked with `--bundle --format=esm --platform=browser --target=es2022`.
`--platform=browser` is required because parts of the ASN.1 and X.509 closure
publish CommonJS `main` entries that `--platform=neutral` does not resolve. The
output is a single ESM module with no Node built-ins. No Wrangler
`compatibility_flags` such as `nodejs_compat` are needed.

The tradeoff is a 684 KB addition to the API artifact, a build-time pnpm
installation in the API derivation, and replacement of the earlier "no npm
runtime dependency" packaging assumption. The production bridge is still
served as source modules; only the spike verifier is bundled.

The Darwin `pnpmDeps` fixed-output hash was regenerated and verified. The Linux
hash was measured by [CI run 43248691241](https://github.com/beso1225/tanikun/actions/runs/43248691241)
and updated from the fixed-output derivation's reported `got` value. A complete
Linux build with that hash remains a merge gate; this is not a local Linux run.

[CI run 43249205794](https://github.com/beso1225/tanikun/actions/runs/43249205794)
then exposed an API packaging error: a custom `configurePhase` skipped
`pnpmConfigHook`, so esbuild's invocation tried to install dependencies during
the networkless build. The API now uses `preConfigure` for MoonBit setup and
preserves the default configure phase and its dependency-install hook. The
earlier Darwin `--offline` result alone did not establish Linux sandbox
compatibility; the corrected Linux build remains the gate.
The corrected Darwin API build logged `Executing pnpmConfigHook` and completed
with `--offline`. Its new output passed the packaged Workers proof, 1/1.

## Algorithms and offline assumptions

The library default covers EdDSA, ES256, and RS256. The spike pins ES256 for
registration (`supportedAlgorithmIDs: [-7]`) and exercises ES256 in both
positive paths. EdDSA and RS256 are library-supported but were not exercised
in workerd here. #177 should choose the accepted algorithm set explicitly
rather than relying on the library default.

Registration uses packed self-attestation without `x5c`. The test does not
initialize the metadata service, does not validate a certificate chain, and
does not perform CRL or metadata HTTP requests. The registration verification
is therefore offline. `@simplewebauthn/server` can perform server-side HTTP
requests for other attestation formats and for configured metadata services.
This spike does not prove that every attestation mode is offline. #177 must
define the attestation and network policy before product use.

## Security advisories

The GitHub advisory database lists these relevant advisories. The selected
`14.1.0` release is outside the affected ranges. This is an advisory-range
check, not an independent security audit.

| Advisory                                                                                                    | Affected and patched ranges           | Selected version status |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------- |
| [GHSA-j3h4-m3m2-7p7j](https://github.com/MasterKale/SimpleWebAuthn/security/advisories/GHSA-j3h4-m3m2-7p7j) | `14.0.1` affected, `14.0.2` patched   | Not affected            |
| [GHSA-2g3p-m8c9-hhwh](https://github.com/MasterKale/SimpleWebAuthn/security/advisories/GHSA-2g3p-m8c9-hhwh) | `14.0.1` affected, `14.0.2` patched   | Not affected            |
| [GHSA-6hxq-p678-4hr2](https://github.com/MasterKale/SimpleWebAuthn/security/advisories/GHSA-6hxq-p678-4hr2) | `< 13.3.1` affected, `13.3.2` patched | Not affected            |

## Limitations and handoff

- The fixtures are synthetic and are not a FIDO conformance run or evidence of
  interoperability with a real authenticator or browser ceremony.
- Only ES256 is exercised in workerd. EdDSA and RS256 remain library-supported
  but unverified in this runtime.
- Registration uses packed self-attestation to exercise a real signature. The
  spike does not test certificate-chain, MDS, CRL, or every attestation format.
- No challenge lifecycle, credential storage, session, cookie, CSRF, rate
  limiting, account recovery, PRF, E2EE, or ownership change is implemented.
- No product Worker route or configuration enables the verifier.
- The updated Linux `pnpmDeps` hash still needs a successful full Linux CI run.
- #177 owns the authentication contract, account boundary, session design,
  algorithm policy, attestation policy, and D1 schema. This spike only
  establishes the runtime, packaging, and offline-closure feasibility.
