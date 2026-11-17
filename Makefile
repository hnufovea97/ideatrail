.PHONY: test
test:
	cd engine && go test ./... && go test -tags devbuild ./internal/config ./internal/home
	pnpm -r test

.PHONY: vectors
vectors:
	cd engine && go test ./internal/crypto -run TestCommittedVectorsUpToDate -update
	cd packages/crypto && GEN_BROWSER_SEALS=1 pnpm vitest run browser-seals
