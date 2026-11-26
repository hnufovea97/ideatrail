#!/bin/sh
# Builds the signup web for the production API and deploys the production Worker (API + web assets).
# Temporary workers.dev address (founder 2026-11-26). Moving to ideatrail.dev: change PROD here,
# env.production in api/wrangler.jsonc and the engine defaults in engine/internal/config together.
set -eu
PROD="https://ideatrail-api.ideatrail.workers.dev"
cd "$(dirname "$0")/.."
(cd web && PUBLIC_API_BASE="$PROD" pnpm build)
if grep -rqE 'localhost|staging' web/dist/_astro; then
  echo "중단: web/dist가 localhost나 시험 서버를 가리켜요. 운영 서버에 올리지 않았어요." >&2
  exit 1
fi
(cd api && npx wrangler d1 migrations apply ideatrail-production --env production --remote)
(cd api && npx wrangler deploy --env production)
