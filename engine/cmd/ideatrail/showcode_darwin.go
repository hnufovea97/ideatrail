package main

import (
	"context"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

var deviceCodeRe = regexp.MustCompile(`^[A-Z0-9]{4}-[A-Z0-9]{4}$`)

// showCode copies the GitHub device code to the clipboard and shows it in a dialog. The code is
// passed as an argument (never spliced into a script) and never reaches the AI.
func showCode(code string) error {
	if !deviceCodeRe.MatchString(code) {
		return errBadCode
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cp := exec.CommandContext(ctx, "/usr/bin/pbcopy")
	cp.Stdin = strings.NewReader(code)
	_ = cp.Run()
	dlg := exec.Command("/usr/bin/osascript",
		"-e", "on run argv",
		"-e", `display dialog ("GitHub 연결 코드: " & item 1 of argv & return & return & "복사해 두었어요. 열린 GitHub 화면에 붙여 넣어 주세요.") buttons {"확인"} default button 1 with title "ideatrail" giving up after 600`,
		"-e", "end run", code)
	if err := dlg.Start(); err != nil {
		return err
	}
	go func() { _ = dlg.Wait() }() // reap it without blocking the engine while the dialog is open
	return nil
}
