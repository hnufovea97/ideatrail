// Three ideas for the home E2E, signed and sealed by the fake engine with real keys. The browser verifies every
// row exactly as it does with the real API; only GET /v1/sync is extended (records need Bitcoin receipts to upload).
import { expect, type Page } from "@playwright/test";
import { fromHex, toB64u, toHex } from "@ideatrail/crypto/bytes";
import { newId } from "@ideatrail/crypto/ids";
import { serializeTimestamp } from "@ideatrail/crypto/ots";
import type { FakeEngine } from "./fake-engine";
import { openSignup, passStepOne } from "./flow";
import { APP } from "./guards";

export const OPEN = "이 기기로 열기";
export const BUDGET = "공정 가계부 앱";
export const SWAP = "동네 중고 교환";
export const PIANO = "피아노 연습 기록기";

interface Spec { title: string; visibility: "private" | "public"; confirmed: boolean; records: Record<string, unknown>[] } // a record may be `confirmed` on its own
/** Text of a record's one file, so its fingerprint is real and its original can be put in the fake GitHub repo. */
export const TEXT: Record<string, string> = {
  "2026-09-03T00:12:00Z": "공정 가계부\n- 월급날 기준으로 달을 나눈다\n- 카드 연동\n",
  "2026-10-02T12:00:00Z": "공정 가계부\n- 월급날 기준으로 달을 나눈다\n- 부부가 같이 쓴다\n",
};
const file = (path: string) => [{ path, size: 10, original: true }];
const IDEAS: Spec[] = [
  { title: BUDGET, visibility: "private", confirmed: false, records: [
    { at: "2026-09-03T00:12:00Z", milestone: "idea", tags: ["기획", "협의"], routine: [{ slot: "problem" }], label: "개요", files: file("아이디어-메모.md"), confirmed: true },
    { at: "2026-10-02T12:00:00Z", milestone: "plan_decided", milestone_certain: true, routine: [{ slot: "audience" }, { slot: "decision_reason", estimated: true }],
      decided: 2, deferred: 1, turn: "카드 연동 빼기", label: "초안", files: file("기획-초안.md") },
    { at: "2026-11-18T12:00:00Z", decided: 1, label: "개선 1", files: file("결정-카드연동.md") },
  ] },
  { title: SWAP, visibility: "public", confirmed: true, records: [
    { at: "2026-09-20T00:00:00Z", milestone: "idea", tags: ["아이디어"], files: file("메모.md") },
    { at: "2026-10-12T00:00:00Z", milestone: "plan_decided", files: file("기획서.md") },
    { at: "2026-10-28T00:00:00Z", milestone: "mvp_done", milestone_certain: true, files: file("README.md") },
  ] },
  { title: PIANO, visibility: "private", confirmed: false, records: [{ at: "2026-10-08T00:00:00Z", tags: ["취미"], files: file("메모.md") }] }, // old: no label
];

const meta = (title: string, r: Record<string, unknown>) => {
  const { at, confirmed: _confirmed, ...rest } = r;
  return { v: 1, title, milestone: "none", milestone_certain: false, files: [], more_files: 0, recorded_at: at, tags: [], routine: [], ...rest };
};

/** The fake GitHub repo of a page (repo path → bytes) holding the original of every record in TEXT. */
export const proofRepos = new WeakMap<Page, Record<string, Uint8Array>>();

/** Block height → merkle root (display order) the fake explorers know. A confirmed record's receipt is the bare bitcoin
 *  attestation on its own fingerprint, so its root is the fingerprint reversed. Each record gets its own height. */
export const blocks = new WeakMap<Page, Map<number, string>>();
const FIRST_HEIGHT = 870_001;
const hashOf = (height: number) => height.toString(16).padStart(64, "0");
const receiptOf = (commitment: string, height: number) => toB64u(serializeTimestamp({ msg: fromHex(commitment), attestations: [{ kind: "bitcoin", height }], ops: [] }));

/** Answer both block explorers locally (the real ones are never asked). `tamper` makes explorer B show another root. */
export async function routeExplorers(page: Page, known: Map<number, string>, tamper = false): Promise<void> {
  const answer = (b: boolean) => async (route: import("@playwright/test").Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const byHeight = /^\/block-height\/(\d+)$/.exec(path);
    if (byHeight) return route.fulfill({ status: 200, body: hashOf(Number(byHeight[1])) });
    const byHash = /^\/block\/([0-9a-f]{64})$/.exec(path);
    const root = byHash ? known.get(parseInt(byHash[1], 16)) : undefined;
    if (!root) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, json: { id: byHash![1], merkle_root: b && tamper ? "11".repeat(32) : root, timestamp: 1_764_000_000 } });
  };
  await page.route("https://blockstream.info/**", answer(false));
  await page.route("https://mempool.space/**", answer(true));
}

async function rows(engine: FakeEngine, changeSeq: number, repo: Record<string, Uint8Array>, known: Map<number, string>) {
  const roots: unknown[] = [], records: unknown[] = [], anchors: unknown[] = [];
  let seq = 0, height = FIRST_HEIGHT;
  for (const idea of IDEAS) {
    const rootId = newId();
    roots.push({ root_id: rootId, visibility: idea.visibility, meta_version: 0, list_meta: null, created_at: idea.records[0].at, deleted_at: null, change_seq: changeSeq });
    for (const r of idea.records) {
      const text = idea.title === BUDGET ? TEXT[r.at as string] : undefined;
      const recordId = newId();
      const proof = text === undefined ? null : await engine.proof({ rootId, recordId, files: [{ path: (r.files as { path: string }[])[0].path, bytes: new TextEncoder().encode(text) }] });
      if (proof) Object.assign(repo, proof.repo);
      const row = await engine.recordRow({ rootId, seq: ++seq, recordedAt: r.at as string, meta: meta(idea.title, r), changeSeq, recordId, commitment: proof?.ref.commitment });
      records.push(row);
      const confirmed = idea.confirmed || r.confirmed === true;
      if (confirmed) known.set(height, toHex(fromHex(row.commitment).reverse()));
      anchors.push({ record_id: row.record_id, status: confirmed ? "confirmed" : "pending", block_height: confirmed ? height : null,
        complete_receipt: confirmed ? receiptOf(row.commitment, height) : null, change_seq: changeSeq });
      if (confirmed) height++;
    }
  }
  return { roots, records, anchors };
}

/** Pages whose explorer B should lie (set before openHome). */
export const tamperExplorers = new WeakSet<Page>();

/** What the browser sent to save a root's list info (POST /v1/roots/:id/meta), kept per page for tests to read. */
export const rootSaves = new WeakMap<Page, Record<string, unknown>[]>();
interface SavedMeta { list_meta: string; meta_version: number }

/** Put the three ideas into every sync answer (a reload starts again from cursor 0) and answer root-meta saves here,
 *  so a saved name set comes back on the next pull. The real API still sees everything else. */
export async function seedIdeas(page: Page, engine: FakeEngine): Promise<void> {
  let built: Awaited<ReturnType<typeof rows>> | null = null;
  const known = new Map<number, string>();
  blocks.set(page, known);
  await routeExplorers(page, known, tamperExplorers.has(page));
  const repo: Record<string, Uint8Array> = {};
  proofRepos.set(page, repo);
  let bump = 0;
  const saved = new Map<string, SavedMeta>();
  const sent: Record<string, unknown>[] = [];
  rootSaves.set(page, sent);
  await page.route("**/v1/sync*", async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { changes: Record<string, unknown[] | undefined>; cursor: number };
    built ??= await rows(engine, Math.max(1, body.cursor), repo, known);
    const add = { ...built, roots: built.roots.map((r) => {
      const row = r as { root_id: string; change_seq: number };
      const s = saved.get(row.root_id);
      return s ? { ...row, list_meta: s.list_meta, meta_version: s.meta_version, change_seq: row.change_seq + 1000 + bump } : r;
    }) };
    const changes = { ...body.changes };
    for (const k of ["roots", "records", "anchors"] as const) changes[k] = [...(changes[k] ?? []), ...add[k]];
    return route.fulfill({ response: res, json: { ...body, changes } });
  });
  await page.route("**/v1/roots/*/meta", async (route) => {
    const req = route.request().postDataJSON() as { list_meta: string; meta_version: number };
    const rootId = /\/v1\/roots\/([^/]+)\/meta/.exec(route.request().url())![1];
    sent.push(req);
    const have = saved.get(rootId)?.meta_version ?? 0;
    if (req.meta_version !== have) return route.fulfill({ status: 409, json: { error: { code: "meta_version_conflict" } } });
    saved.set(rootId, { list_meta: req.list_meta, meta_version: have + 1 });
    bump++;
    return route.fulfill({ json: { meta_version: have + 1 } });
  });
}

/** Sign up (step 1), leave for /home with the three ideas waiting, and open with the device lock. */
export async function openHome(page: Page): Promise<FakeEngine> {
  const { engine } = await openSignup(page, { prf: true });
  await passStepOne(page, engine);
  await seedIdeas(page, engine);
  page.once("dialog", (d) => void d.accept());
  await page.goto(`${APP}/home`);
  await page.getByRole("button", { name: OPEN }).click();
  await expect(page.getByText(/^기록 사슬 정상 · 마지막 확인/)).toBeVisible();
  await expect(page.getByText("3개", { exact: true })).toBeVisible();
  return engine;
}

/** Turn the server-view switch off so the names are readable (and reachable by role). */
export async function deviceView(page: Page): Promise<void> {
  await page.getByLabel("Ideatrail 서버가 가진 데이터").uncheck();
}
