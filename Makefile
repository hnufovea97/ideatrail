.PHONY: test
test:
	cd engine && go test ./...
	cd web && pnpm vitest run

.PHONY: vectors
vectors:
	cd engine && go test ./internal/crypto -run TestCommittedVectorsUpToDate -update
	cd web && GEN_BROWSER_SEALS=1 pnpm vitest run browser-seals
