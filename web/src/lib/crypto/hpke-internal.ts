// HPKE suite and raw contexts. Internal: only seal.ts and testing.ts import this.
import { CipherSuite, HkdfSha256 } from "@hpke/core";
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";
import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { ab } from "./bytes";

export const suite = new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305() });
export const importPub = (b: Uint8Array): Promise<CryptoKey> => suite.kem.importKey("raw", ab(b), true);
export const importPriv = (b: Uint8Array): Promise<CryptoKey> => suite.kem.importKey("raw", ab(b), false);

export async function recipientContext(p: { recipientPriv: Uint8Array; enc: Uint8Array; info: Uint8Array; senderPub?: Uint8Array }) {
  return suite.createRecipientContext({
    recipientKey: await importPriv(p.recipientPriv),
    enc: ab(p.enc),
    info: ab(p.info),
    senderPublicKey: p.senderPub ? await importPub(p.senderPub) : undefined,
  });
}
