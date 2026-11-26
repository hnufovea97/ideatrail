#!/bin/sh
# Builds the signup web for the staging API and deploys the staging Worker (API + web assets).
# G1 2026-11-19: a Playwright run rebuilt web/dist for localhost and that build was deployed;
# the signup page then called http://localhost:8787 and showed "인터넷이 끊겼어요". Always build here.
set -eu
STAGING="https://ideatrail-api-staging.ideatrail.workers.dev"
cd "$(dirname "$0")/.."
(cd web && PUBLIC_API_BASE="$STAGING" pnpm build)
if grep -rq 'localhost' web/dist/_astro; then
  echo "중단: web/dist가 localhost를 가리켜요. 시험 서버에 올리지 않았어요." >&2
  exit 1
fi
(cd api && npx wrangler deploy --env staging)
