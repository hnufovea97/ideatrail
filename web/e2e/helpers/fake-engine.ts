// Plays the engine side of spec §8, §9 and §15 with real signatures and seals. Keys live only in
// this test process's memory.
import { fromB64u, fromHex, toB64u, toHex, utf8 } from "@ideatrail/crypto/bytes";
import { newId } from "@ideatrail/crypto/ids";
import { newKemKeyPair, randomKey, signPublicKey } from "@ideatrail/crypto/keypair";
import { bytesEqual, pairMac } from "@ideatrail/crypto/mac";
import { KIND, open, openAuth, seal } from "@ideatrail/crypto/seal";
import { messageFor, sign } from "@ideatrail/crypto/sign";
import { API, APP } from "./guards";

/** One record as GET /v1/sync returns it (api/src/routes/sync.ts records columns). */
export interface SyncRecord {
  record_id: string; root_id: string; parent_ids: string; commitment: string; recorded_at: string; engine_id: string; log_seq: string;
  engine_sig: string; list_meta: string; body_hash: string; nonce_hash: string; deleted_at: null; change_seq: number;
}

export interface SuggestedFolder { path: string; name: string; files: number; current?: boolean }
export interface InboxMessage { msg_id: string; body: Record<string, unknown> }

const b64 = async (b: Uint8Array) => toB64u(new Uint8Array(await crypto.subtle.digest("SHA-256", b.slice().buffer)));
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FakeEngine {
  readonly engineId = newId();
  private readonly seed = randomKey();
  readonly signPub = signPublicKey(this.seed);
  private readonly kem = newKemKeyPair();
  private readonly psk = randomKey();
  private reqSeq = 1n;
  private apprSeq = 1n;
  sessionId = "";
  userId = "";
  accountPub: Uint8Array | null = null;

  constructor(private readonly computerName = "Steven-Air") {}

  get kemPub(): Uint8Array {
    return this.kem.pub;
  }

  /** Spec §9-1·2: register the pairing session and build the link the engine would open. */
  async start(): Promise<string> {
    const r = await fetch(`${API}/v1/pairing`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ engine_id: this.engineId, sign_pubkey: toB64u(this.signPub), kem_pubkey: toB64u(this.kem.pub) }),
    });
    if (r.status !== 201) throw new Error(`pairing start ${r.status}`);
    this.sessionId = ((await r.json()) as { session_id: string }).session_id;
    const frag = ["v1", await b64(this.signPub), await b64(this.kem.pub), toB64u(this.psk), toB64u(utf8(this.computerName))].join(".");
    return `${APP}/start?s=${this.sessionId}#${frag}`;
  }

  /** Spec §8 request signature, req_seq strictly increasing. */
  private async signed(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<Response> {
    const raw = body === undefined ? "" : JSON.stringify(body);
    const unixTs = BigInt(Math.floor(Date.now() / 1000));
    const reqSeq = this.reqSeq++;
    const msg = messageFor({ type: "request", method, path, body: utf8(raw), engineId: this.engineId, reqSeq, unixTs });
    return fetch(API + path, {
      method,
      body: method === "GET" || method === "DELETE" ? undefined : raw,
      headers: { "content-type": "application/json", "x-it-engine": this.engineId, "x-it-seq": reqSeq.toString(), "x-it-ts": unixTs.toString(), "x-it-sig": sign(this.seed, msg) },
    });
  }

  /** Spec §9-5: fetch the handoff, check the psk MAC, open kind 8, pin the account key. */
  async takeHandoff(timeoutMs = 30_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const r = await this.signed("GET", `/v1/pairing/${this.sessionId}/blob`);
      if (r.status === 200) {
        const b = (await r.json()) as { user_id: string; payload: string; mac: string };
        const payload = fromB64u(b.payload);
        if (!bytesEqual(pairMac(this.psk, this.sessionId, payload), fromHex(b.mac))) throw new Error("handoff_mac");
        const p = JSON.parse(text(await open(KIND.pairing_payload, this.kem.priv, { userId: b.user_id }, payload))) as { user_id: string; account_pubkey: string };
        if (p.user_id !== b.user_id) throw new Error("handoff_user");
        this.userId = p.user_id;
        this.accountPub = fromB64u(p.account_pubkey);
        return;
      }
      if (r.status !== 404 || Date.now() > until) throw new Error(`blob ${r.status}`);
      await sleep(500);
    }
  }

  private ak(): Uint8Array {
    if (!this.accountPub) throw new Error("not paired");
    return this.accountPub;
  }

  /** Spec §4 kind 11 + §8 approval signature: the signup step 5 folder list. */
  async postSignupSelect(folders: SuggestedFolder[]): Promise<string> {
    const approvalId = newId();
    const summary = await seal(KIND.folder_suggestions, this.ak(), { userId: this.userId, rootId: approvalId, version: "0" }, utf8(JSON.stringify({ v: 1, folders })));
    const apprSeq = this.apprSeq++;
    const sig = sign(this.seed, messageFor({ type: "approval", userId: this.userId, approvalId, kind: "signup_select", summarySealed: summary, apprSeq }));
    const r = await this.signed("POST", "/v1/approvals", { approval_id: approvalId, kind: "signup_select", summary: toB64u(summary), appr_seq: apprSeq.toString(), engine_sig: sig });
    if (r.status !== 201) throw new Error(`approval ${r.status}`);
    return approvalId;
  }

  /** Read, open (Auth mode: must come from the pinned account key) and delete inbox messages. */
  async readInbox(approvalIds: string[] = []): Promise<InboxMessage[]> {
    const r = await this.signed("GET", "/v1/inbox");
    if (!r.ok) throw new Error(`inbox ${r.status}`);
    const { messages } = (await r.json()) as { messages: { msg_id: string; sealed: string }[] };
    const out: InboxMessage[] = [];
    for (const m of messages) {
      for (const rootId of [undefined, ...approvalIds]) {
        try {
          const pt = await openAuth(KIND.engine_inbox, this.kem.priv, this.ak(), { userId: this.userId, rootId, recordId: m.msg_id }, fromB64u(m.sealed));
          out.push({ msg_id: m.msg_id, body: JSON.parse(text(pt)) as Record<string, unknown> });
          break;
        } catch {
          // bound to another approval id (or forged): try the next binding
        }
      }
      const del = await this.signed("DELETE", `/v1/inbox/${m.msg_id}`);
      if (!del.ok) throw new Error(`inbox delete ${del.status}`);
    }
    return out;
  }

  /** A record row signed and sealed like engine/internal/record (kind 1 list meta, §8 record signature over D1's hashes).
   *  E2E only: tests add it to the sync answer, so no Bitcoin calendar is needed (the API checks receipts on upload). */
  async recordRow(o: { rootId: string; seq: number; recordedAt: string; meta: Record<string, unknown>; changeSeq: number }): Promise<SyncRecord> {
    const recordId = newId();
    const sealed = await seal(KIND.record_meta, this.ak(), { userId: this.userId, rootId: o.rootId, recordId, version: "0" }, utf8(JSON.stringify(o.meta)));
    const hex = () => toHex(randomKey());
    const commitment = hex(), body_hash = hex(), nonce_hash = hex();
    const engine_sig = sign(this.seed, messageFor({ type: "record_hashed", userId: this.userId, rootId: o.rootId, recordId, parents: [], commitmentHex: commitment,
      metaSealed: sealed, bodyHashHex: body_hash, nonceHashHex: nonce_hash, logSeq: BigInt(o.seq), recordedAt: o.recordedAt }));
    return { record_id: recordId, root_id: o.rootId, parent_ids: "-", commitment, recorded_at: o.recordedAt, engine_id: this.engineId, log_seq: String(o.seq),
      engine_sig, list_meta: toB64u(sealed), body_hash, nonce_hash, deleted_at: null, change_seq: o.changeSeq };
  }

  /** Spec §4 kind 6 + §8 storage_link signature, as the engine does after GitHub device flow. */
  async putStorageLink(): Promise<void> {
    const token = await seal(KIND.storage_token, this.ak(), { userId: this.userId, version: "0" },
      utf8(JSON.stringify({ token: "fake-token-for-e2e", repo_full_name: "e2e/ideatrail-proofs", repo_id: 1 })));
    const unixTs = BigInt(Math.floor(Date.now() / 1000));
    const sig = sign(this.seed, messageFor({ type: "storage_link", userId: this.userId, engineId: this.engineId, tokenSealed: token, unixTs }));
    const r = await this.signed("PUT", "/v1/storage-link", { enc_token: toB64u(token), engine_sig: sig, unix_ts: Number(unixTs) });
    if (r.status !== 200) throw new Error(`storage link ${r.status}`);
  }
}
