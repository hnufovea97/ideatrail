# CLAUDE.md — ideatrail 개발 저장소 (M0 Task 1에서 저장소 루트에 복사)

## 먼저 읽기
1. 설계 핸드오프: `/Users/fovea/Brain/2_프로젝트/아이디어 로그 대시보드/핸드오프.md`
2. 빌드 로드맵: `…/docs/build/00-빌드-로드맵.md` — 지금 마일스톤 확인
3. 지금 마일스톤의 세부 계획: `…/docs/superpowers/plans/`
4. `dev-lens.md`, `docs/todo/`

## 일하는 방식
- 마일스톤 시작 전 superpowers `writing-plans`로 세부 계획 → `subagent-driven-development`로 실행
- **테스트 먼저**(superpowers `test-driven-development`, ECC `tdd-workflow`). 언어를 넘는 규격은 `spec/vectors/`에 먼저 고정하고 Go·TS가 같은 파일로 검증
- "완료"는 자동 확인 명령 출력으로만 말한다 (superpowers `verification-before-completion`)
- 작업 하나 = 커밋 하나. 커밋 메시지는 Conventional Commits
- 명령은 저장소 루트에서 시작하고, 하위 폴더 작업은 `(cd engine && …)`처럼 괄호로 감싼다. Windows 확인은 `powershell -ExecutionPolicy Bypass -File scripts\test.ps1`, CI는 Linux·Mac·Windows 세 곳
- 마일스톤 끝에 ECC `code-reviewer`, 암호·서버·엔진·가입 마일스톤은 ECC `security-reviewer`까지 → 0건

## 절대 어기지 않는 것 (설계문서 기준)
1. 서버는 내용을 읽을 수 없어야 한다 — 서버로 가는 내용은 전부 봉인(HPKE) 또는 재잠금(XChaCha20)
2. 엔진은 **읽는 열쇠를 갖지 않는다**(쓰기 전용, ADR-0001)
3. 서버는 GitHub에 쓰지 않고 GitHub 출입증을 평문으로 다루지 않는다(취소 요청 순간 제외, §3.1.12)
4. 비밀값을 MCP 응답·로그·명령 인자·오류 메시지에 싣지 않는다. 열쇠 내보내기 명령을 만들지 않는다
5. 공개 전환·삭제·공유는 어떤 AI 도구에도 없다. 위험 명령은 대시보드 기기 잠금 승인 뒤에만
6. 직접 암호를 발명하지 않는다 — RFC 9180 HPKE, XChaCha20-Poly1305, HKDF, Ed25519를 감사받은 라이브러리로
7. 외부 스크립트·분석 도구 0, CSP 위반 0
8. 화면 문구에 "코인·비트코인" 금지(`/how` 기술 설명 한 줄 제외), 점수·등급 금지

## 멈추고 founder에게 묻는 경우 (그 밖에는 묻지 않고 진행)
`docs/build/00-빌드-로드맵.md` §"에이전트가 스스로 멈추고 묻는 경우" 5가지만 (기기·계정이 필요한 실험 요청은 한 번에 묶어서). M0 끝 관문 G0에서는 결과와 상관없이 멈춘다. 물을 때는 선택지·추천·영향을 한 화면에.

## 설계 문서
설계 문서(`핸드오프.md` SSOT 목록)는 바꿀 근거가 있을 때만 수정하고, 반드시 ADR(`docs/adr/`)을 함께 남긴다.
