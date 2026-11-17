import { describe, expect, it } from "vitest";
import { toB64u, utf8 } from "@ideatrail/crypto/bytes";
import { engineKeysMatch, parseConnectLink, parseStartLink } from "./fragment";

const SID = "01jcm3v8q7s2kx4f9d6b5n0tqw";
const FP9 = "jAzBegSULMT44P4LMCYG0xCIYMEmQouizutfntQcKwU";
const FP10 = "ubB91OdxhFRHbwTt65NQIq5PTZCTSrfOkT_yDIuus5k";
const PSK = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA";
const NAME = "U3RldmVu7J2YIE1hY0Jvb2sgQWly"; // "Steven의 MacBook Air"
const K9 = "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk";
const K10 = "CgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo";
const info = (sign: string, kem: string) => ({ engine_id: SID, sign_pubkey: sign, kem_pubkey: kem, expires_at: "2026-11-18T00:10:00Z", delivered: false });

describe("signup link (spec §9-2)", () => {
  it("reads session id, two fingerprints, psk and the Korean computer name", () => {
    const l = parseStartLink(`?s=${SID}`, `#v1.${FP9}.${FP10}.${PSK}.${NAME}`);
    expect(l?.sessionId).toBe(SID);
    expect(l?.psk.length).toBe(32);
    expect(l?.computerName).toBe("Steven의 MacBook Air");
  });
  it("rejects missing parts, wrong version, bad lengths and bad ids", () => {
    expect(parseStartLink(`?s=${SID}`, "")).toBeNull();
    expect(parseStartLink(`?s=${SID}`, `#v2.${FP9}.${FP10}.${PSK}.${NAME}`)).toBeNull();
    expect(parseStartLink(`?s=${SID}`, `#v1.${FP9}.${FP10}.AQID.${NAME}`)).toBeNull();
    expect(parseStartLink("?s=../x", `#v1.${FP9}.${FP10}.${PSK}.${NAME}`)).toBeNull();
  });
  it("strips control and direction characters from the computer name", () => {
    const evil = toB64u(utf8("Air‮\u0007moc.live​"));
    expect(parseStartLink(`?s=${SID}`, `#v1.${FP9}.${FP10}.${PSK}.${evil}`)?.computerName).toBe("Airmoc.live");
  });
  it("matches the server's engine keys against the link fingerprints", async () => {
    const l = parseStartLink(`?s=${SID}`, `#v1.${FP9}.${FP10}.${PSK}.${NAME}`)!;
    const ok = await engineKeysMatch(l, info(K9, K10));
    expect(ok?.signPub[0]).toBe(9);
    expect(ok?.kemPub[0]).toBe(10);
    expect(await engineKeysMatch(l, info(K10, K10))).toBeNull();
    expect(await engineKeysMatch(l, info(K9, K9))).toBeNull();
  });
  it("reads the device-add link (spec §10-1)", () => {
    expect(parseConnectLink(`?d=${SID}`, `#v1.${PSK}`)?.qpsk.length).toBe(32);
    expect(parseConnectLink(`?d=${SID}`, "")).toBeNull();
  });
});
