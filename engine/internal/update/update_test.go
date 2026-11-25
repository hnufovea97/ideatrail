package update

import (
	"errors"
	"os"
	"strings"
	"testing"
	"unicode/utf8"

	"ideatrail/engine/internal/state"
)

func dir(t *testing.T) string {
	t.Helper()
	d := t.TempDir()
	_ = os.Chmod(d, 0o700)
	return d
}

func signedUp(t *testing.T, d string) {
	t.Helper()
	if err := state.With(d, func(s *state.State) error { s.UserID = "u1"; return nil }); err != nil {
		t.Fatal(err)
	}
}

func TestPinSetsKeyOnceAndRefusesAChange(t *testing.T) {
	d := dir(t)
	if err := Pin(d, "keyA"); err != nil {
		t.Fatal(err)
	}
	if err := Pin(d, "keyA"); err != nil {
		t.Fatalf("same key: %v", err)
	}
	if err := Pin(d, "keyB"); !errors.Is(err, ErrKeyChanged) {
		t.Fatalf("different key: %v", err)
	}
	if k, _ := Pinned(d); k != "keyA" {
		t.Fatalf("pinned %q", k)
	}
}

func TestPinWithEmptyKeyIsNoop(t *testing.T) {
	d := dir(t)
	if err := Pin(d, ""); err != nil {
		t.Fatal(err)
	}
	if k, _ := Pinned(d); k != "" {
		t.Fatal("dev build pinned a key")
	}
}

func TestCheckFirstRunApprovesVersion(t *testing.T) {
	d := dir(t)
	signedUp(t, d)
	st, err := Check(d, "0.1.0")
	if err != nil || st.Pending {
		t.Fatalf("%+v %v", st, err)
	}
	s, _ := state.Read(d)
	if s.ApprovedVersion != "0.1.0" || s.UpdatePending != nil {
		t.Fatalf("%+v", s)
	}
}

func TestCheckVersionChangeWhileSignedUpIsPending(t *testing.T) {
	d := dir(t)
	signedUp(t, d)
	_, _ = Check(d, "0.1.0")
	st, err := Check(d, "0.2.0")
	if err != nil || !st.Pending || st.Version != "0.2.0" {
		t.Fatalf("%+v %v", st, err)
	}
	s, _ := state.Read(d)
	if s.ApprovedVersion != "0.1.0" || s.UpdatePending == nil || s.UpdatePending.Version != "0.2.0" {
		t.Fatalf("%+v", s)
	}
	// a second start keeps the pending record (including an approval id already made)
	_ = state.With(d, func(s *state.State) error { s.UpdatePending.ApprovalID = "appr"; return nil })
	_, _ = Check(d, "0.2.0")
	s, _ = state.Read(d)
	if s.UpdatePending.ApprovalID != "appr" {
		t.Fatal("pending record replaced for the same version")
	}
	// rolling back to the approved version clears it
	st, _ = Check(d, "0.1.0")
	s, _ = state.Read(d)
	if st.Pending || s.UpdatePending != nil {
		t.Fatalf("%+v %+v", st, s)
	}
}

func TestCheckNotSignedUpAcceptsNewVersion(t *testing.T) {
	d := dir(t)
	_, _ = Check(d, "0.1.0")
	st, _ := Check(d, "0.2.0")
	s, _ := state.Read(d)
	if st.Pending || s.ApprovedVersion != "0.2.0" || s.UpdatePending != nil {
		t.Fatalf("%+v %+v", st, s)
	}
}

func TestChangesOrderingAndRange(t *testing.T) {
	got := changesFrom("0.1.0\t하나\n0.3.0\t셋\n0.2.0\t둘\n0.10.0\t열\nbad line\n", "0.1.0", "0.10.0")
	if strings.Join(got, "|") != "둘|셋|열" {
		t.Fatalf("%v", got)
	}
	if got := changesFrom("0.1.0\t하나\n0.2.0\t둘\n", "0.0.0", "0.1.0"); len(got) != 1 || got[0] != "하나" {
		t.Fatalf("%v", got)
	}
}

func TestChangesDowngrade(t *testing.T) {
	got := Changes("0.2.0", "0.1.0")
	if len(got) != 1 || got[0] != "이전 버전으로 바뀌었어요." {
		t.Fatalf("%v", got)
	}
}

func TestChangesCaps(t *testing.T) {
	var b strings.Builder
	for i := 1; i <= 30; i++ {
		b.WriteString("1." + string(rune('0'+i/10)) + string(rune('0'+i%10)) + ".0\t줄\n")
	}
	if got := changesFrom(b.String(), "0.0.0", "9.0.0"); len(got) != 20 {
		t.Fatalf("lines %d", len(got))
	}
	long := strings.Repeat("가", 300)
	got := changesFrom("0.2.0\t"+long+"\n0.2.0\t제어\x07문자\n0.2.0\t정상\n", "0.1.0", "0.2.0")
	if len(got) != 2 || utf8.RuneCountInString(got[0]) != 200 || got[1] != "정상" {
		t.Fatalf("%v", got)
	}
}

func TestEmbeddedChangesStartAtFirstBeta(t *testing.T) {
	got := Changes("0.0.0", "0.1.0")
	if len(got) != 1 || got[0] != "첫 베타예요." {
		t.Fatalf("%v", got)
	}
}
