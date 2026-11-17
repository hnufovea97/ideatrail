#!/bin/sh
# Fails if a release binary still contains development-only override names or commands.
set -eu
status=0
for f in "$@"; do
	for s in IDEATRAIL_API_BASE IDEATRAIL_APP_BASE IDEATRAIL_HOME dev-record dev-seed AllowLoopbackForTesting; do
		if LC_ALL=C grep -a -q -- "$s" "$f"; then
			echo "release binary $f contains $s" >&2
			status=1
		fi
	done
done
[ "$status" -eq 0 ] && echo "release strings clean: $*"
exit "$status"
