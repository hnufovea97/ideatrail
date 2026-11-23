import { describe, expect, it } from "vitest";
import { newId } from "@ideatrail/crypto/ids";
import { memoryStore } from "../engine-list";
import { metaMark } from "../sync/marks";
import { fakeWorld, rootRow, syncOf } from "../testing/fake-world";
import { emptyRootMeta, type RootMetaV1 } from "./lww";
import { MAX_ROOT_META_PLAIN, openRootMeta, openRootMetas, sealRootMeta } from "./root-meta";

const meta = (version: number): RootMetaV1 => ({ v: 1, version, cells: { title: { value: "가계부", at: "2026-11-11T00:00:00Z", engine: "01jcm3v8q7s2kx4f9d6b5n0ta1", seq: "2" } }, merged: { "01jcm3v8q7s2kx4f9d6b5n0ta1": [["1", "2"]] } });

describe("root_meta relock (spec §15 M5a)", () => {
  it("round-trips under subkey(root_meta) with the saved meta_version in the AAD", () => {
    const w = fakeWorld();
    const root = newId();
    const row = rootRow(root, { meta_version: 3, list_meta: sealRootMeta(w.mk, w.userId, root, meta(3)) });
    expect(openRootMeta(w.mk, w.userId, row)).toEqual(meta(3));
  });
  it("refuses a blob paired with another version or moved from another root", () => {
    const w = fakeWorld();
    const root = newId();
    const blob = sealRootMeta(w.mk, w.userId, root, meta(3));
    expect(() => openRootMeta(w.mk, w.userId, rootRow(root, { meta_version: 4, list_meta: blob }))).toThrow("root_meta_invalid");
    expect(() => openRootMeta(w.mk, w.userId, rootRow(newId(), { meta_version: 3, list_meta: blob }))).toThrow("root_meta_invalid");
  });
  it("nothing merged yet is version 0; an empty blob at a later version is refused", () => {
    const w = fakeWorld();
    expect(openRootMeta(w.mk, w.userId, rootRow(newId()))).toEqual(emptyRootMeta());
    expect(() => openRootMeta(w.mk, w.userId, rootRow(newId(), { meta_version: 2 }))).toThrow("root_meta_invalid");
  });
  it("refuses to seal more than fits the server's 16KB cap", () => {
    const w = fakeWorld();
    const big: RootMetaV1 = { ...meta(1), cells: { title: { value: "x".repeat(MAX_ROOT_META_PLAIN), at: "2026-11-11T00:00:00Z", engine: "-", seq: "1" } } };
    expect(() => sealRootMeta(w.mk, w.userId, newId(), big)).toThrow("root_meta_too_large");
  });
  it("openRootMetas: a meta_version lower than this browser saw is a rollback and is not used", () => {
    const w = fakeWorld();
    const root = newId();
    const marks = memoryStore();
    marks.set(metaMark(w.userId, root), "5");
    const s = syncOf({ roots: [rootRow(root, { meta_version: 3, list_meta: sealRootMeta(w.mk, w.userId, root, meta(3)) })] });
    const out = openRootMetas(w.vault, s, marks);
    expect(out.metas.has(root)).toBe(false);
    expect(out.issues).toEqual([{ kind: "rollback", what: "root_meta", id: root }]);
  });
  it("openRootMetas: remembers the version it saw, reports what does not open", () => {
    const w = fakeWorld();
    const good = newId();
    const bad = newId();
    const marks = memoryStore();
    const s = syncOf({ roots: [rootRow(good, { meta_version: 3, list_meta: sealRootMeta(w.mk, w.userId, good, meta(3)) }), rootRow(bad, { meta_version: 1, list_meta: "SVQxgg" })] });
    const out = openRootMetas(w.vault, s, marks);
    expect(out.metas.get(good)).toEqual(meta(3));
    expect(out.issues).toEqual([{ kind: "unreadable", table: "roots", id: bad }]);
    expect(marks.get(metaMark(w.userId, good))).toBe("3");
  });
});
