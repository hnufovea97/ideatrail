package commit

import (
	"errors"
	"testing"
)

func TestNormalizePath(t *testing.T) {
	ok := map[string]string{
		"src\\a.go": "src/a.go",
		"메모.md":   "메모.md",   // NFD 메모.md → NFC
		"Read.MD":   "Read.MD", // 대소문자 그대로
	}
	for in, want := range ok {
		got, err := NormalizePath(in)
		if err != nil || got != want {
			t.Errorf("NormalizePath(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	bad := []string{"", "/a", "a/", "a//b", ".", "a/./b", "a\\..\\b", "\\a", "bad\xff.md"}
	for _, in := range bad {
		if _, err := NormalizePath(in); !errors.Is(err, ErrInvalidPath) {
			t.Errorf("NormalizePath(%q) err = %v; want ErrInvalidPath", in, err)
		}
	}
}
