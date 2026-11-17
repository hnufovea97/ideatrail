package crypto

import "testing"

func TestJoinFieldsRejectsSeparators(t *testing.T) {
	for _, f := range []string{"a\x1fb", "a\nb"} {
		if _, err := joinFields(sepAAD, []string{"ok", f}); err != ErrBadField {
			t.Errorf("%q: want ErrBadField, got %v", f, err)
		}
	}
	if s, _ := joinFields(sepAAD, []string{"a", orDash(""), "c"}); s != "a\x1f-\x1fc" {
		t.Errorf("got %q", s)
	}
}
