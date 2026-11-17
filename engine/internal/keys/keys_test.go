package keys

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"
)

func init() { tmutilExclude = func(string) error { return nil } }

func TestCreateThenLoadSameKeys(t *testing.T) {
	dir := keyDir(t)
	a, err := LoadOrCreate(dir)
	if err != nil {
		t.Fatal(err)
	}
	b, err := LoadOrCreate(dir)
	if err != nil {
		t.Fatal(err)
	}
	if a.EngineID != b.EngineID || !a.SignPub().Equal(b.SignPub()) || !a.KEMPub.Equal(b.KEMPub) {
		t.Fatal("keys changed between loads")
	}
	if len(a.EngineID) != 26 {
		t.Fatalf("engine id %q", a.EngineID)
	}
	fi, _ := os.Stat(filepath.Join(dir, fileName))
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("perm %v", fi.Mode())
	}
}

func TestRejectsLoosePermissions(t *testing.T) {
	dir := keyDir(t)
	if _, err := LoadOrCreate(dir); err != nil {
		t.Fatal(err)
	}
	_ = os.Chmod(filepath.Join(dir, fileName), 0o644)
	if _, err := LoadOrCreate(dir); !errors.Is(err, ErrInsecurePerms) {
		t.Fatalf("got %v", err)
	}
}

func TestRacingFirstRunsAgree(t *testing.T) {
	dir := keyDir(t)
	ids := make([]string, 8)
	var wg sync.WaitGroup
	for i := range ids {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			k, err := LoadOrCreate(dir)
			if err != nil {
				t.Error(err)
				return
			}
			ids[i] = k.EngineID
		}(i)
	}
	wg.Wait()
	for _, id := range ids {
		if id != ids[0] {
			t.Fatalf("different engines: %v", ids)
		}
	}
	left, _ := filepath.Glob(filepath.Join(dir, "*.tmp-*"))
	if len(left) != 0 {
		t.Fatalf("temp files left: %v", left)
	}
}

func TestKeyFileHasOnlyExpectedFields(t *testing.T) {
	dir := keyDir(t)
	if _, err := LoadOrCreate(dir); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, fileName))
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	var keys []string
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if want := []string{"engine_id", "kem_priv", "sign_priv", "v"}; !equal(keys, want) {
		t.Fatalf("fields %v", keys)
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestRejectsSymlinkedKey(t *testing.T) {
	dir := keyDir(t)
	real := filepath.Join(t.TempDir(), "elsewhere.key")
	_ = os.WriteFile(real, []byte(`{}`), 0o600)
	if err := os.Symlink(real, filepath.Join(dir, fileName)); err != nil {
		t.Skip(err)
	}
	if _, err := LoadOrCreate(dir); !errors.Is(err, ErrInsecurePerms) {
		t.Fatalf("got %v", err)
	}
}

func TestCorruptKeyIsAnErrorNotRegenerated(t *testing.T) {
	dir := keyDir(t)
	_ = os.WriteFile(filepath.Join(dir, fileName), []byte("{not json"), 0o600)
	if _, err := LoadOrCreate(dir); err == nil {
		t.Fatal("corrupt key accepted")
	}
	raw, _ := os.ReadFile(filepath.Join(dir, fileName))
	if string(raw) != "{not json" {
		t.Fatal("corrupt key was overwritten")
	}
}

// keyDir mirrors production: home.Ensure creates the engine folder owner-only (0700).
func keyDir(t *testing.T) string {
	t.Helper()
	d := filepath.Join(t.TempDir(), "engine")
	if err := os.Mkdir(d, 0o700); err != nil {
		t.Fatal(err)
	}
	return d
}

func TestRejectsLooseEngineFolder(t *testing.T) {
	dir := keyDir(t)
	if _, err := LoadOrCreate(dir); err != nil {
		t.Fatal(err)
	}
	_ = os.Chmod(dir, 0o755)
	if _, err := LoadOrCreate(dir); !errors.Is(err, ErrInsecurePerms) {
		t.Fatalf("got %v", err)
	}
}
