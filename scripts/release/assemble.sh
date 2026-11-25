#!/bin/sh
# 배포 저장소 조립 (ADR-0021): 서명된 엔진 + plugin/ → 커밋 하나짜리 새 git 저장소.
# 버전마다 이력을 새로 만들어 실행 파일이 쌓이지 않게 한다. push는 하지 않는다(founder 승인 뒤 직접).
#
#   RELEASE_PUB=<공개키 b64u> scripts/release/assemble.sh <버전> <서명된 ideatrail-darwin> <새 폴더>
#
# <서명된 ideatrail-darwin> 옆에 같은 이름 + .sig가 있어야 한다(release-sign sign 결과).
set -eu
[ $# -eq 3 ] || { echo "사용법: RELEASE_PUB=… $0 <버전> <ideatrail-darwin> <새 폴더>" >&2; exit 2; }
version=$1 engine=$2 out=$3
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)

echo "$version" | grep -Eq '^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$' || { echo "버전 형식이 틀려요" >&2; exit 1; }
[ -n "${RELEASE_PUB:-}" ] || { echo "RELEASE_PUB(공개키)가 없어요" >&2; exit 1; }
[ -f "$engine" ] && [ -f "$engine.sig" ] || { echo "엔진 파일이나 .sig가 없어요" >&2; exit 1; }
[ ! -e "$out" ] || { echo "새 폴더 자리에 이미 무언가 있어요" >&2; exit 1; }
grep -q "\"version\": \"$version\"" "$root/plugin/.claude-plugin/plugin.json" || { echo "plugin.json 버전이 $version이 아니에요" >&2; exit 1; }
for f in .claude-plugin/plugin.json .mcp.json hooks/hooks.json skills/record/SKILL.md launch/ideatrail README.md; do
	[ -f "$root/plugin/$f" ] || { echo "plugin/$f가 없어요" >&2; exit 1; }
done

engine_abs=$(CDPATH= cd -- "$(dirname -- "$engine")" && pwd -P)/$(basename -- "$engine")
# 서명이 공개키와 맞는지 먼저 (틀리면 아무것도 만들지 않음)
(cd "$root/engine" && go run ./cmd/release-sign verify -pub "$RELEASE_PUB" -version "$version" "$engine_abs=darwin/universal")
# 이 엔진에 박힌 공개키도 같은지 — 다른 키로 빌드한 파일을 묶지 않게
LC_ALL=C grep -a -q -- "$RELEASE_PUB" "$engine_abs" || { echo "엔진에 박힌 공개키가 RELEASE_PUB과 달라요" >&2; exit 1; }

mkdir -p "$out/.claude-plugin" "$out/ideatrail/engine/darwin"
p=$out/ideatrail
for f in .claude-plugin .mcp.json hooks skills launch README.md; do
	cp -R "$root/plugin/$f" "$p/"
done
cp "$engine_abs" "$p/engine/darwin/ideatrail"
cp "$engine_abs.sig" "$p/engine/darwin/ideatrail.sig"
chmod 755 "$p/engine/darwin/ideatrail" "$p/launch/ideatrail"
printf '%s\n' "$RELEASE_PUB" > "$p/RELEASE.pub"
cp "$root/LICENSE" "$out/LICENSE"
cp "$root/plugin/README.md" "$out/README.md"
cat > "$out/.claude-plugin/marketplace.json" <<JSON
{
  "name": "ideatrail",
  "owner": { "name": "ideatrail" },
  "description": "ideatrail 플러그인 배포 저장소예요.",
  "plugins": [
    { "name": "ideatrail", "source": "./ideatrail", "description": "AI와 작업한 기획·문서의 변화를 기록하고 날짜를 증명해 둬요." }
  ]
}
JSON
(cd "$out/ideatrail" && shasum -a 256 engine/darwin/ideatrail > SHA256SUMS)

git -C "$out" init -q -b main
git -C "$out" add -A
git -C "$out" -c user.name="${RELEASE_GIT_NAME:-ideatrail}" -c user.email="${RELEASE_GIT_EMAIL:-release@ideatrail.dev}" \
	commit -q -m "release v$version"
echo "배포 저장소를 만들었어요: $out (커밋 1개, push 안 함)"
echo "founder 승인 뒤: git -C \"$out\" push --force <배포 저장소 주소> main"
