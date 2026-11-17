$ErrorActionPreference = 'Stop'
Push-Location engine
go test ./...
if ($LASTEXITCODE) { exit 1 }
Pop-Location
pnpm -r test
exit $LASTEXITCODE
