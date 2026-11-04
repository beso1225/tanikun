import { expect, it } from "vitest";

import fixture from "../../../docs/contracts/sync-v1.json";
import { validateAppend } from "../../../packages/sync-contract/contract.mjs";

const invalid = fixture.cases.filter(
  (row) =>
    row.response.status === 400 &&
    row.request.body?.changes &&
    row.name !== "unknown-request-field",
);

it.each(invalid)("rejects the shared envelope case $name", (row) => {
  expect(() =>
    validateAppend(row.request.body.changes, fixture.document_id),
  ).toThrowError("malformed_request");
});

it("accepts both opaque envelope algorithms and canonicalizes property order", () => {
  for (const envelope of [fixture.envelope, fixture.encrypted_envelope]) {
    const reordered = Object.fromEntries(Object.entries(envelope).toReversed());
    const a = validateAppend([envelope], fixture.document_id)[0];
    const b = validateAppend([reordered], fixture.document_id)[0];
    expect(a.canonical).toEqual(b.canonical);
  }
});

it("enforces the decoded payload, batch count, and total serialized size limits", () => {
  expect(() =>
    validateAppend(
      Array.from({ length: 21 }, () => ({ ...fixture.envelope })),
      fixture.document_id,
    ),
  ).toThrowError("request_too_large");
  const tooLarge = { ...fixture.envelope, payload: btoa("x".repeat(262145)) };
  expect(() => validateAppend([tooLarge], fixture.document_id)).toThrowError(
    "request_too_large",
  );
  const maximum = { ...fixture.envelope, payload: btoa("x".repeat(262144)) };
  expect(() => validateAppend([maximum], fixture.document_id)).not.toThrow();
  expect(() =>
    validateAppend(
      Array.from({ length: 12 }, () => ({ ...maximum })),
      fixture.document_id,
    ),
  ).toThrowError("request_too_large");
});
