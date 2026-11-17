package state

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestWithConcurrentGoroutines(t *testing.T) {
	dir := t.TempDir()
	var wg sync.WaitGroup
	for g := 0; g < 2; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 100; i++ {
				if err := With(dir, func(s *State) error { _, err := s.ReqSeq.Next(); return err }); err != nil {
					t.Error(err)
				}
			}
		}()
	}
	wg.Wait()
	s, _ := Read(dir)
	if s.ReqSeq != 200 {
		t.Fatalf("got %d", s.ReqSeq)
	}
}

// TestHelperProcess is run as a child process by TestWithConcurrentProcesses.
func TestHelperProcess(t *testing.T) {
	dir := os.Getenv("STATE_HELPER_DIR")
	if dir == "" {
		t.Skip("helper only")
	}
	for i := 0; i < 100; i++ {
		if err := With(dir, func(s *State) error { _, err := s.ReqSeq.Next(); return err }); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
}

func TestWithConcurrentProcesses(t *testing.T) {
	dir := t.TempDir()
	var cmds []*exec.Cmd
	for i := 0; i < 2; i++ {
		c := exec.Command(os.Args[0], "-test.run=^TestHelperProcess$")
		c.Env = append(os.Environ(), "STATE_HELPER_DIR="+dir)
		if err := c.Start(); err != nil {
			t.Fatal(err)
		}
		cmds = append(cmds, c)
	}
	for _, c := range cmds {
		if err := c.Wait(); err != nil {
			t.Fatal(err)
		}
	}
	s, _ := Read(dir)
	if s.ReqSeq != 200 {
		t.Fatalf("got %d", s.ReqSeq)
	}
}

func TestErrorLeavesFileUnchanged(t *testing.T) {
	dir := t.TempDir()
	_ = With(dir, func(s *State) error { s.UserID = "before"; return nil })
	boom := errors.New("boom")
	if err := With(dir, func(s *State) error { s.UserID = "after"; return boom }); !errors.Is(err, boom) {
		t.Fatal(err)
	}
	s, _ := Read(dir)
	if s.UserID != "before" {
		t.Fatalf("got %q", s.UserID)
	}
}

func TestLeftoverTmpIsHarmless(t *testing.T) {
	dir := t.TempDir()
	_ = With(dir, func(s *State) error { s.UserID = "ok"; return nil })
	_ = os.WriteFile(filepath.Join(dir, fileName+".tmp"), []byte("{garbage"), 0o600)
	s, err := Read(dir)
	if err != nil || s.UserID != "ok" {
		t.Fatalf("%v %v", s, err)
	}
}

func TestSeqIsStringAndExactAbove2to53(t *testing.T) {
	dir := t.TempDir()
	big := uint64(1)<<60 + 7
	_ = With(dir, func(s *State) error { s.LogSeq = Seq(big); return nil })
	raw, _ := os.ReadFile(filepath.Join(dir, fileName))
	if want := `"log_seq": "` + strconv.FormatUint(big, 10) + `"`; !strings.Contains(string(raw), want) {
		t.Fatalf("raw: %s", raw)
	}
	s, _ := Read(dir)
	if uint64(s.LogSeq) != big {
		t.Fatalf("got %d", s.LogSeq)
	}
}

func TestSeqExhausted(t *testing.T) {
	s := Seq(MaxSeq)
	if _, err := s.Next(); !errors.Is(err, ErrSeqExhausted) {
		t.Fatal(err)
	}
}

func TestFilePermissions(t *testing.T) {
	dir := t.TempDir()
	_ = With(dir, func(s *State) error { return nil })
	for _, n := range []string{fileName, lockName} {
		fi, err := os.Stat(filepath.Join(dir, n))
		if err != nil || fi.Mode().Perm() != 0o600 {
			t.Fatalf("%s: %v %v", n, fi.Mode(), err)
		}
	}
}

func TestRememberMsgID(t *testing.T) {
	var s State
	if !s.RememberMsgID("a") || s.RememberMsgID("a") {
		t.Fatal("replay not detected")
	}
	for i := 0; i < MaxSeenMsgIDs+5; i++ {
		s.RememberMsgID(strconv.Itoa(i))
	}
	if len(s.SeenMsgIDs) != MaxSeenMsgIDs {
		t.Fatalf("len %d", len(s.SeenMsgIDs))
	}
}

func TestLockTimeout(t *testing.T) {
	dir := t.TempDir()
	old := LockTimeout
	LockTimeout = 50 * time.Millisecond
	defer func() { LockTimeout = old }()
	held := make(chan struct{})
	release := make(chan struct{})
	go func() { _ = With(dir, func(*State) error { close(held); <-release; return nil }) }()
	<-held
	err := With(dir, func(*State) error { return nil })
	close(release)
	if !errors.Is(err, ErrLockTimeout) {
		t.Fatalf("got %v", err)
	}
}
