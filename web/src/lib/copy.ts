// Every sentence the signup pages show. UX설계.md wording where it exists; lines marked "새 문구" are new (decision D4).
// The user's own unlock is always "기기 잠금", never "지문" (founder decision on D2); "지문" is kept only for
// the engine key fingerprint and the content fingerprint.
import { ApiFailure } from "./api";
import type { Checklist, SignupState } from "./signup/machine";

export const CHECKLIST: readonly { key: keyof Checklist; label: string }[] = [
  { key: "pc", label: "열쇠 (이 컴퓨터)" },
  { key: "phone", label: "예비 열쇠 (휴대폰)" },
  { key: "github", label: "증명 보관함 (사용자의 GitHub)" },
  { key: "recovery", label: "비상 열쇠 [중요]" },
  { key: "folders", label: "기록할 폴더 고르기" },
];

// Plain-language words (G1 founder feedback): the device unlock is the 열쇠, the phone the 예비 열쇠, the private
// GitHub repo the 증명 보관함, the recovery key the 비상 열쇠, the engine the 기록 도우미. copy.test.ts bans the
// technical names on screen.
export const COPY = {
  busy: "불러오고 있어요…", // 새 문구
  noscript: "이 페이지는 JavaScript를 켜야 열려요", // 새 문구
  limit: "알아 둘 것: 기록 내용은 Ideatrail 서버로 오지 않아요. 사용자와, 사용자가 함께 쓰는 AI만 봐요.",
  intro: {
    // founder(마케터 관점): 첫 화면은 "나한테 뭐가 좋은가"가 한 번에 와야 함 — 장면 → 한마디 → 좋은 점 3가지 → 안심
    title: "AI와 이야기하다 “이거 괜찮은데?” 싶으면, 한마디면 돼요", // 새 문구
    what: "“기록해 줘”라고 말하면 AI가 대화를 정리해 날짜 증명과 함께 남겨요. 대화가 길어져도 좋은 생각이 묻히지 않아요.", // 새 문구
    exampleTitle: "이렇게 써요", // 새 문구
    example: {
      say: "좋아, 이 방향으로 가자. 왜 이걸 골랐는지까지 기록해 줘",
      reply: "기록했어요 · 가계부 앱 · 단계: 기획 확정 (AI 추정)",
    },
    // ADR-0018: the confirmed home (prototype shape) as a small example, with the server-view switch
    home: {
      title: "나중엔 이렇게 한눈에 봐요 (예시 · 곧 생겨요)", // 새 문구
      name: "가계부 앱",
      nameNote: "이 이름은 이 기기에서 풀었어요", // 새 문구
      first: "11월 3일",
      last: "11월 18일",
      labels: { first: "최초 기록", last: "마지막 기록", decided: "결정", deferred: "미룸", turn: "변곡점", file: "원래 위치" },
      stages: ["착상", "기획 중", "기획 확정", "개발 중", "MVP 완료"],
      current: 2,
      stageRange: "11월 10일 – 18일",
      decided: 2,
      deferred: 1,
      turn: "카드 연동 빼기",
      versions: [
        { when: "11월 18일", what: "개선 1 · 카드 연동 빼기", file: "결정-카드연동.md", fp: "a3f…9c1", chain: "pending" },
        { when: "11월 10일", what: "초안", file: "기획-초안.md", fp: "5d2…0b3", chain: "done" },
      ],
      chain: { done: "블록체인 확산됨", pending: "블록체인 진행 중" },
      toggle: "Ideatrail 서버가 보는 모습", // 새 문구
      deviceNote: "지금은 이 기기에서 풀어 본 모습이에요", // 새 문구
      serverNote: "서버에는 날짜, 지문, 블록체인 상태뿐이에요. 흐린 글자는 잠긴 채로만 있어요", // 새 문구
    },
    benefitsTitle: "써 보면 좋은 점", // 새 문구
    benefits: [
      { key: "say", head: "말 한마디로 정리돼요", body: "“기록해 줘” 한마디면 AI가 정리해서 남겨요. “박제해”처럼 사용자만의 기록 말로 바꿀 수도 있어요. 말하지 않아도 의미 있는 변화가 생기면 알아서 기록해요." },
      { key: "find", head: "나중에 찾기 쉬워요", body: "아이디어마다 어느 단계까지 왔는지, 무엇을 왜 골랐는지, 안 하기로 한 것까지 정리돼요. 지금은 “아이디어 상태 알려줘”로 묻고, 곧 한눈에 보는 화면에서도 봐요." },
      { key: "safe", head: "안심하고 맡겨요", body: "기록 내용은 잠긴 채 사용자의 컴퓨터와 GitHub에만 있어요. Ideatrail 서버에는 날짜와 파일 지문뿐이라, 서버가 털려도 내용은 새지 않아요." },
    ],
    time: "가입은 약 5분 걸려요. 화면이 하라는 대로 누르면 돼요.", // 새 문구
    mapTitle: "안심하고 쓰는 이유: 무엇이 어디에 생기나요", // 새 문구
    map: [
      { key: "pc", name: "열쇠", where: "이 컴퓨터", note: "내용을 여는 열쇠가 이 컴퓨터 안에 생겨요" },
      { key: "phone", name: "예비 열쇠", where: "휴대폰", note: "휴대폰으로도 보고, 컴퓨터를 잃어도 열 수 있어요" },
      { key: "github", name: "증명 보관함", where: "사용자의 GitHub", note: "Ideatrail이 없어져도 사용자 손에 남아요" },
      { key: "recovery", name: "비상 열쇠", where: "종이·비밀번호 관리자", note: "기기를 모두 잃었을 때 쓰는 마지막 열쇠예요" },
    ],
    server: "Ideatrail 서버에는 기록 일시와 파일 지문(기록마다 32바이트), 그리고 Ideatrail도 풀 수 없게 잠긴 이름표뿐이에요. 기록 내용은 잠긴 채 사용자의 컴퓨터와 GitHub에 있고, 사용자의 열쇠로 사용자의 기기에서만 열려요. 그래서 Ideatrail 서버가 털리거나 문을 닫아도 내용은 새지 않아요.", // 새 문구(founder 지적: '우리도 못 연다'는 서버에 내용이 있다는 오해를 줌)
    computer: (name: string) => `연결할 컴퓨터: ${name}`,
    warn: "Claude Code가 직접 연 링크가 아니라면 닫으세요",
    action: "시작하기",
  },
  /** "방금 한 일": shown once at the top of the next screen. */
  did: {
    pc: "✓ 이 컴퓨터에 열쇠를 만들었어요. 사용자의 기록은 이 열쇠로만 열려요",
    phone: "✓ 휴대폰에 예비 열쇠를 만들었어요. 이제 휴대폰으로도 볼 수 있어요",
    github: "✓ 사용자의 GitHub에 증명 보관함을 만들었어요. Ideatrail이 없어져도 증명이 남아요",
    recovery: "✓ 비상 열쇠를 보관했어요. 기기를 모두 잃어도 이걸로 다시 열 수 있어요",
    folders: "✓ 고른 폴더를 기록하기 시작했어요. 몇 분 걸릴 수 있어요",
  },
  pc: {
    title: "이 컴퓨터에 열쇠 만들기",
    why: "기록을 여는 열쇠가 이 컴퓨터 안에 생겨요. 열쇠는 Ideatrail 서버로 오지 않아요.",
    ahead: "버튼을 누르면 Touch ID나 컴퓨터 암호를 한 번 묻는 창이 떠요. 브라우저가 저장할지 물으면 [계속]을 눌러 주세요", // 새 문구
    noSensor: "Touch ID가 없어도 돼요. 이 컴퓨터의 PIN이나 로그인 암호로 만들어져요", // UX 문장에서 "지문" 뺌(founder 결정)
    windows: "Windows에서는 Chrome으로 열고, 저장할 곳을 물으면 Google 비밀번호 관리자를 골라 주세요", // 새 문구(UX ⑥ 안내를 문장으로)
    action: "열쇠 만들기",
    retryPrf: "한 번만 더 확인할게요",
    retryWhy: "열쇠를 마무리하려고 Touch ID나 컴퓨터 암호를 한 번 더 물어요", // 새 문구
    retryAction: "확인",
  },
  phone: {
    title: "휴대폰에 예비 열쇠 만들기",
    why: "출근길에 휴대폰으로 보려고, 그리고 컴퓨터를 잃어도 휴대폰으로 열 수 있게요.",
    ahead: "휴대폰 카메라를 QR에 비추면 링크가 떠요. 누르면 휴대폰 브라우저가 열리고, 거기서 휴대폰 잠금을 한 번 풀면 끝나요", // 새 문구
    scan: "휴대폰 카메라로 찍으세요",
    qrLabel: "휴대폰으로 찍을 QR 코드 (2분 유효). 찍을 수 없으면 아래 'QR을 찍을 수 없어요'에서 링크를 복사하세요",
    noScan: "QR을 찍을 수 없어요", // 새 문구
    copyLink: "링크 복사 (사용자의 휴대폰에서만 열기)", // 새 문구
    linkWarn: "이 링크는 한 번만 쓰는 비밀 열쇠예요. 2분 동안만 쓸 수 있고, 다른 사람에게는 절대 보내지 마세요", // 새 문구
    sent: "휴대폰 화면에서 [이 기기 잠금으로 등록]을 누르고 휴대폰 잠금을 풀어 주세요", // 새 문구
    skip: "휴대폰이 지금 없어요",
  },
  github: {
    title: "증명 보관함 만들기",
    why: "사용자의 GitHub에 비공개 보관함을 하나 만들어, 잠긴 기록 사본과 날짜 증명을 둬요. Ideatrail이 없어져도 사용자 손에 남아요. Ideatrail 앱은 이 보관함 하나에만 쓸 수 있어요.",
    steps: [
      "버튼을 누르면 'ideatrail' 작은 창에 8자리 코드가 보여요. 코드는 이미 복사돼 있어요",
      "이어서 열리는 GitHub 화면의 칸에 붙여 넣고(Mac은 Cmd+V, Windows는 Ctrl+V) [Continue]를 눌러요",
      "GitHub가 'Ideatrail'을 설치하고 승인할지 물으면 [Install]과 [Authorize]를 눌러 주세요",
      "GitHub에 'all set'이나 'Congratulations'가 나오면 끝났어요. 그 GitHub 탭을 닫고 이 화면으로 돌아오세요",
    ],
    action: "GitHub에 보관함 만들기",
    later: "나중에",
    waiting: "GitHub 화면에서 코드를 붙여 넣고 [Authorize]까지 눌러 주세요. GitHub에 'all set'이 나오면 그 탭을 닫고 이 화면으로 돌아오세요. 이 화면은 저절로 넘어가요.", // 새 문구
    banner: "증명 보관함을 아직 안 만들었어요. 만들어 두면 증명이 사용자의 GitHub에도 남아요", // 새 문구
    bannerAction: "지금 만들기",
  },
  recovery: {
    badge: "중요",
    title: "비상 열쇠",
    why: "컴퓨터와 휴대폰을 모두 잃었을 때 쓰는 마지막 열쇠예요. Ideatrail도 대신 열어 드릴 수 없어서 꼭 보관해 주세요",
    method: "어디에 보관할까요?", // 새 문구
    manager: "비밀번호 관리자에 저장",
    managerHelp: "iCloud 키체인, 1Password 같은 곳에 새 항목으로 붙여 넣어요", // 새 문구
    print: "PDF로 인쇄",
    printHelp: "종이로 뽑거나 PDF로 저장해서 서랍처럼 안전한 곳에 둬요", // 새 문구
    ahead: "다음 화면에 비상 열쇠가 딱 한 번 보여요. 이 화면을 지나면 다시 볼 수 없어요", // 새 문구
    make: "지금 만들기",
    later: "나중에",
    copy: "비상 열쇠 복사",
    copyAhead: "[비상 열쇠 복사]를 누른 뒤 비밀번호 관리자에 새 항목으로 붙여 넣어 주세요", // 새 문구
    printAction: "인쇄",
    printAhead: "[인쇄]를 누르면 인쇄 창이 떠요. 종이로 뽑거나 'PDF로 저장'을 골라 주세요", // 새 문구
    wrote: "다 보관했어요", // 새 문구
    firstFour: "앞 4자리",
    firstFourHelp: "제대로 보관했는지 확인할게요. 보관한 비상 열쇠의 앞 4자리를 적어 주세요", // 새 문구
    saveAhead: "[확인하고 저장]을 누르면 Touch ID나 컴퓨터 암호를 한 번 물어요", // 새 문구
    save: "확인하고 저장", // 새 문구
    mismatch: "앞 4자리가 달라요. 보관한 비상 열쇠를 다시 확인해 주세요", // 새 문구
    sheetTitle: "아이디어 로그 비상 열쇠",
    readHint: "4글자씩 끊어 천천히 읽어 보세요", // 새 문구
  },
  folders: {
    title: "기록할 것 고르기",
    why: "이미 있는 문서로 아이디어마다 어디까지 왔는지 점검표를 바로 채워요. 날짜 증명은 오늘부터이고, 원래 날짜는 참고로 붙어요.",
    ahead: "고른 폴더만 기록해요. [기록하기]를 누르면 Touch ID나 컴퓨터 암호를 한 번 물어요", // 새 문구
    current: "지금 프로젝트",
    files: (n: number) => `문서 ${n}개`,
    action: "기록하기",
    none: "새 기록부터 시작하기", // 새 문구
    noneNote: "고른 폴더가 없어요. 앞으로 생기는 변화부터 기록해요", // 새 문구
    split: (later: number) => `한 번에 200개까지예요. 나머지 ${later}개는 다음에 바뀔 때 기록해요`, // 새 문구(결정 D1)
    waiting: "이 컴퓨터의 기록 도우미가 폴더 목록을 보내고 있어요", // 새 문구
    timeout: "기록 도우미가 폴더 목록을 아직 안 보냈어요. Claude Code가 켜져 있는지 확인해 주세요", // 새 문구
    retry: "다시",
  },
  done: {
    title: "준비됐어요",
    mark: "✓",
    phone: "휴대폰에서도 열려요.",
    madeTitle: "만든 것", // 새 문구
    made: [
      { key: "pc", name: "열쇠", where: "이 컴퓨터", when: "평소에 기록을 열 때 써요" },
      { key: "phone", name: "예비 열쇠", where: "휴대폰", when: "휴대폰으로 볼 때, 컴퓨터를 잃었을 때 써요" },
      { key: "github", name: "증명 보관함", where: "사용자의 GitHub", when: "Ideatrail이 없어져도 증명을 꺼낼 때 써요" },
      { key: "recovery", name: "비상 열쇠", where: "종이·비밀번호 관리자", when: "컴퓨터와 휴대폰을 모두 잃었을 때만 써요" },
    ],
    notYet: "아직 안 만들었어요", // 새 문구
    how: "앞으로 이렇게 동작해요",
    lines: [
      "“기록해 줘”라고 하면 그 순간을, 말하지 않아도 의미 있는 변화는 저절로 기록해요. 터미널에 한 줄로 알려 드려요",
      "기록은 몇 시간 뒤 블록체인에 날짜가 새겨져요",
      "공개로 바꾸기·지우기는 대시보드에서 사용자만 할 수 있어요",
    ],
    nextTitle: "이제 Claude Code로 돌아가세요", // 새 문구
    next: [
      "평소처럼 AI와 이야기하세요. “이거 괜찮은데?” 싶으면 “기록해 줘” 한마디면 돼요",
      "어디까지 왔는지 궁금하면 이렇게 물어보세요: “아이디어 상태 알려줘”",
      "기록 말을 바꾸고 싶으면: “기록 말을 ‘박제해’로 바꿔 줘”",
      "기록되면 터미널에 한 줄로 알려 드려요",
    ],
    freshStart: "새 기록부터 남겨요", // 새 문구
    back: "터미널로 돌아가기",
    closeHint: "이 창은 닫아도 돼요", // 새 문구
  },
  connect: {
    title: "이 기기에서도 열기",
    waiting: "컴퓨터와 연결하고 있어요", // 새 문구
    ahead: "버튼을 누르면 휴대폰 잠금을 한 번 물어요. 저장할지 물으면 [계속]을 눌러 주세요", // 새 문구
    action: "이 기기 잠금으로 등록", // 새 문구
    retryWhy: "예비 열쇠를 마무리하려고 휴대폰 잠금을 한 번 더 물어요", // 새 문구
    done: "이 기기에서도 열려요",
    doneMark: "✓",
    did: "✓ 이 휴대폰에 예비 열쇠를 만들었어요. 컴퓨터 화면이 저절로 다음으로 넘어가요", // 새 문구
    a2hs: "브라우저 메뉴(⋮)에서 \"홈 화면에 추가\"를 누르면 앱처럼 열 수 있어요", // 새 문구
    expired: "QR이 만료됐어요. 컴퓨터 화면의 새 QR을 다시 찍어 주세요", // 새 문구
  },
  stop: {
    no_link: "이 창에는 가입 링크가 없어요", // G1: 새로고침하면 링크가 지워지는데 '설치하세요'로 안내돼 헷갈림
    link_mismatch: "이 링크는 이 컴퓨터의 설치와 맞지 않아 멈췄어요. Claude Code에서 설치 링크를 다시 받아 주세요",
    link_expired: "이 링크는 시간이 지났어요. Claude Code에 \"설치 링크 다시 줘\"라고 말해 주세요",
    link_used: "이 링크는 이미 쓰였어요. Claude Code에서 설치 링크를 다시 받아 주세요", // 새 문구
    no_prf: "이 브라우저에서는 열쇠를 만들 수 없어요. Chrome이나 Safari로 열어 주세요",
    prf_missing: "이 브라우저에선 열쇠로 내용을 열 수 없어요. Chrome이나 Safari 최신 버전으로 열어 주세요",
    offline: "인터넷이 끊겼어요. 연결되면 다시 불러올게요",
    not_registered: "이 기기는 아직 등록 안 됐어요. 쓰던 기기에서 '기기 추가'를 눌러 주세요",
    failed: "잠시 문제가 생겼어요. Claude Code에서 설치 링크를 다시 받아 주세요", // 새 문구
  },
  noLink: {
    why: "새로고침하면 보안을 위해 링크가 지워져요. Claude Code를 닫았다가 다시 켜고 “이 기획 기록해줘”라고 말하면 새 링크로 열려요. 새 창에서는 새로고침하지 말고 그대로 진행해 주세요.", // 새 문구
    install: "아직 설치하지 않았다면 이 한 줄을 Claude Code에 붙여 넣어 주세요: /plugin install ideatrail", // 새 문구
  },
  actions: { copy: "복사", copyCommand: "명령 복사", copyLink: "링크 복사", copied: "복사했어요", copyFailed: "복사하지 못했어요. 직접 선택해서 복사하세요", retry: "다시" },
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

/** The "방금 한 일" line for the screen after a finished step; nothing after a skip. */
export const didLine = (s: SignupState): string | null => (s.justDid ? COPY.did[s.justDid] : null);

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
