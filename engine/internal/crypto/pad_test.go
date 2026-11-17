package crypto

import "testing"

func TestPaddedLen(t *testing.T) {
	cases := map[int]int{0: 256, 1: 256, 255: 256, 256: 512, 4095: 4096, 4096: 8192, 9000: 12288}
	for in, want := range cases {
		if got := PaddedLen(in); got != want {
			t.Errorf("PaddedLen(%d)=%d want %d", in, got, want)
		}
	}
}

func TestPadRoundTrip(t *testing.T) {
	for _, n := range []int{0, 1, 255, 256, 4095, 4096, 9000} {
		p := make([]byte, n)
		for i := range p {
			p[i] = 0x80 // content may contain 0x80; only the final marker counts
		}
		out, err := Unpad(Pad(p))
		if err != nil || len(out) != n {
			t.Fatalf("n=%d err=%v len=%d", n, err, len(out))
		}
	}
}

func TestUnpadRejects(t *testing.T) {
	bad := [][]byte{make([]byte, 256), append(make([]byte, 255), 0x01), {0x80}}
	for i, b := range bad {
		if _, err := Unpad(b); err == nil {
			t.Errorf("case %d: want error", i)
		}
	}
}
