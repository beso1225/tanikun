# Phase 5 physical PRF results

These observations support [issue #186](https://github.com/beso1225/tanikun/issues/186).
The tester used disposable passkeys with the [physical-device protocol](PHASE_5_PRF_DEVICE_PROTOCOL.md).
The trials took place on November 24, 2026, on a MacBook Air M3 running macOS
27.2.1 (26B131). They used HTTPS loopback with a manual certificate warning
bypass. The transport field was unrecorded.

| Browser and provider                                                 | Registration request    | Registration response                                                                      | Authentication and comparisons                                                                                      |
| -------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Chrome 158.0.8127.37, 1Password 8.12.46, Chrome extension 8.12.46.29 | Support check           | `enabled=true`                                                                             | A1 returned a plain JavaScript array. Failed with `prf_result_type_array`.                                          |
| Same Chrome, Apple Passwords 3.2                                     | Support check           | R1 and R2 reported `enabled=true`.                                                         | A1–A4 returned 32 bytes. All three comparisons passed.                                                              |
| Safari 27.2, 1Password 8.12.46 through macOS AutoFill, extension off | Support check           | R1 and R2 created passkeys and omitted `enabled`. The probe reported `prf_enabled_absent`. | A1–A4 returned 32 bytes. All three comparisons passed.                                                              |
| Same Chrome, 1Password 8.12.46 through macOS AutoFill, extension off | Support check           | R1 reported `enabled=false`.                                                               | A1 returned 32 bytes. The probe reported `prf_enabled_inconsistent`. The tester reported the same outcome on retry. |
| Same Chrome and 1Password macOS AutoFill configuration               | Registration evaluation | R1 and R2 reported `enabled=true` and returned 32 bytes.                                   | A1–A4 returned 32 bytes. All three comparisons passed.                                                              |

The source is the tester's safe JSON exports, identified by run prefixes
`9249eeb0`, `0d77e01b`, `610d454b`, `b47039a2`, and `2ff9b02e` in table
order. The first four used harness commit `5f918a0`. The final trial used
comparison-mode commit `62074e8` with `registration_eval=true`. A separate
evaluation trial (`22101b2d`) also passed R1 and A1 before cleanup.

Across the three completed comparison runs, the same credential and input
produced equal results. A different input or a different credential produced
different results. UP and UV flags were true and the tester recorded both
observations as yes for all completed steps. Cleanup was recorded as complete
in each listed export. The probe compares bytes in memory and exports only
observations. Registration results were discarded after inspection, so
equality between registration and authentication outputs is untested.

## Interpretation

Changing the Chrome macOS AutoFill registration request from a support check
to evaluation changed the observed registration response from false to true.
The physical trial did not observe the intermediate AuthenticationServices
response. Chromium's tagged source shows that the
[support check and evaluation use different request paths](https://github.com/chromium/chromium/blob/158.0.8127.37/device/fido/mac/icloud_keychain_sys.mm#L354-L363).
The extension's array output matches an earlier
[1Password report (FS-5593)](https://www.1password.community/developers-69/browser-extension-webauthn-prf-extension-not-spec-compliant-24672).
The array contents and repeatability were untested.

The iPhone 16e on iOS 27.2.1 could not reach the approved Mac probe origin
directly. Hybrid authentication, cross-device equality, a dedicated security
key, and Chrome-managed credentials were untested. Backup flags were true in
the completed comparison runs. These flags give credential metadata only.

## Phase 6 recommendation

Defer adoption while Phase 6 defines its recovery path and validates the
supported environments. The completed cells show that PRF is a feasible
optional helper in the recorded configurations. Some paths for the same
provider produced incompatible responses, and cross-device behavior remains
unverified. Keep sign-in and recovery independent of PRF. See the
[WebAuthn PRF specification](https://www.w3.org/TR/webauthn-3/#prf-extension).
