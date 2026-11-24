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

/** The one place the blockchain word lives (ADR-0018: it means "included in a block"; founder may still switch it to 새겨짐). */
export const CHAIN_WORD = "확산됨";
const CHAIN = { done: `블록체인 ${CHAIN_WORD}`, pending: "블록체인 진행 중" } as const;
// ADR-0018 switch: the same words on the first screen and on the home
const SERVER_TOGGLE = "Ideatrail 서버가 가진 데이터"; // 새 문구
const SERVER_NOTE = "선명한 글자는 Ideatrail이 보관하는 데이터예요. 흐린 글자는 사용자의 컴퓨터와 GitHub에 있는 개인 데이터로, 사용자가 기기에서 잠금을 풀 때만 보여요. Ideatrail은 어떤 경우에도 내용을 알 수 없어요"; // 새 문구 (founder 2026-11-23)
const DEVICE_NOTE = "지금은 이 기기에서 풀어 본 모습이에요. 다시 켜면 Ideatrail이 보관하는 데이터만 선명하게 남아요"; // 새 문구

/** Stage names by preset id (founder 2026-11-24: names may become per-idea later — 개발/글쓰기/연구 or AI-suggested).
 *  Only "build" exists in M5b. Always 5 names: the five slots and the milestone enum stay fixed (spec §15 M5a, G9). */
export const STAGE_PRESETS = {
  build: ["착상", "기획 중", "기획 확정", "개발 중", "MVP 완료"],
} as const satisfies Record<string, readonly [string, string, string, string, string]>;
const STAGES = STAGE_PRESETS.build;

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
      first: "26.11.03",
      last: "26.11.18",
      labels: { first: "최초 기록", last: "마지막 기록", decided: "결정", deferred: "미룸", turn: "변곡점", file: "원래 위치" },
      stages: STAGES,
      current: 2,
      stageRange: "11.10 – 11.18",
      decided: 2,
      deferred: 1,
      turn: "카드 연동 빼기",
      versions: [
        { when: "11.18", what: "개선 1 · 카드 연동 빼기", file: "결정-카드연동.md", fp: "a3f…9c1", chain: "pending" },
        { when: "11.10", what: "초안", file: "기획-초안.md", fp: "5d2…0b3", chain: "done" },
      ],
      chain: CHAIN,
      toggle: SERVER_TOGGLE,
      serverFirst: true, // founder: 처음엔 서버 눈으로 보여 줌
      deviceNote: DEVICE_NOTE,
      serverNote: SERVER_NOTE,
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
  // M5a 대시보드. UX ④ 로그인 문장은 주어 규칙에 맞춰 바꿈("우리도 못 봐요"·"내 생각의 기록" → 아래), 기술 낱말 "엔진"은 쓰지 않음
  dash: {
    lockTitle: "생각의 기록", // UX "내 생각의 기록"에서 '내' 뺌
    lockLead: "기록 내용은 이 기기에서만 풀려요. 기기 잠금 한 번이면 다 보여요.", // 새 문구
    open: "이 기기로 열기",
    openHint: "Touch ID·얼굴·PIN·컴퓨터 암호 중 이 기기에 설정된 것", // UX ④ 작은 글씨 ("지문" 대신 Touch ID — founder D2)
    opening: "기기 안에서 푸는 중…",
    lockNow: "지금 잠그기", // 새 문구
    lockedIdle: (m: number) => `${m}분 동안 쓰지 않아서 잠갔어요. 다시 열어 주세요`, // 새 문구
    cover: "화면을 가려 두었어요", // 새 문구 (흐림 가림막)
    mirrorFailed: "증명 보관함에 목록 사본을 아직 못 썼어요. 다음 확인 때 다시 해 볼게요", // 새 문구 (GitHub 거울 실패)
    chain: {
      ok: (time: string) => `기록 사슬 정상 · 마지막 확인 ${time}`,
      checking: "기록 사슬을 확인하고 있어요…", // 새 문구
      warn: "기록이 빠졌을 수 있어요. 서버 쪽 문제일 수 있어요. 기록한 컴퓨터에서 Claude Code를 한 번 열어 주세요", // UX 오류표, '엔진' → Claude Code
    },
    errors: {
      passkey_cancel: "기기 잠금 확인이 안 됐어요. 다시 해 볼까요?",
      prf_missing: "이 브라우저에선 열쇠로 내용을 열 수 없어요. Chrome이나 Safari 최신 버전으로 열어 주세요",
      not_registered: "이 기기는 아직 등록 안 됐어요. 쓰던 기기에서 '기기 추가'를 눌러 주세요",
      retry: "잠깐 시간이 지났어요. 잠시 뒤 [이 기기로 열기]를 다시 눌러 주세요", // 새 문구 (확인 기한 지남·시도가 많음)
      offline: "인터넷이 끊겼어요. 연결되면 다시 불러올게요",
      account_mismatch: "서버에 있는 계정 열쇠가 이 기기에서 푼 것과 달라 열지 않았어요. 잠시 뒤 다시 해 주세요", // 새 문구
      engine_list_rollback: "서버가 예전 기록 도우미 목록을 보여 줘서 열지 않았어요. 쓰던 다른 기기에서 열어 확인해 주세요", // 새 문구
      browser_unsupported: "이 브라우저에선 기기 잠금을 쓸 수 없어요. Chrome이나 Safari에서 열어 주세요", // 새 문구 (G2)
      failed: "잠시 문제가 생겼어요. 다시 해 볼까요?",
    },
    inApp: { // 새 문구 (G2: 카카오톡 안 브라우저에서 기기 잠금 실패)
      kakao: "카카오톡 안에서는 기기 잠금을 쓸 수 없어요. 아래 버튼으로 휴대폰 브라우저에서 열어 주세요",
      other: "앱 안의 브라우저에서는 기기 잠금을 쓸 수 없어요. 오른쪽 위 메뉴에서 '다른 브라우저로 열기'를 눌러 주세요",
      openOutside: "휴대폰 브라우저로 열기",
    },
    errorCode: "오류 표시:", // 새 문구 (G2: 원인 찾기용, 오류 이름만)
  },
  // M5d 승인·기록 도우미 관리·설정. 새 문구는 모두 "새 문구"
  manage: {
    settingsOpen: "설정", // 새 문구
    back: "돌아가기", // 새 문구
    banner: (n: number) => `승인을 기다리는 요청이 ${n}개 있어요`, // 새 문구
    bannerAction: "보기", // 새 문구
    stepupAhead: "누르면 Touch ID나 컴퓨터 암호를 한 번 물어요", // 새 문구
    approvals: {
      title: "승인을 기다리는 요청", // 새 문구
      none: "기다리는 요청이 없어요", // 새 문구
      kinds: { import: "가져오기", add_folder: "폴더 추가", forget_original: "원문 지우기", disconnect: "연결 끊기" },
      from: (name: string) => `${name}에서 온 요청`, // 새 문구
      files: (n: number) => `문서 ${n}개`,
      noFolders: "고른 폴더가 없어요", // 새 문구
      expires: (when: string) => `${when}까지 답해 주세요`, // 새 문구
      approve: "허락하기", // 새 문구
      reject: "거절하기", // 새 문구
      list: "요청 목록", // 새 문구
    },
    engines: {
      title: "이 컴퓨터의 기록 도우미", // 새 문구
      none: "연결된 기록 도우미가 없어요. 다른 컴퓨터에서 연결할 때까지 대시보드는 보기만 돼요", // 새 문구
      added: (d: string) => `연결한 날 ${d}`, // 새 문구
      last: (d: string, n: number) => `마지막 기록 ${d} · 기록 ${n}개`, // 새 문구
      noRecords: "아직 기록이 없어요", // 새 문구
      running: "잘 돌고 있어요", // 새 문구
      pausedUser: "잠시 멈춰 둔 상태예요", // 새 문구
      pausedAuto: "기록이 갑자기 많아져서 멈췄어요", // 새 문구
      disconnected: "끊김", // 새 문구
      pause: "잠시 멈추기", // 새 문구
      resume: "다시 켜기", // 새 문구
      disconnect: "연결 끊기", // 새 문구
      confirmDisconnect: "이 컴퓨터의 기록 도우미를 끊을게요. 기록을 남기던 열쇠를 폐기하고, 그 도우미의 GitHub 출입증도 자동으로 취소해요. 이미 남긴 기록은 그대로 확인돼요", // 새 문구
      lastOne: "다른 컴퓨터에서 연결할 때까지 대시보드는 보기만 돼요", // 새 문구
      confirmYes: "끊기", // 새 문구
      cancel: "그만두기", // 새 문구
      notLoaded: "기록을 아직 다 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요", // 새 문구
    },
    autoLock: {
      title: "자동 잠금", // 새 문구
      why: "쓰지 않으면 이 시간 뒤에 저절로 잠겨요", // 새 문구
      minutes: (m: number) => `${m}분`,
      saved: "저장했어요", // 새 문구
    },
    routine: {
      title: "루틴 점검 보기", // 새 문구
      label: "아이디어 카드에 루틴 점검 보이기", // 새 문구
      note: "이 기기에만 저장돼요. 끄면 화면에서만 숨기고, 기록은 그대로 채워져요", // 새 문구
    },
    recovery: {
      title: "비상 열쇠", // 새 문구
      none: "아직 만들지 않았어요", // 새 문구
      made: (d: string) => `${d}에 만들었어요`, // 새 문구
      make: "만들기", // 새 문구
      remake: "다시 만들기", // 새 문구
      remakeNote: "다시 만들면 예전 비상 열쇠는 쓸 수 없게 돼요", // 새 문구
    },
    devices: {
      title: "기기 목록", // 새 문구
      thisOne: "이 기기", // 새 문구
      added: (d: string) => `등록 ${d}`, // 새 문구
      lastUsed: (d: string) => `마지막 사용 ${d}`, // 새 문구
      neverUsed: "아직 쓴 적 없어요", // 새 문구
      remove: "이 기기 빼기", // 새 문구
      confirm: "이 기기의 기기 잠금을 빼면 이 기기로는 더 열 수 없어요. 다른 기기에서 열고 있는 화면도 닫혀요", // 새 문구
      confirmThis: "지금 쓰는 기기를 빼는 거예요. 빼고 나면 이 기기로는 열 수 없어요", // 새 문구
      confirmYes: "빼기", // 새 문구
      lastDevice: "마지막 남은 기기 잠금은 뺄 수 없어요. 다른 기기를 먼저 추가해 주세요", // 새 문구
    },
    account: {
      title: "계정 지우기", // 새 문구
      why: "지우기 전에 무엇이 사라지고 무엇이 남는지 확인해 주세요", // 새 문구
      removedHead: "지워지는 것", // 새 문구
      removed: "Ideatrail 서버의 계정·목록·열쇠 보관본·사용 지표·감사 기록. 개인을 구분할 수 없는 합계만 남아요", // 새 문구
      keptHead: "남는 것", // 새 문구
      keptChain: "블록체인에 남은 지문. 영구적이고, 누구 것인지는 알 수 없어요", // 새 문구
      keptGithub: "사용자의 GitHub에 있는 증명 묶음과 원문. 사용자 소유라 그대로 있어요", // 새 문구
      keepBundles: "증명 묶음을 따로 보관해 두세요. 계정을 지운 뒤에는 이 화면에서 볼 수 없어요", // 새 문구
      start: "계정 지우기", // 새 문구
      confirm: "정말 지울까요? 되돌릴 수 없어요", // 새 문구
      yes: "계정 지우기", // 새 문구
      notice: "계정을 지웠어요. 이 기기에 남은 열쇠도 지웠어요", // 새 문구
    },
    errors: {
      last_device: "마지막 남은 기기 잠금은 뺄 수 없어요. 다른 기기를 먼저 추가해 주세요",
      engine_list_conflict: "다른 기기에서 목록이 바뀌었어요. 다시 열어서 해 주세요", // 새 문구
      approval_closed: "이미 답했거나 기한이 지난 요청이에요. 목록을 새로 불러왔어요", // 새 문구
      not_found: "찾을 수 없어요. 목록을 새로 불러왔어요", // 새 문구
      mismatch: "앞 4자리가 달라요. 보관한 비상 열쇠를 다시 확인해 주세요",
    },
  },
  // M5d 비상 열쇠로 열기 (D10). 새 문구는 모두 "새 문구"
  recoveryOpen: {
    link: "비상 열쇠로 열기", // 새 문구
    title: "비상 열쇠로 열기", // 새 문구
    why: "쓰던 기기를 모두 잃었을 때 쓰는 방법이에요. 비상 열쇠가 맞으면 이 기기에 기기 잠금을 새로 만들어요", // 새 문구
    label: "비상 열쇠", // 새 문구
    hint: "52글자예요. 띄어쓰기나 줄(-)은 있어도 없어도 돼요", // 새 문구
    open: "열기", // 새 문구
    checking: "비상 열쇠를 확인하고 있어요…", // 새 문구
    ready: "비상 열쇠가 맞아요. 이 기기에 기기 잠금을 만들어요", // 새 문구
    ahead: "버튼을 누르면 Touch ID나 컴퓨터 암호를 한 번 물어요. 저장할지 물으면 [계속]을 눌러 주세요", // 새 문구
    action: "기기 잠금 만들기", // 새 문구
    back: "돌아가기", // 새 문구
    done: "기기 잠금을 만들었어요. [이 기기로 열기]를 눌러 열어 보세요. 쓰던 기기도 그대로 열려요. 열고 나면 설정에서 새 비상 열쇠를 만들어 두세요", // 새 문구
    errors: {
      format: "비상 열쇠는 52글자예요. 빠진 글자가 없는지 확인해 주세요", // 새 문구
      not_found: "이 비상 열쇠로 찾은 계정이 없어요. 한 글자씩 다시 확인해 주세요", // 새 문구
      wrong_key: "비상 열쇠가 맞지 않아요. 한 글자씩 다시 확인해 주세요", // 새 문구
      expired: "5분이 지났어요. 다시 해 주세요", // 새 문구
      offline: "인터넷이 끊겼어요. 연결되면 다시 해 주세요",
      failed: "잠시 문제가 생겼어요. 다시 해 볼까요?",
    },
  },
  // M5d 챙길 것 카드(UX ⑥-3)와 기억 메모(D7·D8). 새 문구는 모두 "새 문구"
  check: {
    title: "오래 안 쓰면 잊기 쉬운 것들이에요. 지금 한 번만 확인해 두세요", // UX ⑥-3
    recovery: { label: "비상 열쇠", none: "없음", made: (d: string) => `${d}에 만들었어요`, make: "지금 만들기" }, // 새 문구
    devices: {
      label: (n: number) => `열 수 있는 기기 ${n}대`, // 새 문구
      one: "기기가 하나뿐이에요. 하나를 잃어도 열 수 있게 휴대폰 같은 기기를 하나 더 등록해 두세요", // 새 문구
    },
    github: { label: "GitHub", on: "연결됨", off: "아직 연결 안 됐어요", connect: "지금 연결하기", waiting: "GitHub 창에서 코드를 입력해 주세요" }, // 새 문구
    shortcut: { label: "휴대폰 바로가기", off: "아직 홈 화면에 없어요", how: "방법 보기", steps: "브라우저 메뉴(⋮)에서 \"홈 화면에 추가\"를 누르면 앱처럼 열 수 있어요" }, // 새 문구
    ok: "괜찮아요", // UX ⑥-3: 닫기만 해요(이미 90일 뒤로 저장됨)
  },
  note: {
    title: "기억 메모", // 새 문구
    open: "메모 남기기", // 새 문구
    lock: "🔒 잠금을 푼 뒤에만 보여요. Ideatrail 서버에는 잠긴 글자만 있어요", // 새 문구
    label: "어디에 뒀는지 적어 두세요", // 새 문구
    hint: "예: 비상 열쇠는 책상 서랍 두 번째 칸. 열쇠 자체는 적지 마세요", // 새 문구
    count: (n: number) => `${n}/500자`, // 새 문구
    save: "메모 저장", // 새 문구
    saved: "저장했어요", // 새 문구
    unreadable: "메모를 열 수 없어요", // 새 문구
    failed: "저장하지 못했어요. 잠시 뒤에 다시 해 주세요", // 새 문구
  },
  // M5b 홈 (ADR-0018 시제품 모양). 새 문구는 모두 "새 문구" — 미리보기 docs/manual/홈-화면-미리보기.html과 같은 말
  home: {
    toggle: SERVER_TOGGLE,
    serverNote: SERVER_NOTE,
    deviceNote: DEVICE_NOTE,
    tabsLabel: "보기", // 새 문구
    tabs: { all: "전체", shared: "공유 가능", mine: "나만 보기" },
    searchLabel: "태그나 단계로 찾기", // 새 문구
    searchHint: "#기획 MVP 완료",
    sortLabel: "정렬",
    sorts: {
      firstOld: "처음 기록한 순 (오래된 것부터)",
      firstNew: "처음 기록한 순 (최신부터)",
      last: "마지막 기록 순",
      stage: "진행 단계 순",
      opened: "최근 열어 본 순 (이 기기에만 저장)",
    },
    count: (n: number) => `${n}개`,
    listLabel: "아이디어 목록", // 새 문구
    stageOf: (no: number, name: string) => `${no}/5 ${name}`,
    dates: (first: string, last: string) => `최초 기록 ${first} / 마지막 기록 ${last}`,
    mine: "나만 보기", // 자물쇠 그림의 읽기 이름
    chain: {
      ...CHAIN,
      checking: "블록체인 확인 중", // 새 문구 (서버는 '확정'이라 했지만 이 브라우저가 아직 두 곳에서 확인하지 못함)
      mismatch: "블록체인 확인이 서로 달라요", // 새 문구 (두 탐색기 값이 다름)
      invalid: "블록체인 증명을 확인할 수 없어요", // 새 문구 (영수증이 블록과 안 맞음)
    },
    empty: {
      none: "아직 기록이 없어요. Claude Code에서 “기록해 줘”라고 하면 여기에 쌓여요", // 새 문구 (UX 빈 상태, 가입을 마친 사람용)
      shared: "공유 가능으로 둔 기록이 없어요. 기록은 기본으로 나만 봐요.", // 새 문구
      mine: "나만 보는 기록이 없어요.", // 새 문구
      search: "찾는 기록이 없어요. 다른 태그나 단계로 찾아보세요.",
    },
    loading: "기기 안에서 푸는 중…",
    pick: "아이디어를 고르면 여기에 걸어온 길이 보여요", // 새 문구
  },
  // M5b 아이디어의 일생 (UX ②). 개수는 점수가 아님 — "AI가 센 수"로만 (ADR-0019, CLAUDE.md 규칙 8)
  life: {
    back: "목록으로", // 새 문구
    visibility: { private: "나만 보기", public: "공유 가능" },
    versions: (n: number) => `버전 ${n}개`,
    first: "최초 기록",
    last: "마지막 기록",
    nameHint: "이 제목은 이 기기에서 풀었어요",
    how: "어떻게?",
    howBody: "이름·단계·태그·파일 이름은 이 기기의 열쇠로 잠겨 있어서, Ideatrail 서버에는 잠긴 글자만 있어요. 이 기기에서 잠금을 풀 때만 읽을 수 있는 글자로 바뀌어요", // 새 문구
    stagesLabel: (no: number) => `단계 ${no}/5`,
    rename: { // ADR-0020: AI가 한 번 붙인 단계 이름을 사용자가 언제든 고친다
      open: "이름 고치기", // 새 문구
      title: "단계 이름 고치기", // 새 문구
      note: "AI가 붙인 이름이에요. 언제든 바꿀 수 있어요", // 새 문구
      field: (n: number) => `${n}번째 단계 이름`,
      rule: "한 칸에 1~12자, 따옴표나 줄바꿈 없이 써 주세요", // 새 문구
      save: "저장",
      reset: "기본 이름으로",
      cancel: "취소",
      failed: "저장하지 못했어요. 잠시 뒤에 다시 해 주세요", // 새 문구
    },
    decided: "결정",
    deferred: "미룸",
    turn: "변곡점",
    counted: "AI가 센 수", // 새 문구 (ADR-0019: AI 판단이라 틀릴 수 있음)
    estimated: "AI 추정",
    paused: "멈춤",
    stalled: (days: number) => `${days}일째`,
    notYet: "아직 이 단계에 오지 않았어요",
    skipped: "이 단계는 기록 없이 지나갔어요", // 새 문구
    file: "원래 위치",
    source: { // 새 문구 (5.13·5.6: 버전 한 줄을 펼치면 GitHub에서 원문을 가져와요)
      open: "원문 보기",
      close: "접기",
      checking: "GitHub에서 찾는 중이에요",
      unlinked: "원문은 GitHub 증명 보관함을 만든 뒤에 볼 수 있어요",
      connect: "GitHub에 보관함 만들기",
      notYet: "아직 GitHub에 올라가는 중이에요. 잠시 뒤에 다시 열어 보세요",
      same: "그날 그대로예요", // 5.6: 풀어 본 원문의 지문이 그날 서명된 지문과 같다
      changed: "그날 그대로가 아니에요. 이 원문은 기록할 때와 달라요",
      noOriginal: "큰 파일이나 그림은 원문 없이 지문만 남아요",
      mismatch: "GitHub에 있는 증명이 이 기록과 달라요",
      unreadable: "원문을 열지 못했어요",
      diffTitle: "바로 앞 버전과 달라진 줄",
      noDiff: "너무 길어서 줄 비교는 건너뛰었어요",
      cut: (n: number) => `…나머지 ${n}줄은 접어 뒀어요`,
      files: (n: number) => `파일 ${n}개`,
      add: "더함", del: "뺌",
      failed: "GitHub에서 가져오지 못했어요. 연결을 확인하고 다시 해 보세요",
    },
    journey: { // 새 문구 (5.8: 기록이 지나온 길)
      title: "이 기록이 지나온 길",
      steps: { recorded: "기록됨", fingerprint: "지문 만듦", signed: "서버가 받아 확인함", github: "GitHub 보관", chain: `블록체인 ${CHAIN_WORD}` },
      state: { done: "끝남", doing: "진행 중", todo: "아직", warn: "확인 필요" },
      notes: {
        checking: "확인 중", unlinked: "연결 안 됨", uploading: "올라가는 중", failed: "열지 못했어요", different: "GitHub에 있는 것이 달라요",
        changed: "원문이 달라졌어요", fingerprintOnly: "지문만 보관", waiting: "기다리는 중", mismatch: "두 곳 값이 달라요", invalid: "증명이 맞지 않아요",
      },
      export: "증명 파일 내려받기",
      exportNote: "이 파일에는 원문을 확인하는 열쇠가 들어 있어요. 원문 파일과 함께 안전한 곳에 두세요. 파일은 이 기기에서 바로 만들어지고 Ideatrail 서버를 거치지 않아요",
    },
    fingerprint: "지문 앞뒤 3자리",
    recordN: (n: number) => `기록 ${n}`, // 새 문구: 버전 이름이 없는 옛 기록
    routine: {
      title: (total: number, filled: number) => `루틴 점검 ${total}개 중 ${filled}개`,
      groups: { idea: "착상", plan: "기획", run: "실행", feedback: "피드백" },
      slots: {
        problem: "풀려는 문제 한 줄",
        audience: "누구를 위한 건지",
        not_doing: "하지 않을 것 정하기",
        decision_reason: "확정 이유 남김",
        first_run: "첫 동작 화면",
        feedback: "다른 사람 반응 1건",
        changed_by_feedback: "반응 보고 바꾼 것",
      },
      filled: "채움",
      empty: "아직 없음",
      next: "다음에 채울 칸", // 새 문구 (H14: 다음 칸 하나만 또렷하게)
      note: "근거는 모두 사용자의 AI가 기록할 때 표시했어요", // UX "내 AI" → 주어 규칙
      hide: "점검 숨기기",
      show: "루틴 점검 보기",
      hiddenNote: "꺼도 점검은 조용히 쌓여요. 다시 켜면 그대로 보여요.",
      feedbackOff: "이 아이디어엔 해당 없음",
      feedbackOn: "피드백 칸 다시 펼치기", // 새 문구
    },
  },
} as const;

/** The "방금 한 일" line for the screen after a finished step; nothing after a skip. */
export const didLine = (s: SignupState): string | null => (s.justDid ? COPY.did[s.justDid] : null);

/** A fixed sentence for any failure. Server messages and exception text never reach the screen. */
export function errorMessage(e: unknown): string {
  return baseError(e);
}

/** Like errorMessage, plus the sentences the dashboard's management screens have for their own server codes. */
export function manageError(e: unknown): string {
  if (e instanceof ApiFailure) {
    const known: Record<string, string> = {
      last_device: COPY.manage.errors.last_device,
      engine_list_conflict: COPY.manage.errors.engine_list_conflict,
      approval_closed: COPY.manage.errors.approval_closed,
      engine_not_found: COPY.manage.errors.not_found,
      not_found: COPY.manage.errors.not_found,
      credential_not_found: COPY.manage.errors.not_found,
    };
    if (e.code in known) return known[e.code];
  }
  return baseError(e);
}

function baseError(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (e.code === "offline") return COPY.errors.offline;
    if (e.code === "device_add_expired") return COPY.connect.expired;
    if (e.code === "stepup_required" || e.code === "webauthn_failed") return COPY.errors.passkey_cancel;
    return COPY.errors.generic;
  }
  if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError")) return COPY.errors.passkey_cancel;
  return COPY.errors.generic;
}
