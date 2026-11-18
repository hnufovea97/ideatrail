// Every sentence the signup pages show. UX설계.md wording where it exists; lines marked "새 문구" are new (decision D4).
// The user's own unlock is always "기기 잠금", never "지문" (founder decision on D2); "지문" is kept only for
// the engine key fingerprint and the content fingerprint.
import { ApiFailure } from "./api";
import type { Checklist } from "./signup/machine";

export const CHECKLIST: readonly { key: keyof Checklist; label: string }[] = [
  { key: "pc", label: "이 컴퓨터 잠금" },
  { key: "phone", label: "휴대폰 잠금" },
  { key: "github", label: "GitHub 계정" },
  { key: "recovery", label: "복구 키 [중요]" },
  { key: "folders", label: "기록할 폴더 고르기" },
];

export const COPY = {
  limit: "알아 둘 것: 내용은 당신과, 함께 작업하는 AI만 봐요. 우리 서버는 못 봐요.",
  intro: {
    title: "시작하기 전에",
    computer: (name: string) => `연결할 컴퓨터: ${name}`,
    warn: "Claude Code가 직접 연 링크가 아니라면 닫으세요",
    action: "시작하기",
  },
  pc: {
    title: "이 컴퓨터",
    why: "내용을 잠그는 열쇠를 이 컴퓨터 안에 만들어요. 열쇠는 우리 서버로 오지 않아요.",
    noSensor: "센서가 없어도 돼요. 이 컴퓨터의 PIN이나 로그인 암호로 기기 잠금을 만들어요", // UX 문장에서 "지문" 뺌(founder 결정)
    windows: "Windows에서는 Chrome에서 Google 비밀번호 관리자에 저장되는 패스키로 만들어 주세요", // 새 문구(UX ⑥ 안내를 문장으로)
    action: "이 컴퓨터로 시작하기",
    retryPrf: "한 번만 더 확인할게요",
    retryAction: "확인",
  },
  phone: {
    title: "휴대폰도 같이 등록",
    why: "출근길에 휴대폰으로 보려고, 그리고 기기 하나를 잃어도 다른 기기로 열 수 있게요.",
    scan: "휴대폰 카메라로 찍으세요",
    qrLabel: "휴대폰으로 찍을 QR 코드 (2분 유효)",
    sent: "휴대폰에서 기기 잠금을 해 주세요", // 새 문구
    skip: "휴대폰이 지금 없어요",
  },
  github: {
    title: "GitHub 보관",
    why: "증명과 원문을 당신 저장소에 둬요. 우리 서비스가 없어져도 당신 손에 남아요. 우리는 이 저장소 하나에만 들어갈 수 있어요.",
    steps: ["다음 화면에서 [Install]을 누르면 돼요", "이어서 GitHub 승인 페이지가 열리고 8자리 코드가 이미 복사돼 있어요: 붙여넣기 → [승인]"],
    action: "GitHub에 보관하기",
    later: "나중에",
    waiting: "GitHub 승인 페이지에서 코드를 붙여 넣고 [승인]을 눌러 주세요. 끝나면 저절로 넘어가요.", // 새 문구
    banner: "증명을 GitHub에 보관하세요 · PC의 Claude Code에서 이어서 해요",
    bannerAction: "지금 연결",
  },
  recovery: {
    badge: "중요",
    title: "복구 키",
    why: "기기를 모두 잃으면 이것만이 열쇠예요. 우리도 대신 열어 드릴 수 없어요",
    method: "보관 방법",
    manager: "비밀번호 관리자에 저장",
    print: "PDF로 인쇄",
    make: "지금 만들기",
    later: "나중에",
    copy: "복사",
    printAction: "인쇄",
    wrote: "다 적었어요", // 새 문구
    firstFour: "앞 4자리",
    firstFourHelp: "방금 보관한 복구 키의 앞 4자리를 적어 주세요", // 새 문구
    save: "확인하고 저장", // 새 문구
    mismatch: "앞 4자리가 달라요. 보관한 복구 키를 다시 확인해 주세요", // 새 문구
    sheetTitle: "아이디어 로그 복구 키",
  },
  folders: {
    title: "기록할 것 고르기",
    why: "이미 있는 문서로 아이디어마다 어디까지 왔는지 점검표를 바로 채워요. 날짜 증명은 오늘부터이고, 원래 날짜는 참고로 붙어요.",
    current: "지금 프로젝트",
    files: (n: number) => `문서 ${n}`,
    action: "기록하기",
    none: "새 기록부터 시작하기", // 새 문구
    noneNote: "고른 폴더가 없어요. 앞으로 생기는 변화부터 기록해요", // 새 문구
    split: (later: number) => `한 번에 200개까지예요. 나머지 ${later}개는 다음에 바뀔 때 기록해요`, // 새 문구(결정 D1)
    waiting: "이 컴퓨터의 엔진이 폴더 목록을 보내고 있어요", // 새 문구
    timeout: "엔진이 폴더 목록을 아직 안 보냈어요. Claude Code가 켜져 있는지 확인해 주세요", // 새 문구
    retry: "다시",
  },
  done: {
    title: "준비됐어요 ✓",
    phone: "휴대폰에서도 열려요.",
    how: "앞으로 이렇게 동작해요",
    lines: [
      "AI와 작업하면 의미 있는 변화만 저절로 기록해요. 터미널에 한 줄로 알려 드려요",
      "기록은 몇 시간 뒤 블록체인에 날짜가 새겨져요",
      "공개로 바꾸기·지우기는 이 대시보드에서 당신만 할 수 있어요",
    ],
    freshStart: "새 기록부터 남겨요", // 새 문구
    back: "터미널로 돌아가기",
    closeHint: "이 창은 닫아도 돼요", // 새 문구
  },
  connect: {
    title: "이 기기에서도 열기",
    waiting: "컴퓨터와 연결하고 있어요", // 새 문구
    action: "이 기기 잠금으로 등록", // 새 문구
    done: "이 기기에서도 열려요 ✓",
    a2hs: "브라우저 메뉴(⋮)에서 \"홈 화면에 추가\"를 누르면 앱처럼 열 수 있어요", // 새 문구
    expired: "QR이 만료됐어요. 컴퓨터 화면의 새 QR을 다시 찍어 주세요", // 새 문구
  },
  stop: {
    no_link: "이 한 줄을 Claude Code에 붙여넣어 주세요: /plugin install ideatrail",
    link_mismatch: "이 링크는 이 컴퓨터의 설치와 맞지 않아 멈췄어요. Claude Code에서 설치 링크를 다시 받아 주세요",
    link_expired: "이 링크는 시간이 지났어요. Claude Code에 \"설치 링크 다시 줘\"라고 말해 주세요",
    link_used: "이 링크는 이미 쓰였어요. Claude Code에서 설치 링크를 다시 받아 주세요", // 새 문구
    no_prf: "이 브라우저에서는 열쇠를 만들 수 없어요. Chrome이나 Safari로 열어 주세요",
    prf_missing: "이 브라우저에선 내용을 풀 수 없어요. Chrome(Google 계정 패스키)이나 Safari 최신 버전으로 열어 주세요",
    offline: "인터넷이 끊겼어요. 연결되면 다시 불러올게요",
    not_registered: "이 기기는 아직 등록 안 됐어요. 쓰던 기기에서 '기기 추가'를 눌러 주세요",
  },
  actions: { copy: "복사", copyLink: "링크 복사", copied: "복사했어요", retry: "다시" },
  errors: {
    passkey_cancel: "기기 잠금 확인이 안 됐어요. 다시 해 볼까요?", // UX 오류표 "지문 확인" → "기기 잠금 확인"(founder 결정)
    qr_expired: "2분이 지나서 새로 만들었어요",
    qr_intruder: "다른 기기가 먼저 연결을 시도해서 멈췄어요. 새 QR을 만들었어요", // 새 문구
    github_not_done: "GitHub 승인이 끝나지 않았어요. Claude Code에서 다시 시작할게요",
    offline: "인터넷이 끊겼어요. 연결되면 다시 불러올게요",
    generic: "잠시 문제가 생겼어요. 다시 해 볼까요?", // 새 문구
    verify_unsure: "연결을 확인하고 다시 해 주세요", // 새 문구: 등록 응답이 끊김, 아무것도 지우지 않음
  },
} as const;

/** A fixed sentence for any failure. Server messages and exception text never reach the screen. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.code === "offline") return COPY.errors.offline;
    if (e.code === "device_add_expired") return COPY.connect.expired;
    if (e.code === "stepup_required" || e.code === "webauthn_failed") return COPY.errors.passkey_cancel;
    return COPY.errors.generic;
  }
  if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError")) return COPY.errors.passkey_cancel;
  return COPY.errors.generic;
}
