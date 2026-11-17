.PHONY: test
test:
	cd engine && go test ./... && go test -tags devbuild ./internal/config ./internal/home
	pnpm -r test

.PHONY: vectors
vectors:
	cd engine && go test ./internal/crypto -run TestCommittedVectorsUpToDate -update
	cd packages/crypto && GEN_BROWSER_SEALS=1 pnpm vitest run browser-seals

VERSION ?= 0.0.0-dev
CFG := ideatrail/engine/internal/config
LDFLAGS := -s -w -buildid= -X $(CFG).Version=$(VERSION) $(if $(RELEASE_PUB),-X $(CFG).ReleasePub=$(RELEASE_PUB))
GOBUILD := CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)"
MAC := plugin/engine/darwin/ideatrail
WIN := plugin/engine/windows/ideatrail.exe

.PHONY: build
build:
	mkdir -p dist plugin/engine/darwin plugin/engine/windows
	cd engine && GOOS=darwin GOARCH=arm64 $(GOBUILD) -o ../dist/ideatrail-darwin-arm64 ./cmd/ideatrail
	cd engine && GOOS=darwin GOARCH=amd64 $(GOBUILD) -o ../dist/ideatrail-darwin-amd64 ./cmd/ideatrail
	lipo -create -output $(MAC) dist/ideatrail-darwin-arm64 dist/ideatrail-darwin-amd64
	codesign -s - -f $(MAC)
	cd engine && GOOS=windows GOARCH=amd64 $(GOBUILD) -o ../$(WIN) ./cmd/ideatrail
	scripts/check-release-strings.sh $(MAC) $(WIN)
	lipo -info $(MAC)
	codesign -v $(MAC)

# Development engine (overrides allowed) for staging checks; never shipped.
.PHONY: dev-build
dev-build:
	mkdir -p dist/dev
	cd engine && CGO_ENABLED=0 go build -tags devbuild -trimpath -o ../dist/dev/ideatrail ./cmd/ideatrail
