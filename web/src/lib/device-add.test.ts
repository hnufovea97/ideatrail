import { describe, expect, it } from "vitest";
import { newId } from "@ideatrail/crypto/ids";
import { newKemKeyPair, randomKey } from "@ideatrail/crypto/keypair";
import { ApiFailure, type Api } from "./api";
import { joinOffer, offerDevice, pollOffer, prepareDevice, receiveMasterKey, submitDevice } from "./device-add";
import { fakeCredential } from "./testing/fake-credential";
import { parseConnectLink } from "./fragment";

const USER = "01jcm3v8q7s2kx4f9d6b5n0tqw";

/** In-memory stand-in for /v1/device-add (api/src/routes/device-add.ts) — it, too, never checks MACs. */
function fakeServer() {
  type S = { t_pub: string | null; join_mac: string | null; sealed: string | null; key_mac: string | null; used: boolean; secret: string | null };
  const sessions = new Map<string, S>();
  const get = (d: string) => sessions.get(d)!;
  const api = {
    deviceAddStart: async () => {
      const id = newId();
      sessions.set(id, { t_pub: null, join_mac: null, sealed: null, key_mac: null, used: false, secret: null });
      return { session_id: id, expires_at: new Date(Date.now() + 120_000).toISOString() };
    },
    deviceAddState: async (d: string) => {
      const s = get(d);
      return { joined: s.t_pub !== null, t_pub: s.t_pub, join_mac: s.join_mac, key_uploaded: s.sealed !== null, used: s.used, expires_at: "x" };
    },
    deviceAddUpload: async (d: string, b: { sealed_mk: string; mac: string }) => { Object.assign(get(d), { sealed: b.sealed_mk, key_mac: b.mac }); return { uploaded: true }; },
    deviceAddJoin: async (d: string, b: { t_pub: string; mac: string }) => { Object.assign(get(d), { t_pub: b.t_pub, join_mac: b.mac, secret: "sec" }); return { join_secret: "sec" }; },
    deviceAddFetchKey: async (d: string, secret: string) => {
      const s = get(d);
      if (secret !== s.secret) throw new ApiFailure(403, "join_secret_mismatch");
      if (!s.sealed || !s.key_mac) throw new ApiFailure(404, "not_ready");
      return { user_id: USER, sealed_mk: s.sealed, mac: s.key_mac };
    },
  } as unknown as Api;
  return { api, sessions };
}

const vault = () => { const ak = newKemKeyPair(); return { userId: USER, mk: randomKey(), akPriv: ak.priv, akPub: ak.pub }; };
const linkOf = (url: string) => { const u = new URL(url); return parseConnectLink(u.search, u.hash)!; };

describe("device add (spec §10)", () => {
  it("PC seals MK only to the device that proved the QR secret, and the phone gets the same MK", async () => {
    const { api } = fakeServer();
    const v = vault();
    const offer = await offerDevice(api, "http://localhost:4321");
    expect(offer.url).toMatch(/^http:\/\/localhost:4321\/connect\?d=[0-9a-z]{26}#v1\.[A-Za-z0-9_-]{43}$/);
    const l = linkOf(offer.url);
    const joined = await joinOffer(api, l.d, l.qpsk);
    expect(await receiveMasterKey(api, joined)).toBeNull(); // not sent yet
    expect(await pollOffer(api, offer, v)).toBe("sent");
    const got = await receiveMasterKey(api, joined);
    expect(got?.mk).toEqual(v.mk);
    expect(got?.userId).toBe(USER);
  });
  it("a device that does not know the QR secret never gets the key", async () => {
    const { api, sessions } = fakeServer();
    const offer = await offerDevice(api, "http://localhost:4321");
    await joinOffer(api, offer.d, randomKey());
    expect(await pollOffer(api, offer, vault())).toBe("intruder");
    expect(sessions.get(offer.d)?.sealed).toBeNull();
  });
  it("the phone refuses a key whose MAC does not match (server swapped it)", async () => {
    const { api, sessions } = fakeServer();
    const offer = await offerDevice(api, "http://localhost:4321");
    const l = linkOf(offer.url);
    const joined = await joinOffer(api, l.d, l.qpsk);
    await pollOffer(api, offer, vault());
    sessions.get(offer.d)!.key_mac = "00".repeat(32);
    await expect(receiveMasterKey(api, joined)).rejects.toThrow("device_key_mismatch");
  });
  it("a malformed join (bad t_pub or MAC encoding) counts as an intruder: no key upload", async () => {
    const { api, sessions } = fakeServer();
    const offer = await offerDevice(api, "http://localhost:4321");
    await joinOffer(api, offer.d, offer.qpsk);
    sessions.get(offer.d)!.join_mac = "zz";
    expect(await pollOffer(api, offer, vault())).toBe("intruder");
    sessions.get(offer.d)!.join_mac = "00".repeat(32);
    sessions.get(offer.d)!.t_pub = "AAAA";
    expect(await pollOffer(api, offer, vault())).toBe("intruder");
    expect(sessions.get(offer.d)?.sealed).toBeNull();
  });
  it("waiting while nobody joined", async () => {
    const { api } = fakeServer();
    const offer = await offerDevice(api, "http://localhost:4321");
    expect(await pollOffer(api, offer, vault())).toBe("waiting");
  });
  it("a retried phone register/verify sends the same envelope again", async () => {
    const bodies: unknown[] = [];
    let fail = true;
    const api = { registerVerify: async (b: unknown) => { bodies.push(b); if (fail) { fail = false; throw new ApiFailure(503, "unknown"); } return { user_id: USER }; } } as unknown as Api;
    const prf = new Uint8Array(32).fill(2);
    const body = prepareDevice({ challengeId: "c", userId: USER, mk: randomKey(), created: { credential: fakeCredential({ prf }), rawId: Uint8Array.of(1), prf }, prf });
    await expect(submitDevice(api, body)).rejects.toThrow("unknown");
    await submitDevice(api, body);
    expect(JSON.stringify(bodies[1])).toBe(JSON.stringify(bodies[0]));
  });
  it("the QR expires 2 minutes after this browser got it, whatever the server clock says", async () => {
    const { api } = fakeServer();
    const skewed = { ...api, deviceAddStart: async () => ({ ...(await api.deviceAddStart()), expires_at: "1999-01-01T00:00:00Z" }) } as Api;
    const offer = await offerDevice(skewed, "http://localhost:4321", 1_000_000);
    expect(offer.expiresAt).toBe(1_000_000 + 120_000);
  });
});
