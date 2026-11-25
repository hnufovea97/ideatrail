// Command ideatrail is the engine: the MCP server Claude Code talks to and the hook commands.
// Every message it prints is a fixed sentence — never a path, token, link or library error.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"

	"ideatrail/engine/internal/api"
	"ideatrail/engine/internal/config"
	gh "ideatrail/engine/internal/github"
	"ideatrail/engine/internal/home"
	"ideatrail/engine/internal/hooks"
	"ideatrail/engine/internal/inbox"
	"ideatrail/engine/internal/keys"
	"ideatrail/engine/internal/mcpserver"
	"ideatrail/engine/internal/ots"
	"ideatrail/engine/internal/pairing"
	"ideatrail/engine/internal/record"
	"ideatrail/engine/internal/repo"
	"ideatrail/engine/internal/selfcheck"
	"ideatrail/engine/internal/update"
)

const (
	msgUsage       = "사용법: ideatrail mcp | hook <guard|session-start|stop> | version"
	msgNotReady    = "ideatrail: 정식으로 배포된 기록 도우미가 아니라서 실행할 수 없어요. 플러그인을 다시 설치해 주세요."
	msgTampered    = "ideatrail: 기록 도우미 파일이 바뀐 것 같아 멈췄어요. 플러그인을 다시 설치해 주세요."
	msgKeyChanged  = "ideatrail: 새 버전의 서명 열쇠가 처음 설치한 것과 달라서 멈췄어요. 플러그인을 다시 설치해 주세요."
	msgSynced      = "ideatrail: 기록 도우미의 보관 폴더가 동기화 폴더(iCloud·Dropbox·Syncthing 등) 안에 있어서 멈췄어요."
	msgStartFailed = "ideatrail: 기록 도우미를 시작하지 못했어요. Claude Code를 다시 켜 주세요."
	githubAPI      = "https://api.github.com"
)

// extra holds subcommands that exist only in some builds (dev-record in devbuild).
var extra = map[string]func(args []string) int{}

func main() { os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr)) }

func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, msgUsage)
		return 2
	}
	switch args[0] {
	case "version":
		fmt.Fprintln(stdout, "ideatrail "+config.Version)
		return 0
	case "hook":
		return runHook(args[1:], stdin, stdout, stderr)
	}
	if code, ok := verifySelf(stderr); !ok {
		return code
	}
	switch args[0] {
	case "mcp":
		return runMCP(stderr)
	}
	if f, ok := extra[args[0]]; ok {
		return f(args[1:])
	}
	fmt.Fprintln(stderr, msgUsage)
	return 2
}

// verifySelf refuses to run a release binary without its key or with a broken signature.
func verifySelf(stderr io.Writer) (int, bool) {
	if !config.ReleaseReady() {
		fmt.Fprintln(stderr, msgNotReady)
		return 1, false
	}
	if config.Dev() {
		return 0, true
	}
	exe, err := os.Executable()
	if err != nil {
		fmt.Fprintln(stderr, msgTampered)
		return 1, false
	}
	stateDir := ""
	if paths, err := config.Locate(); err == nil {
		stateDir = paths.Engine
	}
	switch err := releaseCheck(config.ReleasePub, exe, runtime.GOOS, releaseArch(), config.Version, stateDir); {
	case errors.Is(err, update.ErrKeyChanged):
		fmt.Fprintln(stderr, msgKeyChanged)
		return 1, false
	case err != nil:
		fmt.Fprintln(stderr, msgTampered)
		return 1, false
	}
	return 0, true
}

// releaseCheck refuses a binary whose embedded key differs from the key pinned at first install,
// then verifies the file's signature. It reads the state folder only if it already exists.
func releaseCheck(embeddedKey, exe, goos, goarch, version, stateDir string) error {
	if embeddedKey != "" && stateDir != "" {
		if _, err := os.Stat(stateDir); err == nil {
			pinned, err := update.Pinned(stateDir)
			if err != nil {
				return selfcheck.ErrBadSignature
			}
			if pinned != "" && pinned != embeddedKey {
				return update.ErrKeyChanged
			}
		}
	}
	return selfcheck.Verify(embeddedKey, exe, goos, goarch, version)
}

// releaseArch names the signed artifact: the Mac file is one universal binary for both chips.
func releaseArch() string {
	if runtime.GOOS == "darwin" {
		return "universal"
	}
	return runtime.GOARCH
}

// runHook never touches the network and never fails the user's tool call except guard's exit 2.
func runHook(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	if len(args) != 1 {
		return 0
	}
	paths, err := config.Locate()
	if err != nil {
		return 0
	}
	switch args[0] {
	case "guard":
		if hooks.Guard(stdin, []string{paths.Engine, paths.Outbox, paths.Proofs}) == 2 {
			fmt.Fprintln(stderr, hooks.GuardMessage)
			return 2
		}
	case "session-start":
		if home.Ensure(paths.Engine) != nil {
			return 0
		}
		if line := hooks.SessionStart(stdin, paths.Engine); line != "" {
			fmt.Fprintln(stdout, line)
		}
	case "stop":
		if home.Ensure(paths.Engine) != nil {
			return 0
		}
		if out := hooks.Stop(stdin, paths.Engine); out != "" {
			fmt.Fprintln(stdout, out)
		}
	}
	return 0
}

// buildEngine wires every dependency from the build-time configuration.
func buildEngine() (*mcpserver.Engine, error) {
	paths, err := config.Locate()
	if err != nil {
		return nil, err
	}
	if err := home.Ensure(paths.Engine); err != nil {
		return nil, err
	}
	if err := update.Pin(paths.Engine, config.ReleasePub); err != nil {
		return nil, err
	}
	gate, err := update.Check(paths.Engine, config.Version)
	if err != nil {
		return nil, err
	}
	k, err := keys.LoadOrCreate(paths.Engine)
	if err != nil {
		return nil, err
	}
	client, err := api.New(config.API(), k, paths.Engine)
	if err != nil {
		return nil, err
	}
	flow := gh.DefaultDeviceFlow(config.GitHubClientID, pairing.OpenBrowser, showCode)
	return &mcpserver.Engine{
		Version:    config.Version,
		Keys:       k,
		API:        client,
		StateDir:   paths.Engine,
		ProjectDir: projectDir(),
		Record: record.Deps{API: client, Keys: k, StateDir: paths.Engine, ProofDir: paths.Proofs,
			OutboxDir: paths.Outbox, Calendars: ots.SubmitCalendars},
		Repo:       repo.Deps{API: client, Keys: k, StateDir: paths.Engine, OutboxDir: paths.Outbox, GitHubBase: githubAPI, Flow: flow},
		Inbox:      inbox.Deps{API: client, Keys: k, StateDir: paths.Engine},
		Pairing:    pairing.Deps{API: client, Keys: k, StateDir: paths.Engine, AppBase: config.App(), Open: pairing.OpenBrowser},
		Computer:   computerName(),
		UpdateGate: gate,
	}, nil
}

func runMCP(stderr io.Writer) int {
	e, err := buildEngine()
	if err != nil {
		switch {
		case errors.Is(err, home.ErrSyncedFolder):
			fmt.Fprintln(stderr, msgSynced)
		case errors.Is(err, update.ErrKeyChanged):
			fmt.Fprintln(stderr, msgKeyChanged)
		default:
			fmt.Fprintln(stderr, msgStartFailed)
		}
		return 1
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := e.Run(ctx); err != nil && ctx.Err() == nil {
		fmt.Fprintln(stderr, msgStartFailed)
		return 1
	}
	return 0
}

// projectDir is the Claude Code project the MCP server serves.
func projectDir() string {
	if d := os.Getenv("CLAUDE_PROJECT_DIR"); d != "" && filepath.IsAbs(d) {
		return d
	}
	d, _ := os.Getwd()
	return d
}

// computerName is shown on the signup page so the user recognizes the pairing request.
func computerName() string {
	h, err := os.Hostname()
	if err != nil {
		return ""
	}
	h = strings.TrimSuffix(h, ".local")
	if len(h) > 40 {
		h = h[:40]
	}
	return h
}
