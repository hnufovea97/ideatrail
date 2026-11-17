# 공통 시험 벡터

Go(`engine/`)와 TS(`web/`)가 같은 파일로 검증한다. **생성 파일은 손으로 고치지 말고 `make vectors`로 다시 만든다** — Go 테스트 `TestCommittedVectorsUpToDate`가 어긋남을 잡는다.

| 파일 | 출처 |
|---|---|
| `commitment.json` | M0에서 고정 |
| `ots/` | M0 실제 OTS 영수증 (블록 975755) |
| `hpke_rfc9180.json` | 외부 — https://raw.githubusercontent.com/cfrg/draft-irtf-cfrg-hpke/master/test-vectors.json (2026-11-17 받음, sha256 `61fc662f01996cd06d713dacf5e133167bd309a1f329442d53f1e21a47b3ede6`) 중 mode 0x00·0x02, KEM 0x0020, KDF 0x0001, AEAD 0x0003. 암호문은 앞 3개만 |
| `hpke_ideatrail.json` · `pad.json` · `sign.json` · `subkey.json` · `xchacha.json` · `envelope.json` | Go 생성기 `engine/cmd/genvectors` (결정적) |
| `hpke_browser.json` | TS가 봉인(임시 열쇠 무작위) → Go가 풂. `make vectors`가 새로 만듦 |
