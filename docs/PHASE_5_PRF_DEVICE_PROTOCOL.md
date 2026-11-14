# Phase 5 PRF physical-device protocol

## Status

prepared; physical observations pending

This page is the reconciled preparation for
[#186](https://github.com/beso1225/tanikun/issues/186). It is not an evidence
record and it does not claim PRF support for any browser, device, authenticator,
or provider. No physical ceremony was run while preparing it. Issue #186 stays
open until a human records the observations, the cleanup is verified, and the
review is complete.

The base commit is
`187a05654f950fd11cbd6c75ea5d37646d759d90` (`#197` merged, `#176` through
`#185` merged). The accepted contract is
[docs/PHASE_5.md](PHASE_5.md) and
[ADR-0015](adr/0015-passkey-session-account-boundary.md), effective after the
`#177` contract merge. `#187` and milestone 6 closeout are out of scope.

## Purpose

The spike answers one bounded question: on the devices and providers that a
human actually has, can a disposable WebAuthn credential return stable,
separated PRF outputs after user verification, without exposing those outputs
outside the browser tab?

PRF support is optional. It is not a sign-in requirement, a recovery mechanism,
a document-key transfer mechanism, or a condition for Phase 5 authentication.
A supported result is not a recovery guarantee. A provider can support passkeys
and still return no PRF result.

The Phase 6 recommendation is separate. Phase 6 owns encryption, document keys,
device enrollment, and key transfer. Phase 7 owns backup and key-recovery UX.
This spike only informs whether PRF is worth considering as an optional Phase 6
helper.

## Non-goals and prohibited claims

- No real document key, AES-GCM key wrapping, key envelope, E2EE, or recovery
  implementation.
- No PRF request in the product authentication ceremony, product server
  allowlist, session flow, sync flow, or deployment configuration.
- No claim that authentication alone recovers a document key.
- No claim that a synced or backed-up credential preserves PRF output across
  devices.
- No claim that the browser name identifies the provider, or that a provider
  name implies PRF support.
- No direct iPhone-browser origin, LAN address, tunnel, public deployment,
  HTTP exception, or RP ID change.
- No real planner record, real account, or production origin.
- No raw PRF bytes, hashes, commitments, credential IDs, challenges, requests,
  responses, or derived material in the UI, logs, storage, URL, export, or
  evidence.
- No GitHub, deployment, Notion, or issue write from this protocol.
- No Phase 5 completion claim and no `#187` closeout.

## Approved boundary

The accepted Phase 5 contract fixes the local origin and RP ID:

| Property                    | Value                                    |
| --------------------------- | ---------------------------------------- |
| Exact origin                | `https://localhost:4300`                 |
| RP ID                       | `localhost`                              |
| Transport                   | Loopback HTTPS only                      |
| Product auth mode           | Session mode remains local and test only |
| Product PRF request         | None                                     |
| Product extension allowlist | None; unknown fields are rejected        |

The probe is a separate static page served at the approved origin while the
product app is not running. It does not add PRF to product authentication, does
not change the product server, and does not introduce a second origin or RP ID.
The product app and the probe must not listen on port 4300 at the same time.

The probe server binds only to `127.0.0.1:4300`. It refuses a request whose
Host is not `localhost:4300`, refuses non-loopback peers, refuses non-GET and
non-HEAD methods, and has no API endpoint. A page served through a tunnel
would not match the approved browser origin and is outside this protocol.

### TLS

The default probe certificate is a disposable self-signed certificate for
`localhost`, created with the same loopback profile as the session harness. It
is not installed, imported, or trusted by this repository.

A parent may supply a certificate that the browser already trusts through
`TANIKUN_PRF_TLS_CERT` and `TANIKUN_PRF_TLS_KEY`. The server verifies that the
certificate matches `localhost` and reads it without modifying any trust store.
It does not launch a browser with certificate flags, edit a browser profile, or
change an OS trust setting.

The human records one of these TLS observations:

- `trusted`: the browser accepted the origin without a certificate warning.
- `bypassed`: the human chose to continue through a certificate warning. This
  is a limited observation, not normal trusted-TLS evidence.
- `blocked`: the browser refused the origin or WebAuthn. No ceremony is run.

A `bypassed` result can still observe provider PRF behavior, but it cannot
establish normal-browser certificate trust. The synthetic Playwright test uses
`ignoreHTTPSErrors` inside a disposable context and is not physical evidence.

### iPhone

`localhost` on an iPhone is the iPhone, not the Mac. The probe server is not
reachable from the iPhone browser at the approved origin. This protocol does
not authorize a LAN address, tunnel, public hostname, RP ID change, or new
certificate path.

The iPhone may participate as a hybrid or roaming authenticator for a ceremony
whose page is running on the Mac. Record that only when the Mac chooser actually
offers the iPhone. Record the Mac browser as the client, the iPhone or its
provider as the authenticator, and the transport as hybrid. A hybrid
observation does not prove direct iPhone Safari support, iPhone provider
support, or credential sync.

A direct iPhone-browser cell stays `blocked` or `untested` with the concrete
reason. It is not a failed PRF result, and it is not a pass.

## Device and provider availability

These values are availability context only. They are not compatibility results.

The Mac values were inspected read-only on 2026-11-14. The iPhone values are
user-reported. No browser or provider version is inferred from a neighboring
product.

| Cell | Device                   | OS                                | Browser                      | Provider                                                     | Source                                                    | Role                  | Status                                                                                   |
| ---- | ------------------------ | --------------------------------- | ---------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------- |
| M1   | Mac15,12, arm64          | macOS 27.2.1 (26B131)             | Chrome 157.0.8103.51         | 1Password 8.12.44 app; extension version not verified        | local read-only inspection                                | Platform provider     | untested                                                                                 |
| M2   | Mac15,12, arm64          | macOS 27.2.1 (26B131)             | Safari 27.2 (22625.2.8.11.9) | 1Password for Safari 8.12.44; extension version not verified | local read-only inspection                                | Platform provider     | untested                                                                                 |
| M3   | Mac15,12, arm64          | macOS 27.2.1 (26B131)             | Chrome 157.0.8103.51         | iCloud Keychain                                              | user-reported registration possible; version not verified | Platform provider     | untested                                                                                 |
| M4   | Mac15,12, arm64          | macOS 27.2.1 (26B131)             | Safari 27.2 (22625.2.8.11.9) | iCloud Keychain                                              | user-reported registration possible; version not verified | Platform provider     | untested                                                                                 |
| M5   | Mac15,12, arm64          | macOS 27.2.1 (26B131)             | Chrome 157.0.8103.51         | Chrome profile credential                                    | user-reported tentative                                   | Platform provider     | untested                                                                                 |
| I1   | iPhone 16e               | iOS 27.2.1                        | not verified                 | not verified                                                 | user-reported                                             | Direct iPhone browser | blocked: localhost reaches the iPhone, and no approved origin or certificate path exists |
| H1   | Mac15,12 plus iPhone 16e | macOS 27.2.1 (26B131), iOS 27.2.1 | Mac Chrome or Safari         | iPhone provider, only if the chooser actually offers it      | user-reported availability                                | Hybrid authenticator  | untested; conditional on an observed chooser entry                                       |

Availability is not compatibility. The iPhone browser and provider versions are
unknown, and this protocol does not guess them. A Chrome-managed credential is
tentative and must not be described as a confirmed provider. No security-key
credential was reported for this preparation. A security-key cell is `untested`
and is not listed as an available device.

## Roles and human-owned actions

| Role         | Owns                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Agent        | Harness, origin checks, synthetic tests, redaction, and the evidence template. Does not run a physical ceremony in this preparation. |
| Human tester | Physical presence, provider selection, UP gesture, UV gesture or provider unlock, and deletion in the provider UI.                   |
| Parent       | Human coordination, external writes, review, and the independent follow-up review.                                                   |
| Reviewer     | Evidence completeness, leakage result, cleanup confirmation, and the Phase 6 recommendation.                                         |

The harness never selects a provider, performs a biometric check, enters a PIN,
or deletes a credential. The human must stop if the chooser or prompt differs
from the recorded provider.

## Evidence model

The safe export contains only:

- status enums and booleans;
- exact manually entered device, browser, provider, and extension version
  labels;
- result presence and a byte length, never a result value;
- UP, UV, BE, and BS flags as booleans or `not inspected`;
- human UP and UV observations as `yes`, `no`, or `not_observed`;
- comparison outcomes;
- cleanup booleans and a blocker enum;
- the approved origin, RP ID, schema name, harness commit, and timestamp;
- fixed limitation labels.

It never contains:

- PRF bytes or any hash, HMAC, commitment, or derived key material;
- raw credential IDs, user handles, public keys, attestation objects,
  challenges, signatures, or session tokens;
- `clientExtensionResults` JSON, `PublicKeyCredential.toJSON()` output, or any
  credential object serialization;
- raw traces, HAR files, browser profiles, provider account identifiers, or
  console logs containing a credential object;
- free-text notes. Provider labels and versions are length-limited and reject
  account-email characters.

Use these status values exactly:

| Status        | Meaning                                                                                                                                               | Minimum evidence                                                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supported`   | R1 or R2 creation returned `prf.enabled=true`. For A1 to A4, an assertion returns `prf.results.first` of 32 bytes with inspected UP and UV flags set. | Successful creation with `prf.enabled=true`, or a successful assertion with result length 32, `up_flag=true`, and `uv_flag=true`.                             |
| `unsupported` | The credential works for WebAuthn, but PRF is not available.                                                                                          | `prf.enabled=false`, client capability false, or `prf.enabled` absent with no results and no technical error. `prf.enabled=true` with no results is `failed`. |
| `denied`      | The human declined or cancelled the prompt, or a provider permission was refused.                                                                     | The human observed the cancellation. `NotAllowedError` alone is not enough.                                                                                   |
| `failed`      | A valid attempt errored, returned malformed or empty results, returned the wrong length, or reported inconsistent flags.                              | Stage, error name from the allowlist, and the observed preconditions.                                                                                         |
| `untested`    | A prerequisite is missing, the cell was intentionally not run, the client reports no PRF capability, or the flags could not be inspected.             | Exact blocker. Never counts as supported.                                                                                                                     |

`enabled=false` with results, `enabled=true` without results, a result length
other than 32, or a PRF result with UP or UV false is `failed` until explained.
Do not average cells and do not turn a partial result into a pass.

A `supported` cell is an observation, not the Phase 6 recommendation. Missing
observations are not a successful test.

## Test units and credential lifecycle

One run uses one fictional RP test account and two disposable credentials.

- C1 is the repeatability and input-separation credential.
- C2 is the credential-separation credential.
- The display name is `PRF Spike C1 <run-id>` or `PRF Spike C2 <run-id>`.
  The run ID is random and is not an account identifier.
- Each credential uses a fresh random 32-byte user handle. The handle is not
  exported.
- The options use the accepted Phase 5 settings: `residentKey: "required"`,
  `userVerification: "required"`, `attestation: "none"`, and ES256 (`alg: -7`).
- Registration sends `extensions: { prf: {} }`.
- Assertion sends `extensions: { prf: { eval: { first: salt } } }`.
  `evalByCredential` is not used.
- Salt A and salt B are independent random 32-byte values in browser memory.
  Salt A is used for A1, A2, and A4. Salt B is used for A3. Their bytes are not
  exported.
- Each ceremony uses a fresh random challenge. No challenge is sent to a
  server.
- C1 assertions use `allowCredentials: [{ type: "public-key", id: C1 }]`.
  C2 assertions use C2. The harness does not use an empty allow list.
- PRF results stay in local `Uint8Array` values and are compared in memory.
  The page drops references and zeroizes reachable buffers after comparison or
  cleanup. This is best-effort zeroization; browser internals may retain copies
  until garbage collection.

The harness cannot prove that a provider deletes a credential. Cleanup is a
human observation in the provider UI and the chooser.

## Procedure

### 1. Preflight

1. Confirm the harness commit and open the page at exactly
   `https://localhost:4300/` as a top-level document.
2. Confirm the page reports the exact origin, RP ID `localhost`, a secure
   context, a top-level document, and `PublicKeyCredential` availability.
3. Record `PublicKeyCredential.getClientCapabilities()["extension:prf"]` as
   `true`, `false`, or `absent`. This is client capability only. It does not
   prove authenticator or provider support.
4. Record the TLS trust observation. If the browser blocks the origin or
   WebAuthn, mark the cell blocked and stop. Do not install a certificate,
   change a trust store, edit a browser profile, or use certificate flags.
5. Record the exact device model, OS build, browser version, provider label,
   provider app version, and provider extension version. Use the provider name
   only, never an account email.
6. Confirm that no network request carries credential or PRF data. The probe
   page has no server API and its CSP sets `connect-src 'none'`.

If the client capability is `false`, stop before creating credentials. Record
the client blocker. Provider evaluation was not possible.

### 2. Register C1

1. Click **Register C1** and observe the provider chooser.
2. Record the exact provider label and transport that the chooser showed. Do
   not infer the provider from the browser name.
3. Complete the human-owned UP gesture and UV check.
4. Record `prf.enabled` as `true`, `false`, or `absent`.
5. Record the UP and UV flags if the harness inspected them. Record whether the
   human actually saw each prompt separately.
6. Record the C1 alias for cleanup.

A successful creation does not prove that assertion will return a PRF result.

### 3. Authenticate C1 with salt A, twice

1. Click **A1** and complete the prompt. Record UP, UV, flags, and provider.
2. Click **A2** and complete a fresh prompt with the same credential and salt A.
3. The harness compares A1 and A2 in memory and records only `equal` or
   `different`. The expected outcome is `equal`.
4. If either assertion lacks a 32-byte result, repeatability is `untested` or
   `failed`. Do not infer equality from one result.

### 4. Authenticate C1 with salt B

1. Click **A3** and use the same C1 credential with salt B.
2. The harness compares the result with A1 in memory. The expected outcome is
   `different`.
3. If the outputs are equal, mark the cell `failed`, stop the run, and export
   the failed evidence. Do not recommend a helper.

### 5. Register C2 and authenticate with salt A

1. Click **Register C2** and record the provider, transport, UP, UV, and
   `prf.enabled` as for C1.
2. Click **A4** and use C2 with salt A.
3. The harness compares A4 with A1 in memory. The expected outcome is
   `different`.
4. If the outputs are equal, mark the cell `failed`, stop the run, and export
   the failed evidence.
5. If C2 cannot be created or cleaned up, record `failed`, `untested`, or
   `blocked` with the concrete stage. Do not reuse C1 with a different account.

### 6. Cleanup

1. Delete C1 and C2 in the provider UI by alias and creation time.
2. Verify that neither disposable credential appears in the chooser on the Mac.
   If the credential appeared on the iPhone, verify absence there too.
3. Do not delete unrelated passkeys, clear a keychain, or remove a browser
   profile.
4. Record `cleanup=complete` only when both deletions and the chooser check are
   observed. A partial run may remain `cleanup=pending`; a completed attempt
   that cannot verify cleanup is `cleanup=blocked` with the blocker enum. Stop
   creating credentials after a blocked cleanup.
5. Export the safe JSON and clear the harness memory. The export still contains
   no PRF bytes.

If ownership of a credential is uncertain, do not delete it. Mark cleanup
blocked and ask the parent.

## Matrix templates

Do not prefill a cell. Use `TBD` and `untested` until the human observes the
value. The status vocabulary is `supported`, `unsupported`, `denied`, `failed`,
or `untested`.

### Run header

| Field                       | Value                          |
| --------------------------- | ------------------------------ |
| Run ID                      | TBD                            |
| UTC start and end           | TBD                            |
| Device role                 | TBD                            |
| Device model                | TBD                            |
| OS and build                | TBD                            |
| Browser and version         | TBD                            |
| Provider labels (P1 to P3)  | TBD                            |
| Provider app versions       | TBD                            |
| Provider extension versions | TBD                            |
| Transport                   | TBD                            |
| TLS trust                   | TBD                            |
| PRF client capability       | TBD                            |
| RP ID                       | `localhost`                    |
| Exact origin                | `https://localhost:4300`       |
| Approved contract revision  | `#177` / ADR-0015 at `187a056` |
| Harness commit              | TBD                            |
| Human tester                | TBD                            |

### Ceremony cells

| Cell | Credential | Ceremony           | `allowCredentials` | UP observed | UV observed | `prf.enabled`  | `results.first` | Length         | UP flag | UV flag | Provider | Status   | Blocker |
| ---- | ---------- | ------------------ | ------------------ | ----------- | ----------- | -------------- | --------------- | -------------- | ------- | ------- | -------- | -------- | ------- |
| R1   | C1         | create with PRF    | not applicable     | TBD         | TBD         | TBD            | not applicable  | not applicable | TBD     | TBD     | TBD      | untested | not_run |
| A1   | C1         | get salt A, first  | C1                 | TBD         | TBD         | not applicable | TBD             | TBD            | TBD     | TBD     | TBD      | untested | not_run |
| A2   | C1         | get salt A, second | C1                 | TBD         | TBD         | not applicable | TBD             | TBD            | TBD     | TBD     | TBD      | untested | not_run |
| A3   | C1         | get salt B         | C1                 | TBD         | TBD         | not applicable | TBD             | TBD            | TBD     | TBD     | TBD      | untested | not_run |
| R2   | C2         | create with PRF    | not applicable     | TBD         | TBD         | TBD            | not applicable  | not applicable | TBD     | TBD     | TBD      | untested | not_run |
| A4   | C2         | get salt A         | C2                 | TBD         | TBD         | not applicable | TBD             | TBD            | TBD     | TBD     | TBD      | untested | not_run |

`results.first` is `present` or `absent`. `Length` is a count, normally 32.
Never write the bytes or a hash. `prf.enabled` is `true`, `false`, or `absent`.
`not_run` is the initial blocker, not a physical result.

### Comparisons

| Check                 | Credential and input      | Compared with | Expected    | Observed | Status   |
| --------------------- | ------------------------- | ------------- | ----------- | -------- | -------- |
| Repeatability         | C1, salt A                | A1 against A2 | `equal`     | TBD      | untested |
| Input separation      | C1, salt A against salt B | A1 against A3 | `different` | TBD      | untested |
| Credential separation | C1 against C2, salt A     | A1 against A4 | `different` | TBD      | untested |

`Observed` is `equal` or `different` only. Do not write a digest.

### Cleanup

| Item                                      | Observation | Status   |
| ----------------------------------------- | ----------- | -------- |
| C1 deleted in provider UI                 | TBD         | untested |
| C2 deleted in provider UI                 | TBD         | untested |
| Neither credential appears in the chooser | TBD         | untested |
| Cleanup blocker, if any                   | TBD         | untested |

### Second-device and backup observations

BE and BS are recorded from the authenticator data when available. They do not
prove PRF repeatability, provider sync, or recovery. A credential that appears
on a second device is recorded as visible or not visible, but cross-device PRF
equality is `untested by design` because the direct iPhone-browser origin is
blocked. Do not infer equality from provider sync.

## Phase 6 decision rules

The recommendation is `pending` until the human observations and cleanup are
reviewed. The reviewer records one of these outcomes:

- `defer`: at least one physical cell is untested or the evidence is
  incomplete; or a provider shows a useful result but a second independent
  provider or documented recovery path is missing. Defer keeps the helper
  optional and does not enable encryption.
- `avoid`: every attempted physical provider is unsupported, results are not
  repeatable, different inputs or credentials collide, UV is missing, cleanup
  cannot be verified, or behavior is inconsistent. Avoid means PRF is not used
  as a Phase 6 helper.
- `supported optional helper`: at least one physical provider cell has a
  32-byte result, inspected UP and UV true, repeatability `equal`, input
  separation `different`, credential separation `different`, cleanup complete,
  and no leakage. A general cross-provider recommendation requires at least two
  independent physical provider or device cells. The helper remains optional
  and never becomes a sign-in or recovery requirement.

An unsupported physical result is valid spike completion. Missing observations
are not a successful test. No outcome in this page authorizes E2EE, key
wrapping, recovery, or public deployment.

## Harness and safe export

The harness is in `tools/prf-probe/`. It is a separate page, not the product
login. It has explicit buttons for R1, A1, A2, A3, R2, A4, and cleanup. It does
not create a credential during preparation.

The page:

- calls `navigator.credentials.create()` and `navigator.credentials.get()`
  directly, with the PRF extension only in this isolated spike;
- never calls `credential.toJSON()`, `JSON.stringify(credential)`, object spread
  on a credential, or passes `clientExtensionResults` anywhere;
- has no fetch, XHR, beacon, WebSocket, EventSource, analytics, storage, cookie,
  URL parameter, or console output;
- reads only `credential.type`, `rawId`, the PRF result, and authenticator flags
  in memory;
- compares PRF values in memory and records only `equal`, `different`, or
  `untested`;
- exports a constructed allowlist object, not the page state;
- runs at most one native ceremony at a time and supplies an AbortSignal;
- aborts a pending ceremony on Clear or page hide, discards late results, and
  zeroizes reachable buffers returned after cancellation;
- retains the A1 result only until the remaining comparisons finish, then
  zeroizes reachable PRF results, salts, and credential IDs. Clear and page
  hide also zeroize them. This is not a browser secure-erasure claim.

The server sets a restrictive CSP with `default-src 'none'`,
`script-src 'self'`, `style-src 'self'`, and `connect-src 'none'`, plus
`frame-ancestors 'none'`, `form-action 'none'`, and `base-uri 'none'`. It has
no API route, no cookie, no CORS header, and no request log.

Cleanup records `c1_absent_confirmed` and `c2_absent_confirmed`: the human
confirms each disposable credential is absent after deletion, or was never
created. This permits an unsupported or cancelled attempt without falsely
recording a deletion. Wait for all native prompts to settle before confirming. Recording either
complete or blocked cleanup closes the run, clears its in-memory secrets, and
permanently disables further ceremonies until reload. Editing observation
fields afterwards cannot reopen the run.

The export schema is `tanikun-prf-probe-export-v1`. It has exactly the run
header, preflight, environment, providers, six cells, three comparisons,
cleanup, a fixed `pending_human` recommendation, and fixed limitation labels.
It has no result bytes, hashes, credential IDs, challenges, requests, or
responses.

### Synthetic leak tests

`just test-prf-probe` starts the real probe server with a disposable
certificate and a stubbed `navigator.credentials`. The stub injects unique
32-byte PRF canaries and drives R1 through A4. The test checks that the
canaries are absent from:

- rendered DOM and body text;
- console messages and page errors;
- network requests, which must be same-origin GETs only;
- local storage, session storage, IndexedDB names, cookies, `window.name`, and
  the URL;
- the downloaded safe export;
- server logs;
- the export key set.

The test also checks the PRF options: ES256, resident credential, required UV,
`attestation: "none"`, RP ID `localhost`, exact `allowCredentials`, fresh
challenges, and salt reuse and separation.

The synthetic test is not physical evidence. It uses Chromium
`ignoreHTTPSErrors` inside a disposable context and does not prove a normal
browser, a provider chooser, a biometric, or a physical authenticator.

## Launch and stop

Run inside `nix develop` so Node.js 24.22.1, pnpm 12.9.0, OpenSSL, and
Playwright come from the pinned shell.

```sh
nix develop -c just prf-probe
```

The command serves only `https://localhost:4300/` and prints the origin, RP ID,
and certificate source. It does not open a browser. The parent launches it once
the human is ready, and the human stops it with Ctrl-C. Do not leave a listener
running after the run.

If port 4300 is occupied, the command fails with a clear message and leaves the
existing listener alone. Stop and coordinate. Do not kill a process by name,
reuse the listener, change the port, change CORS, or change the RP ID.

To use a certificate the browser already trusts, set both paths before launch:

```sh
TANIKUN_PRF_TLS_CERT=/approved/localhost-cert.pem \
TANIKUN_PRF_TLS_KEY=/approved/localhost-key.pem \
nix develop -c just prf-probe
```

Do not install, import, or trust a new certificate for the run.

Run the synthetic checks without a physical device:

```sh
nix develop -c just test-prf-probe
```

The page test needs port 4300 and `PLAYWRIGHT_CORE` from `nix develop`. It does
not run a physical ceremony. These synthetic checks run in Linux CI; physical
ceremonies do not.

## Privacy and leakage controls

The production auth client already projects exact fields and rejects unknown
fields. This spike does not change that code. The probe keeps the PRF path out
of product auth and sync.

The page and export follow these rules:

1. PRF results remain local in memory. Only presence, length, comparison
   outcomes, and flags are displayed.
2. The page never serializes a credential or extension result. It reads
   `credential.type`, `rawId`, `prf.results.first`, and authenticator flags
   directly.
3. The page has no upload path. CSP `connect-src 'none'` blocks fetch and
   WebSocket, and the server has no API.
4. The export is constructed from an allowlist. Extra state fields are ignored.
5. Provider labels and versions are length-limited and reject `@`, newlines,
   and other account-identifier characters.
6. Evidence and debug output never contain PRF bytes, hashes, credential IDs,
   challenges, signatures, or responses.
7. The synthetic canary test uses fake bytes. It does not prove a physical
   provider and it does not persist a real PRF result.

If a browser or provider exposes a credential object in a console or a HAR file,
do not retain that file. Stop, record the blocker, and do not upload the raw
file.

## Acceptance criteria map

| #186 criterion                                                                                                                                                                | Prepared in this change                                                                                       | Still requires human observation                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Exact OS, browser, authenticator, and provider version matrix; platform or security-key credentials; unsupported behavior; UV interaction                                     | Protocol status vocabulary, device availability table, version fields, UP and UV fields, no prefilled support | Exact run values, chooser observations, and provider versions              |
| Disposable credentials and synthetic values; same-credential repeatability; different-input and different-credential separation; synced credentials only on available devices | C1 and C2 procedure, salts A and B, in-memory comparisons, BE/BS metadata, second-device limits               | Physical assertions, comparison outcomes, and backup or sync observations  |
| Observed, failed, and untested cells recorded separately; concrete blockers; virtual results excluded from physical compatibility                                             | Status enum, blocker enum, blocked iPhone cell, synthetic test isolation                                      | All physical cell values and cleanup booleans                              |
| No PRF output to server, public logs, or artifacts; no real key wrapping, E2EE, or recovery claim                                                                             | Isolated page, no server API, strict CSP, allowlist export, canary tests, explicit non-goals                  | Human confirmation that the run did not use real data or a public listener |
| Evidence-based Phase 6 recommendation, with unsupported as valid completion                                                                                                   | Decision rules and pending state                                                                              | The reviewer's recommendation after observations and cleanup               |

## Remaining blockers

- Physical observations are not recorded. Every M1 to M5 and H1 cell is
  `untested`; I1 is `blocked`.
- The disposable certificate may be rejected by a normal browser. A trusted
  certificate path, if any, must be supplied by the parent without changing
  trust stores.
- The iPhone browser and provider versions are unknown. A direct iPhone-browser
  cell has no approved origin or certificate path.
- The Chrome-managed credential is tentative, not a confirmed provider.
- The provider chooser, Touch ID or Face ID, 1Password unlock, and deletion are
  human-owned. This preparation did not trigger them.
- A physical result remains pending even if the synthetic tests pass.
- The independent review and the parent's review are still required before
  human execution or a PR merge.

## Preparation verification

The following commands were run locally on 2026-11-14 inside the pinned Nix
shell. They use synthetic stubs only.

| Command                                                                                             | Result    |
| --------------------------------------------------------------------------------------------------- | --------- |
| `node --test tests/integration/prf-probe-core.test.mjs tests/integration/prf-probe-server.test.mjs` | 15 passed |
| `node --test tests/integration/prf-probe-page.test.mjs`                                             | 5 passed  |
| `just lint`                                                                                         | passed    |
| `just test-prf-probe`                                                                               | 20 passed |

Linux CI runs the same synthetic checks; physical-device ceremonies are not
part of CI. The cancellation regressions exercise pending registration and
assertion promises, including late results after Clear.

The page test uses Chromium `ignoreHTTPSErrors` inside a disposable context. It
does not establish physical provider support, normal-browser TLS trust, or a
successful physical PRF evaluation.

## References

Primary sources were checked on 2026-11-14 unless noted. Provider pages
describe passkey storage and sync. They do not establish PRF support.

- W3C, [Web Authentication Level 3 Recommendation](https://www.w3.org/TR/2026/REC-webauthn-3-20260825/),
  25 August 2026. See the
  [PRF extension](https://www.w3.org/TR/webauthn-3/#prf-extension),
  [client capabilities](https://www.w3.org/TR/webauthn-3/#sctn-getClientCapabilities),
  [authenticator data](https://www.w3.org/TR/webauthn-3/#sctn-authenticator-data),
  and [credential backup state](https://www.w3.org/TR/webauthn-3/#sctn-credential-backup).
- FIDO Alliance, [CTAP 2.1 Proposed Standard](https://fidoalliance.org/specs/fido-v2.1-ps-20210615/fido-client-to-authenticator-protocol-v2.1-ps-errata-20220621.html),
  including the [hmac-secret extension](https://fidoalliance.org/specs/fido-v2.1-ps-20210615/fido-client-to-authenticator-protocol-v2.1-ps-errata-20220621.html#sctn-hmac-secret-extension).
- SimpleWebAuthn, [PRF](https://simplewebauthn.dev/docs/advanced/prf),
  accessed 2026-11-14. This is library guidance, not a provider claim.
- Google, [Passkey support on Android and Chrome](https://developers.google.com/identity/passkeys/supported-environments),
  last updated 2025-05-19, accessed 2026-11-14. It describes storage providers,
  not PRF support.
- 1Password, [Save and sign in with passkeys in your browser](https://support.1password.com/save-use-passkeys/),
  published 2026-09-11, accessed 2026-11-14. It describes passkey storage and
  deletion, not PRF support.
- Apple, [Supporting passkeys](https://developer.apple.com/documentation/authenticationservices/supporting-passkeys),
  accessed 2026-11-12. The page returned only a title in this environment, so
  this protocol makes no new Apple-specific claim beyond the platform-provider
  context in the device table.
- [Phase 5 authentication contract](PHASE_5.md) and
  [ADR-0015](adr/0015-passkey-session-account-boundary.md).
- [Phase 5 real-session proof](PHASE_5_SESSION_PROOF.md), for the virtual
  authenticator and TLS limits that this protocol does not extend.
