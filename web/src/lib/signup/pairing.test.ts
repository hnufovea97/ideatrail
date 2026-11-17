import { describe, expect, it } from "vitest";
import { fromB64u, fromHex, toB64u } from "@ideatrail/crypto/bytes";
import { newKemKeyPair, randomKey } from "@ideatrail/crypto/keypair";
import { bytesEqual, pairMac } from "@ideatrail/crypto/mac";
import { KIND, open } from "@ideatrail/crypto/seal";
import { openEngineList } from "../engine-list";
import { buildDeliver } from "./pairing";

const SID = "01jcm3v8q7s2kx4f9d6b5n0tqw";
const USER = "01jcm3v8q7s2kx4f9d6b5n0tqx";

describe("pairing deliver (spec §9-4)", () => {
  it("seals {user_id, account_pubkey} to the engine, MACs it with psk, and adds the engine to the list", async () => {
    const ek = newKemKeyPair();
    const ak = newKemKeyPair();
    const psk = randomKey();
    const vault = { userId: USER, mk: randomKey(), akPriv: ak.priv, akPub: ak.pub };
    const engine = { engine_id: SID, sign_pubkey: "s", kem_pubkey: toB64u(ek.pub), name: "Steven-Air", added_at: "2026-11-18T00:00:00Z" };
    const { body } = await buildDeliver({ sessionId: SID, psk, kemPub: ek.pub, vault, engine, prev: { list: null, version: 0 } });
    const payload = fromB64u(body.payload);
    expect(bytesEqual(pairMac(psk, SID, payload), fromHex(body.mac))).toBe(true);
    const pt = JSON.parse(new TextDecoder().decode(await open(KIND.pairing_payload, ek.priv, { userId: USER }, payload)));
    expect(pt).toEqual({ user_id: USER, account_pubkey: toB64u(ak.pub) });
    expect(body.engine_list_version).toBe(1);
    expect(openEngineList(vault.mk, USER, 1, body.engine_list).engines[0].engine_id).toBe(SID);
  });
});
