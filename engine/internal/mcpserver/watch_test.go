package mcpserver

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestWatchSignupTicksUntilCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var n atomic.Int32
	done := make(chan struct{})
	go func() {
		watchSignup(ctx, 5*time.Millisecond, func(context.Context) { n.Add(1) })
		close(done)
	}()
	time.Sleep(60 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("watchSignup did not stop when cancelled")
	}
	got := n.Load()
	if got < 3 {
		t.Fatalf("ticks = %d, want >= 3", got)
	}
	time.Sleep(20 * time.Millisecond)
	if n.Load() != got {
		t.Fatal("ticked after cancel")
	}
}

// While another background round holds the lock, a signup tick must not start a second one.
func TestTickOnceSkipsWhileBackgroundRuns(t *testing.T) {
	e := &Engine{}
	e.bg.Lock()
	defer e.bg.Unlock()
	e.tickOnce(context.Background()) // a zero Engine would panic inside Tick; returning early is the point
}
