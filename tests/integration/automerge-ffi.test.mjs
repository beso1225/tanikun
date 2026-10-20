import assert from "node:assert/strict";
import test from "node:test";
import * as Automerge from "@automerge/automerge";

globalThis.__tanikunAutomerge = {
  create: () => Automerge.from({}),
  set: (doc, key, value) => Automerge.change(Automerge.clone(doc), (draft) => {
    draft[key] = value;
  }),
  save: (doc) => Automerge.save(doc),
  load: (bytes) => Automerge.load(bytes),
  get: (doc, key) => doc[key],
  changes: (from, to) => Automerge.getChanges(from, to),
  apply: (doc, changes) => Automerge.applyChanges(doc, changes)[0],
};

const {
  apply_changes,
  create_doc,
  get_changes,
  get_field,
  load_doc,
  save_doc,
  set_field,
} = await import(
  "../../_build/js/release/build/beso1225/tanikun-automerge-spike/tanikun-automerge-spike.js"
);

test("Bytes round-trip through Automerge save and load", () => {
  const doc = set_field(create_doc(), "course", "physics");
  const bytes = save_doc(doc);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(get_field(load_doc(bytes), "course"), "physics");
});

test("changes from two replicas merge through opaque handles", () => {
  const base = create_doc();
  const left = set_field(base, "left", "1");
  const right = set_field(base, "right", "2");
  const merged = apply_changes(left, get_changes(base, right));
  assert.equal(get_field(merged, "left"), "1");
  assert.equal(get_field(merged, "right"), "2");
});
