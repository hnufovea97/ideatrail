import { describe, expect, it } from "vitest";
import { fromB64u, toB64u, utf8 } from "@ideatrail/crypto/bytes";
import { newId } from "@ideatrail/crypto/ids";
import { newKemKeyPair, randomKey, signPublicKey } from "@ideatrail/crypto/keypair";
import { KIND, openAuth, seal } from "@ideatrail/crypto/seal";
import { messageFor, sign } from "@ideatrail/crypto/sign";
import type { ApprovalRow } from "./api";
import { buildDecision, initialSelection, openSuggestions, planImport, signupApproval } from "./folders";

const USER = "01jcm3v8q7s2kx4f9d6b5n0tqw";
const ENGINE = "01jcm3v8q7s2kx4f9d6b5n0tqx";
const seed = randomKey();
const engine = { engine_id: ENGINE, sign_pubkey: toB64u(signPublicKey(seed)), kem_pubkey: "k", name: "n", added_at: "x" };
const ak = newKemKeyPair();
const vault = { userId: USER, mk: randomKey(), akPriv: ak.priv, akPub: ak.pub };

async function approval(folders: unknown[], signer = seed, kind = "signup_select", apprSeq = 1n): Promise<ApprovalRow> {
  const id = newId();
  const summary = await seal(KIND.folder_suggestions, ak.pub, { userId: USER, rootId: id, version: "0" }, utf8(JSON.stringify({ v: 1, folders })));
  const engine_sig = sign(signer, messageFor({ type: "approval", userId: USER, approvalId: id, kind, summarySealed: summary, apprSeq }));
  return { approval_id: id, engine_id: ENGINE, kind, summary: toB64u(summary), appr_seq: apprSeq.toString(), engine_sig, created_at: "x", expires_at: "y" };
}

describe("signup step 5 folders (spec §4 kind 11, §15)", () => {
  it("only an approval signed by this engine counts", async () => {
    const good = await approval([{ path: "/p", name: "p", files: 1 }]);
    const forged = await approval([{ path: "/etc", name: "x", files: 1 }], randomKey());
    expect(signupApproval([forged], engine, USER)).toBeNull();
    expect(signupApproval([forged, good], engine, USER)?.approval_id).toBe(good.approval_id);
    expect(signupApproval([{ ...good, engine_id: USER }], engine, USER)).toBeNull();
    const other = await approval([{ path: "/etc", name: "x", files: 1 }]);
    expect(signupApproval([{ ...good, summary: other.summary }], engine, USER)).toBeNull(); // server swapped the sealed list
    expect(signupApproval([{ ...good, kind: "import" }], engine, USER)).toBeNull();
    expect(signupApproval([{ ...good, appr_seq: "x" }], engine, USER)).toBeNull();
  });
  it("picks the valid one with the highest appr_seq, not the last row (created_at ties at one second)", async () => {
    const newer = await approval([{ path: "/a", name: "a", files: 1 }], seed, "signup_select", 3n);
    const older = await approval([{ path: "/b", name: "b", files: 1 }], seed, "signup_select", 2n);
    const forgedHigh = await approval([{ path: "/etc", name: "x", files: 1 }], randomKey(), "signup_select", 9n);
    expect(signupApproval([newer, older, forgedHigh], engine, USER)?.approval_id).toBe(newer.approval_id);
    expect(signupApproval([older, newer], engine, USER)?.approval_id).toBe(newer.approval_id);
    const big = await approval([{ path: "/c", name: "c", files: 1 }], seed, "signup_select", 2n ** 60n);
    expect(signupApproval([big, newer], engine, USER)?.approval_id).toBe(big.approval_id); // compared as BigInt, not Number
  });
  it("opens the sealed list; current project on, suggestions off; first is current when none is marked", async () => {
    const marked = await openSuggestions(vault, await approval([{ path: "/a", name: "아이디어 로그", files: 18, current: true }, { path: "/b", name: "가계부 앱", files: 12, current: false }]));
    expect([...initialSelection(marked)]).toEqual(["/a"]);
    const legacy = await openSuggestions(vault, await approval([{ path: "/only", name: "only", files: 3 }]));
    expect(legacy[0].current).toBe(true);
  });
  it("drops malformed entries and cleans names", async () => {
    const fs = await openSuggestions(vault, await approval([{ path: "/a", name: "ok‮gnp.exe", files: 2 }, { path: 3, name: "x", files: 1 }, { path: "/c", name: "c", files: -1 }]));
    expect(fs.map((f) => f.name)).toEqual(["okgnp.exe"]);
  });
  it("counts files and splits at 200", async () => {
    const fs = [{ path: "/a", name: "a", files: 150, current: true }, { path: "/b", name: "b", files: 51, current: false }];
    expect(planImport(fs, new Set(["/a", "/b"]))).toEqual({ files: 201, later: 1 });
    expect(planImport(fs, new Set(["/a"]))).toEqual({ files: 150, later: 0 });
  });
  it("decision: approved with the chosen paths, rejected with none — sealed to the engine, bound to the approval", async () => {
    const ek = newKemKeyPair();
    const id = newId();
    const yes = await buildDecision(vault, ek.pub, id, ["/a"]);
    expect(yes.decision).toBe("approved");
    const pt = await openAuth(KIND.engine_inbox, ek.priv, ak.pub, { userId: USER, rootId: id, recordId: yes.message.msg_id }, fromB64u(yes.message.sealed));
    expect(JSON.parse(new TextDecoder().decode(pt))).toMatchObject({ v: 1, type: "select_folders", approval_id: id, folders: ["/a"] });
    expect((await buildDecision(vault, ek.pub, id, [])).decision).toBe("rejected");
  });
});
