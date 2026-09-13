import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_FILES_PER_NOTE,
  MAX_NOTE_TEXT_CHARS,
  capNoteText,
  coerceNoteKind,
  normalizeNoteRow,
  sanitizeNoteFiles,
} from "./store-note-normalize.ts";

test("coerceNoteKind keeps known kinds and fails closed to note", () => {
  assert.equal(coerceNoteKind("run"), "run");
  assert.equal(coerceNoteKind("status"), "status");
  assert.equal(coerceNoteKind("note"), "note");
  assert.equal(coerceNoteKind("NOTE"), "note");
  assert.equal(coerceNoteKind(null), "note");
  assert.equal(coerceNoteKind(1), "note");
});

test("sanitizeNoteFiles drops bad rows and caps to MAX_FILES_PER_NOTE", () => {
  assert.equal(sanitizeNoteFiles(null), undefined);
  assert.equal(sanitizeNoteFiles("x"), undefined);
  const ok = { id: "a", name: "a.png", mediaType: "image/png", byteLength: 10 };
  assert.deepEqual(sanitizeNoteFiles([ok, null, { id: "b" }, { ...ok, id: "c", byteLength: Number.NaN }]), [ok]);
  const many = Array.from({ length: MAX_FILES_PER_NOTE + 3 }, (_, i) => ({
    id: `f${i}`,
    name: `${i}.png`,
    mediaType: "image/png",
    byteLength: i,
  }));
  assert.equal(sanitizeNoteFiles(many)!.length, MAX_FILES_PER_NOTE);
});

test("capNoteText bounds length and drops non-strings", () => {
  assert.equal(capNoteText(undefined), undefined);
  assert.equal(capNoteText(12), undefined);
  assert.equal(capNoteText("hi"), "hi");
  assert.equal(capNoteText("x".repeat(MAX_NOTE_TEXT_CHARS + 5))?.length, MAX_NOTE_TEXT_CHARS);
});

test("normalizeNoteRow skips bad rows, migrates legacy file, coerces kind", () => {
  assert.equal(normalizeNoteRow(null), null);
  assert.equal(normalizeNoteRow({ kind: "run" }), null);
  const from = { id: "phone", name: "Phone", role: "phone" };
  const legacy = normalizeNoteRow({
    id: "n1",
    kind: "WEIRD",
    from,
    createdAt: "2026-01-01T00:00:00.000Z",
    file: { id: "f1", name: "a.png", mediaType: "image/png", byteLength: 3 },
  });
  assert.equal(legacy?.kind, "note");
  assert.deepEqual(legacy?.files, [{ id: "f1", name: "a.png", mediaType: "image/png", byteLength: 3 }]);
});
