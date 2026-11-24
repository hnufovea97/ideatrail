import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHAIN_WORD, COPY } from "../copy";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""); // comments may explain in Korean

describe("home and idea-life copy (M5b)", () => {
  it("keeps the blockchain word in one constant (founder may switch 확산됨 → 새겨짐)", () => {
    expect(read("../copy.ts").match(/확산됨/g)).toHaveLength(1);
    expect(COPY.home.chain.done).toBe(`블록체인 ${CHAIN_WORD}`);
    expect(COPY.intro.home.chain.done).toBe(COPY.home.chain.done);
  });
  it("puts every on-screen sentence in copy.ts: the home components hold no Korean text", () => {
    const dir = "../../components/home";
    for (const f of readdirSync(join(here, dir)).filter((n) => n.endsWith(".tsx"))) {
      expect([f, code(`${dir}/${f}`).match(/[가-힣]/g)]).toEqual([f, null]);
    }
    expect(code("../../components/ui/ServerToggle.tsx").match(/[가-힣]/g)).toBeNull();
  });
  it("uses the ADR-0018 switch words on both the first screen and the home", () => {
    expect(COPY.home.toggle).toBe("Ideatrail 서버가 가진 데이터");
    expect(COPY.home.serverNote).toBe(COPY.intro.home.serverNote);
    expect(COPY.home.serverNote).toContain("Ideatrail은 어떤 경우에도 내용을 알 수 없어요");
    expect(COPY.life.nameHint).toBe("이 제목은 이 기기에서 풀었어요");
    expect(COPY.home.dates("26.11.03", "26.11.18")).toBe("최초 기록 26.11.03 / 마지막 기록 26.11.18");
  });
});
