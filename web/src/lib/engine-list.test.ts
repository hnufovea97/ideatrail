import { describe, expect, it } from "vitest";
import { randomKey } from "@ideatrail/crypto/keypair";
import { addEngine, isRollback, memoryStore, openEngineList, rememberVersion, sealEngineList, type EngineEntry } from "./engine-list";

const USER = "01jcm3v8q7s2kx4f9d6b5n0tqw";
const entry: EngineEntry = { engine_id: "01jcm3v8q7s2kx4f9d6b5n0tqx", sign_pubkey: "a", kem_pubkey: "b", name: "Steven-Air", added_at: "2026-11-18T00:00:00Z" };

describe("engine list (spec §8, §15 M4)", () => {
  it("adds an engine at version previous + 1 and round-trips sealed", () => {
    const mk = randomKey();
    const list = addEngine(null, entry, 0);
    expect(list).toEqual({ v: 1, version: 1, engines: [entry] });
    expect(openEngineList(mk, USER, 1, sealEngineList(mk, USER, list))).toEqual(list);
  });
  it("refuses a list whose sealed version differs from the server's version", () => {
    const mk = randomKey();
    const blob = sealEngineList(mk, USER, addEngine(null, entry, 0));
    expect(() => openEngineList(mk, USER, 2, blob)).toThrow();
  });
  it("replaces an engine with the same id instead of duplicating it", () => {
    const l2 = addEngine(addEngine(null, entry, 0), { ...entry, name: "new" }, 1);
    expect(l2.engines).toHaveLength(1);
    expect(l2.engines[0].name).toBe("new");
  });
  it("remembers the highest version and flags a lower one as rollback", () => {
    const s = memoryStore();
    rememberVersion(s, USER, 3);
    rememberVersion(s, USER, 2);
    expect(isRollback(s, USER, 2)).toBe(true);
    expect(isRollback(s, USER, 3)).toBe(false);
    expect(isRollback(memoryStore(), USER, 0)).toBe(false);
  });
});
