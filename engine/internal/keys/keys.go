// Package keys creates and loads engine.key (spec §13): engine_id, Ed25519 signing key (ES)
// and X25519 sealing key (EK). The engine never holds any key that can read user content.
package keys

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/cloudflare/circl/kem"

	ic "ideatrail/engine/internal/crypto"
	"ideatrail/engine/internal/home"
)

const fileName = "engine.key"

var ErrInsecurePerms = errors.New("engine.key is readable by others")

// Keys is the engine identity.
type Keys struct {
	EngineID string
	Sign     ed25519.PrivateKey
	KEMPriv  kem.PrivateKey
	KEMPub   kem.PublicKey
}

type fileV1 struct {
	V        int    `json:"v"`
	EngineID string `json:"engine_id"`
	SignPriv string `json:"sign_priv"` // b64u Ed25519 seed (32 bytes)
	KEMPriv  string `json:"kem_priv"`  // b64u X25519 private key
}

// SignPub returns the Ed25519 public key.
func (k *Keys) SignPub() ed25519.PublicKey { return k.Sign.Public().(ed25519.PublicKey) }

// LoadOrCreate reads dir/engine.key, creating it (exclusively, 0600) on first run.
func LoadOrCreate(dir string) (*Keys, error) {
	path := filepath.Join(dir, fileName)
	k, err := load(path)
	if err == nil || !errors.Is(err, os.ErrNotExist) {
		return k, err
	}
	return create(path)
}

// load refuses a symlinked, foreign-owned or loose key file. A corrupt key is an error — it is
// never silently regenerated (that would orphan the paired account).
func load(path string) (*Keys, error) {
	lfi, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if lfi.Mode()&os.ModeSymlink != 0 || !lfi.Mode().IsRegular() || !home.OwnerOnly(lfi) {
		return nil, ErrInsecurePerms
	}
	if dfi, err := os.Stat(filepath.Dir(path)); err != nil || !home.OwnerOnly(dirAsFile{dfi}) {
		return nil, ErrInsecurePerms
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var v fileV1
	if err := json.NewDecoder(f).Decode(&v); err != nil {
		return nil, fmt.Errorf("engine.key: %w", err)
	}
	seed, err := ic.UnB64(v.SignPriv)
	if err != nil || len(seed) != ed25519.SeedSize || v.V != 1 {
		return nil, errors.New("engine.key: bad signing key")
	}
	kemRaw, err := ic.UnB64(v.KEMPriv)
	if err != nil {
		return nil, errors.New("engine.key: bad sealing key")
	}
	kp, err := ic.ParseKEMPrivate(kemRaw)
	if err != nil {
		return nil, errors.New("engine.key: bad sealing key")
	}
	return &Keys{EngineID: v.EngineID, Sign: ed25519.NewKeyFromSeed(seed), KEMPriv: kp, KEMPub: kp.Public()}, nil
}

func create(path string) (*Keys, error) {
	id, err := ic.NewID(rand.Reader)
	if err != nil {
		return nil, err
	}
	_, sign, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	kp, kpub, err := ic.GenerateKEMKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	kemRaw, err := kp.MarshalBinary()
	if err != nil {
		return nil, err
	}
	b, err := json.Marshal(fileV1{V: 1, EngineID: id, SignPriv: ic.B64(sign.Seed()), KEMPriv: ic.B64(kemRaw)})
	if err != nil {
		return nil, err
	}
	// Write a complete temp file, then hard-link it into place: the key file is never seen half
	// written, and two first runs racing cannot both install a key (the loser loads the winner's).
	tmp := fmt.Sprintf("%s.tmp-%s", path, id)
	if err := writeOwnerOnly(tmp, b); err != nil {
		return nil, err
	}
	defer os.Remove(tmp)
	if err := os.Link(tmp, path); err != nil {
		if errors.Is(err, os.ErrExist) {
			return load(path)
		}
		return nil, err
	}
	excludeFromBackup(path)
	return &Keys{EngineID: id, Sign: sign, KEMPriv: kp, KEMPub: kpub}, nil
}

// excludeFromBackup keeps engine.key out of Time Machine (best effort, macOS only).
func excludeFromBackup(path string) {
	if runtime.GOOS == "darwin" {
		_ = tmutilExclude(path)
	}
}

func writeOwnerOnly(path string, b []byte) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if err := home.RestrictFile(path); err != nil {
		f.Close()
		return err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// dirAsFile lets OwnerOnly judge a directory by its group/other bits (0700 expected).
type dirAsFile struct{ os.FileInfo }

func (d dirAsFile) Mode() os.FileMode { return d.FileInfo.Mode() &^ 0o100 }
