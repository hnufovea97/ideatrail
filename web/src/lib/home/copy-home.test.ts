import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHAIN_WORD, COPY } from "../copy";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (p: string) => readFileSync(join(here, p), "utf8");

describe("home and idea-life copy (M5b)", () => {
  it("keeps the blockchain word in one constant (founder may switch 확산됨 → 새겨짐)", () => {
    expect(read("../copy.ts").match(/확산됨/g)).toHaveLength(1);
    expect(COPY.home.chain.done).toBe(`블록체인 ${CHAIN_WORD}`);
    expect(COPY.intro.home.chain.done).toBe(COPY.home.chain.done);
  });
  it("uses the ADR-0018 switch words on both the first screen and the home", () => {
    expect(COPY.home.toggle).toBe("Ideatrail 서버가 가진 데이터");
    expect(COPY.home.serverNote).toBe(COPY.intro.home.serverNote);
    expect(COPY.home.serverNote).toContain("Ideatrail은 어떤 경우에도 내용을 알 수 없어요");
    expect(COPY.life.nameHint).toBe("이 제목은 이 기기에서 풀었어요");
    expect(COPY.home.dates("26.11.03", "26.11.18")).toBe("최초 기록 26.11.03 / 마지막 기록 26.11.18");
  });
});
