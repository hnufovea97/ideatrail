.PHONY: test
test:
	cd engine && go test ./...
	cd web && pnpm vitest run
