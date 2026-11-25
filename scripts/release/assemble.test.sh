#!/bin/sh
# 시험: 가짜 열쇠로 배포 저장소를 조립하고, 서명 틀린 엔진은 아무것도 만들지 않는지 본다.
# 실제 릴리스 열쇠·홈 폴더는 쓰지 않는다. 실행: scripts/release/assemble.test.sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
t=$(mktemp -d); [ -n "${KEEP:-}" ] && echo "$t"
trap '[ -n "${KEEP:-}" ] || rm -rf "$t"' EXIT
v=$(sed -n 's/.*"version": "\([0-9.]*\)".*/\1/p' "$root/plugin/.claude-plugin/plugin.json")
sign() { (cd "$root/engine" && go run ./cmd/release-sign "$@"); }

pub=$(sign keygen -out "$t/k1")
other=$(sign keygen -out "$t/k2")
(cd "$root/engine" && CGO_ENABLED=0 go build -trimpath \
	-ldflags "-X ideatrail/engine/internal/config.Version=$v -X ideatrail/engine/internal/config.ReleasePub=$pub" \
	-o "$t/ideatrail-darwin" ./cmd/ideatrail)
sign sign -key "$t/k1" -version "$v" "$t/ideatrail-darwin=darwin/universal" >/dev/null

fail() { echo "FAIL: $*" >&2; exit 1; }

# 1. 정상 조립
RELEASE_PUB=$pub "$root/scripts/release/assemble.sh" "$v" "$t/ideatrail-darwin" "$t/out" >/dev/null
[ "$(git -C "$t/out" rev-list --count HEAD)" = 1 ] || fail "커밋이 하나가 아님"
for f in .claude-plugin/marketplace.json LICENSE README.md ideatrail/.claude-plugin/plugin.json ideatrail/.mcp.json \
	ideatrail/hooks/hooks.json ideatrail/skills/record/SKILL.md ideatrail/launch/ideatrail \
	ideatrail/engine/darwin/ideatrail ideatrail/engine/darwin/ideatrail.sig ideatrail/RELEASE.pub; do
	git -C "$t/out" ls-files --error-unmatch "$f" >/dev/null 2>&1 || fail "$f 없음"
done
[ -x "$t/out/ideatrail/launch/ideatrail" ] && [ -x "$t/out/ideatrail/engine/darwin/ideatrail" ] || fail "실행 권한 없음"
[ "$(git -C "$t/out" ls-files -s ideatrail/launch/ideatrail | cut -c1-6)" = 100755 ] || fail "git에 실행 권한이 안 남음"
[ "$(cat "$t/out/ideatrail/RELEASE.pub")" = "$pub" ] || fail "RELEASE.pub 다름"
git -C "$t/out" ls-files | grep -q windows && fail "Windows 파일이 들어감(베타는 Mac만)"
git -C "$t/out" ls-files | grep -q tools.json && fail "tools.json은 배포에 필요 없음"
# 조립된 엔진이 스스로 서명을 확인하고 돌아가는지 (Mac에서만 실행 가능)
if [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = "$(go env GOARCH | sed 's/amd64/x86_64/')" ]; then
	"$t/out/ideatrail/engine/darwin/ideatrail" version >/dev/null || fail "version 실패"
	# Claude Code가 하듯 launch/ideatrail로 MCP를 띄워 도구 목록을 받는다 (빈 홈 폴더 = 새 Mac)
	mkdir -p "$t/home"
	resp=$( {
		printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}'
		printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
		printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
		sleep 2
	} | HOME="$t/home" CLAUDE_PLUGIN_ROOT="$t/out/ideatrail" "$t/out/ideatrail/launch/ideatrail" mcp 2>"$t/mcp.err" || true)
	for name in record status request_import set_record_words; do
		echo "$resp" | grep -q "\"name\":\"$name\"" || { cat "$t/mcp.err" >&2; fail "MCP 도구 $name 없음"; }
	done
	grep -q "release_key" "$t/home/Library/Application Support/ideatrail/state.json" || fail "첫 실행이 릴리스 키를 고정하지 않음"
fi

# 2. 다른 열쇠로 서명한 엔진 → 거절, 폴더 안 생김
cp "$t/ideatrail-darwin" "$t/bad"
sign sign -key "$t/k2" -version "$v" "$t/bad=darwin/universal" >/dev/null
if RELEASE_PUB=$pub "$root/scripts/release/assemble.sh" "$v" "$t/bad" "$t/out2" >/dev/null 2>&1; then fail "틀린 서명을 받아들임"; fi
[ ! -e "$t/out2" ] || fail "틀린 서명인데 폴더를 만듦"

# 3. 서명은 맞지만 박힌 공개키가 다른 엔진 → 거절
if RELEASE_PUB=$other "$root/scripts/release/assemble.sh" "$v" "$t/bad" "$t/out3" >/dev/null 2>&1; then fail "박힌 키가 다른 엔진을 받아들임"; fi
[ ! -e "$t/out3" ] || fail "박힌 키가 다른데 폴더를 만듦"

# 4. 버전이 plugin.json과 다르면 거절
if RELEASE_PUB=$pub "$root/scripts/release/assemble.sh" 9.9.9 "$t/ideatrail-darwin" "$t/out4" >/dev/null 2>&1; then fail "버전 다른데 받아들임"; fi

# 5. Claude Code 검사(있을 때만 — CI에는 없음)
if command -v claude >/dev/null 2>&1; then
	claude plugin validate --strict "$t/out" >/dev/null || fail "marketplace 검사 실패"
	claude plugin validate --strict "$t/out/ideatrail" >/dev/null || fail "플러그인 검사 실패"
fi
echo "assemble 시험 통과"
