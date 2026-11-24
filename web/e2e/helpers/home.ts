// Three ideas for the home E2E, signed and sealed by the fake engine with real keys. The browser verifies every
// row exactly as it does with the real API; only GET /v1/sync is extended (records need Bitcoin receipts to upload).
import { expect, type Page } from "@playwright/test";
import { newId } from "@ideatrail/crypto/ids";
import type { FakeEngine } from "./fake-engine";
import { openSignup, passStepOne } from "./flow";
import { APP } from "./guards";

export const OPEN = "이 기기로 열기";
export const BUDGET = "공정 가계부 앱";
export const SWAP = "동네 중고 교환";
export const PIANO = "피아노 연습 기록기";

interface Spec { title: string; visibility: "private" | "public"; confirmed: boolean; records: Record<string, unknown>[] }
const file = (path: string) => [{ path, size: 10, original: true }];
const IDEAS: Spec[] = [
  { title: BUDGET, visibility: "private", confirmed: false, records: [
    { at: "2026-09-03T00:12:00Z", milestone: "idea", tags: ["기획", "협의"], routine: [{ slot: "problem" }], label: "개요", files: file("아이디어-메모.md") },
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
  const { at, ...rest } = r;
  return { v: 1, title, milestone: "none", milestone_certain: false, files: [], more_files: 0, recorded_at: at, tags: [], routine: [], ...rest };
};

async function rows(engine: FakeEngine, changeSeq: number) {
  const roots: unknown[] = [], records: unknown[] = [], anchors: unknown[] = [];
  let seq = 0;
  for (const idea of IDEAS) {
    const rootId = newId();
    roots.push({ root_id: rootId, visibility: idea.visibility, meta_version: 0, list_meta: null, created_at: idea.records[0].at, deleted_at: null, change_seq: changeSeq });
    for (const r of idea.records) {
      const row = await engine.recordRow({ rootId, seq: ++seq, recordedAt: r.at as string, meta: meta(idea.title, r), changeSeq });
      records.push(row);
      anchors.push({ record_id: row.record_id, status: idea.confirmed ? "confirmed" : "pending", block_height: idea.confirmed ? 870_000 : null, change_seq: changeSeq });
    }
  }
  return { roots, records, anchors };
}

/** Add the three ideas to the first sync answer; later pulls go to the real API untouched. */
export async function seedIdeas(page: Page, engine: FakeEngine): Promise<void> {
  let done = false;
  await page.route("**/v1/sync*", async (route) => {
    const res = await route.fetch();
    if (done) return route.fulfill({ response: res });
    done = true;
    const body = (await res.json()) as { changes: Record<string, unknown[] | undefined>; cursor: number };
    const add = await rows(engine, Math.max(1, body.cursor));
    const changes = { ...body.changes };
    for (const k of ["roots", "records", "anchors"] as const) changes[k] = [...(changes[k] ?? []), ...add[k]];
    return route.fulfill({ response: res, json: { ...body, changes } });
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
