$ErrorActionPreference = 'Stop'
Push-Location engine
go test ./...
if ($LASTEXITCODE) { exit 1 }
Pop-Location
Push-Location web
pnpm vitest run
exit $LASTEXITCODE
