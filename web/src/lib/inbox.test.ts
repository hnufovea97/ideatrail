import { describe, expect, it } from "vitest";
import { fromB64u } from "@ideatrail/crypto/bytes";
import { newKemKeyPair, randomKey } from "@ideatrail/crypto/keypair";
import { KIND, openAuth } from "@ideatrail/crypto/seal";
import { sealInbox } from "./inbox";

const USER = "01jcm3v8q7s2kx4f9d6b5n0tqw";
const APPROVAL = "01jcm3v8q7s2kx4f9d6b5n0tqx";

describe("engine inbox messages (kind 7, Auth mode — spec §4, §15)", () => {
  it("connect_github: only the pinned account key can have sent it, root_id is '-'", async () => {
    const ek = newKemKeyPair();
    const ak = newKemKeyPair();
    const v = { userId: USER, mk: randomKey(), akPriv: ak.priv, akPub: ak.pub };
    const m = await sealInbox(v, ek.pub, { type: "connect_github" }, new Date("2026-11-18T01:02:03Z"));
    const pt = await openAuth(KIND.engine_inbox, ek.priv, ak.pub, { userId: USER, recordId: m.msg_id }, fromB64u(m.sealed));
    expect(JSON.parse(new TextDecoder().decode(pt))).toEqual({ v: 1, type: "connect_github", issued_at: "2026-11-18T01:02:03Z" });
    await expect(openAuth(KIND.engine_inbox, ek.priv, newKemKeyPair().pub, { userId: USER, recordId: m.msg_id }, fromB64u(m.sealed))).rejects.toThrow("decrypt_failed");
  });
  it("select_folders is bound to its approval id", async () => {
    const ek = newKemKeyPair();
    const ak = newKemKeyPair();
    const v = { userId: USER, mk: randomKey(), akPriv: ak.priv, akPub: ak.pub };
    const m = await sealInbox(v, ek.pub, { type: "select_folders", approval_id: APPROVAL, folders: ["/a"] });
    const ok = await openAuth(KIND.engine_inbox, ek.priv, ak.pub, { userId: USER, rootId: APPROVAL, recordId: m.msg_id }, fromB64u(m.sealed));
    expect(JSON.parse(new TextDecoder().decode(ok)).folders).toEqual(["/a"]);
    await expect(openAuth(KIND.engine_inbox, ek.priv, ak.pub, { userId: USER, recordId: m.msg_id }, fromB64u(m.sealed))).rejects.toThrow();
  });
});
