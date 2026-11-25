package inbox

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/cloudflare/circl/kem"

	"ideatrail/engine/internal/api"
	ic "ideatrail/engine/internal/crypto"
	"ideatrail/engine/internal/keys"
	"ideatrail/engine/internal/state"
	"ideatrail/engine/internal/testsrv"
)

const testUser = "01jcm3v8q7s2kx4f9d6b5n0tqw"

type env struct {
	d         Deps
	srv       *testsrv.Server
	akPriv    kem.PrivateKey
	folder    string
	mu        sync.Mutex
	approvals []map[string]any
	inbox     []map[string]string
	deleted   []string
}

func newEnv(t *testing.T) *env {
	t.Helper()
	base, _ := filepath.EvalSymlinks(t.TempDir())
	engine := filepath.Join(base, "engine")
	_ = os.Mkdir(engine, 0o700)
	k, _ := keys.LoadOrCreate(engine)
	e := &env{srv: testsrv.New(), folder: filepath.Join(base, "my-idea")}
	_ = os.MkdirAll(e.folder, 0o700)
	_ = os.WriteFile(filepath.Join(e.folder, "plan.md"), []byte("x"), 0o600)
	t.Cleanup(e.srv.Close)
	e.srv.AddEngine(k.EngineID, k.SignPub())
	e.srv.Handle("POST", "/v1/approvals", func(w http.ResponseWriter, r *http.Request, body []byte, _ string) {
		var b map[string]any
		_ = json.Unmarshal(body, &b)
		e.mu.Lock()
		e.approvals = append(e.approvals, b)
		e.mu.Unlock()
		testsrv.JSON(w, 201, map[string]any{})
	})
	e.srv.Handle("GET", "/v1/inbox", func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		e.mu.Lock()
		defer e.mu.Unlock()
		testsrv.JSON(w, 200, map[string]any{"messages": e.inbox})
	})
	e.srv.Handle("DELETE", "/v1/inbox/:id", func(w http.ResponseWriter, r *http.Request, _ []byte, _ string) {
		e.mu.Lock()
		e.deleted = append(e.deleted, r.URL.Path)
		e.mu.Unlock()
		testsrv.JSON(w, 200, map[string]any{})
	})
	sk, pk, _ := ic.GenerateKEMKey(rand.Reader)
	e.akPriv = sk
	pkRaw, _ := pk.MarshalBinary()
	_ = state.With(engine, func(s *state.State) error { s.UserID, s.AccountPub = testUser, ic.B64(pkRaw); return nil })
	c, _ := api.New(e.srv.URL, k, engine)
	e.d = Deps{API: c, Keys: k, StateDir: engine}
	return e
}

// send plays the dashboard: an Auth-mode message from the account key to the engine key.
func (e *env) send(t *testing.T, approvalID string, p map[string]any, sender kem.PrivateKey) string {
	t.Helper()
	if _, ok := p["issued_at"]; !ok {
		p["issued_at"] = ic.FormatTime(time.Now())
	}
	p["v"] = 1
	pt, _ := json.Marshal(p)
	msgID, _ := ic.NewID(rand.Reader)
	var sealed []byte
	var err error
	if sender == nil {
		sealed, err = ic.Seal(ic.KindRecordMeta, e.d.Keys.KEMPub, ic.AAD{UserID: testUser}, pt) // wrong kind/mode
	} else {
		sealed, err = ic.SealAuth(ic.KindEngineInbox, e.d.Keys.KEMPub, sender, ic.AAD{UserID: testUser, RootID: approvalID, RecordID: msgID}, pt)
	}
	if err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.inbox = append(e.inbox, map[string]string{"msg_id": msgID, "sealed": ic.B64(sealed)})
	e.mu.Unlock()
	return msgID
}

func (e *env) process(t *testing.T) []Event {
	t.Helper()
	ev, err := Process(context.Background(), e.d)
	if err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	e.inbox = nil
	e.mu.Unlock()
	return ev
}

func folders(t *testing.T, e *env) map[string]string {
	st, _ := state.Read(e.d.StateDir)
	return st.Folders
}

func TestApprovedImportRegistersOnlyRequestedFolder(t *testing.T) {
	e := newEnv(t)
	id, err := RequestImport(context.Background(), e.d, "import", []string{e.folder})
	if err != nil || len(e.approvals) != 1 || e.approvals[0]["appr_seq"] != "1" {
		t.Fatalf("%v %v", err, e.approvals)
	}
	if len(folders(t, e)) != 0 {
		t.Fatal("registered before approval")
	}
	e.send(t, id, map[string]any{"type": "approval_result", "approval_id": id, "decision": "approved"}, e.akPriv)
	ev := e.process(t)
	if len(ev) != 1 || ev[0].Kind != "folders_registered" || ev[0].Folders != 1 {
		t.Fatalf("%+v", ev)
	}
	if _, ok := folders(t, e)[e.folder]; !ok {
		t.Fatal("folder not registered")
	}
	if len(e.deleted) != 1 {
		t.Fatal("message not deleted")
	}
}

func TestRejectedForgedReplayedAndForeignMessagesDoNothing(t *testing.T) {
	e := newEnv(t)
	id, _ := RequestImport(context.Background(), e.d, "import", []string{e.folder})
	_, otherAK, _ := ic.GenerateKEMKey(rand.Reader)
	otherPriv, _, _ := ic.GenerateKEMKey(rand.Reader)
	_ = otherAK
	e.send(t, id, map[string]any{"type": "approval_result", "approval_id": id, "decision": "approved"}, nil)                                // server-made (not Auth)
	e.send(t, id, map[string]any{"type": "approval_result", "approval_id": id, "decision": "approved"}, otherPriv)                          // another account key
	e.send(t, "", map[string]any{"type": "approval_result", "approval_id": "01jcm3v8q7s2kx4f9d6b5n0tqz", "decision": "approved"}, e.akPriv) // not our request
	if ev := e.process(t); len(ev) != 0 || len(folders(t, e)) != 0 {
		t.Fatalf("acted on bad messages: %+v", ev)
	}
	e.send(t, id, map[string]any{"type": "approval_result", "approval_id": id, "decision": "rejected"}, e.akPriv)
	if ev := e.process(t); len(ev) != 1 || ev[0].Kind != "rejected" || len(folders(t, e)) != 0 {
		t.Fatalf("%+v", ev)
	}
	// a later "approved" for the same (now closed) request does nothing
	e.send(t, id, map[string]any{"type": "approval_result", "approval_id": id, "decision": "approved"}, e.akPriv)
	if ev := e.process(t); len(ev) != 0 || len(folders(t, e)) != 0 {
		t.Fatalf("%+v", ev)
	}
}

func TestReplayedMessageIgnored(t *testing.T) {
	e := newEnv(t)
	msgID := e.send(t, "", map[string]any{"type": "connect_github"}, e.akPriv)
	first := e.inbox[0]
	if ev := e.process(t); len(ev) != 1 || ev[0].Kind != "connect_github" {
		t.Fatalf("%+v", ev)
	}
	e.inbox = []map[string]string{first}
	if ev := e.process(t); len(ev) != 0 {
		t.Fatalf("replay of %s acted on", msgID)
	}
}

func TestStaleConnectRequestIgnored(t *testing.T) {
	e := newEnv(t)
	e.send(t, "", map[string]any{"type": "connect_github", "issued_at": ic.FormatTime(time.Now().Add(-11 * time.Minute))}, e.akPriv)
	if ev := e.process(t); len(ev) != 0 {
		t.Fatalf("%+v", ev)
	}
}

func TestSelectFoldersNeverAddsInventedFolders(t *testing.T) {
	e := newEnv(t)
	id, err := RequestImport(context.Background(), e.d, "signup_select", []string{e.folder})
	if err != nil {
		t.Fatal(err)
	}
	invented := filepath.Join(filepath.Dir(e.folder), "secret-notes")
	_ = os.MkdirAll(invented, 0o700)
	e.send(t, id, map[string]any{"type": "select_folders", "approval_id": id, "folders": []string{e.folder, invented}}, e.akPriv)
	e.process(t)
	f := folders(t, e)
	if _, ok := f[invented]; ok || len(f) != 1 {
		t.Fatalf("folders %v", f)
	}
}

func TestRequestLimitsAndDangerousFolders(t *testing.T) {
	e := newEnv(t)
	fakeHome, _ := filepath.EvalSymlinks(t.TempDir())
	t.Setenv("HOME", fakeHome)
	if _, err := RequestImport(context.Background(), e.d, "import", []string{fakeHome}); !errors.Is(err, ErrBadFolder) {
		t.Fatalf("home accepted: %v", err)
	}
	if _, err := RequestImport(context.Background(), e.d, "import", []string{filepath.Dir(e.d.StateDir)}); !errors.Is(err, ErrBadFolder) {
		t.Fatalf("engine ancestor accepted: %v", err)
	}
	for i := 0; i < MaxOpen; i++ {
		d := filepath.Join(filepath.Dir(e.folder), "idea"+string(rune('a'+i)))
		_ = os.MkdirAll(d, 0o700)
		if _, err := RequestImport(context.Background(), e.d, "import", []string{d}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := RequestImport(context.Background(), e.d, "import", []string{e.folder}); !errors.Is(err, ErrTooMany) {
		t.Fatalf("got %v", err)
	}
	// unanswered requests expire and stop holding the limit
	e.d.Now = func() time.Time { return time.Now().Add(8 * 24 * time.Hour) }
	if _, err := RequestImport(context.Background(), e.d, "import", []string{e.folder}); err != nil {
		t.Fatalf("expired requests still block: %v", err)
	}
	st, _ := state.Read(e.d.StateDir)
	if open := openApprovals(st, e.d.now()); open != 1 {
		t.Fatalf("open=%d", open)
	}
	// closed requests are forgotten after approvalKeep
	e.d.Now = func() time.Time { return time.Now().Add(60 * 24 * time.Hour) }
	_ = state.With(e.d.StateDir, func(s *state.State) error { prune(s, e.d.now()); return nil })
	st, _ = state.Read(e.d.StateDir)
	if len(st.Approvals) != 0 {
		t.Fatalf("kept %d old approvals", len(st.Approvals))
	}
}

func TestRefusedRequestIsClosedAndOthersStillSendInOrder(t *testing.T) {
	e := newEnv(t)
	var order []string
	e.srv.Handle("POST", "/v1/approvals", func(w http.ResponseWriter, r *http.Request, body []byte, _ string) {
		var b map[string]any
		_ = json.Unmarshal(body, &b)
		e.mu.Lock()
		order = append(order, b["appr_seq"].(string))
		e.mu.Unlock()
		testsrv.JSON(w, 400, map[string]any{"error": "bad_request"})
	})
	if _, err := RequestImport(context.Background(), e.d, "import", []string{e.folder}); err != nil {
		t.Fatal(err)
	}
	st, _ := state.Read(e.d.StateDir)
	for _, a := range st.Approvals {
		if !a.Done || a.Body != "" {
			t.Fatalf("refused request still open: %+v", a)
		}
	}
	if len(order) != 1 || order[0] != "1" {
		t.Fatalf("order %v", order)
	}
}

func TestSignupSummaryMarksTheCurrentProject(t *testing.T) {
	e := newEnv(t)
	other := filepath.Join(filepath.Dir(e.folder), "가계부 앱")
	_ = os.MkdirAll(other, 0o700)
	_ = os.WriteFile(filepath.Join(other, "plan.md"), []byte("x"), 0o600)
	id, err := RequestImport(context.Background(), e.d, "signup_select", []string{e.folder, other})
	if err != nil {
		t.Fatal(err)
	}
	e.mu.Lock()
	body := e.approvals[len(e.approvals)-1]
	e.mu.Unlock()
	sealed, _ := ic.UnB64(body["summary"].(string))
	pt, err := ic.Open(ic.KindFolderSuggestions, e.akPriv, ic.AAD{UserID: testUser, RootID: id, Version: "0"}, sealed)
	if err != nil {
		t.Fatal(err)
	}
	var s struct {
		Folders []struct {
			Path    string `json:"path"`
			Current bool   `json:"current"`
		} `json:"folders"`
	}
	_ = json.Unmarshal(pt, &s)
	if len(s.Folders) != 2 || !s.Folders[0].Current || s.Folders[1].Current {
		t.Fatalf("summary %+v", s.Folders)
	}
}

// openSignupSummary opens the newest posted signup_select summary as the browser would.
func (e *env) openSignupSummary(t *testing.T, id string) []map[string]any {
	t.Helper()
	e.mu.Lock()
	body := e.approvals[len(e.approvals)-1]
	e.mu.Unlock()
	sealed, _ := ic.UnB64(body["summary"].(string))
	pt, err := ic.Open(ic.KindFolderSuggestions, e.akPriv, ic.AAD{UserID: testUser, RootID: id, Version: "0"}, sealed)
	if err != nil {
		t.Fatal(err)
	}
	var s struct {
		Folders []map[string]any `json:"folders"`
	}
	if err := json.Unmarshal(pt, &s); err != nil {
		t.Fatal(err)
	}
	return s.Folders
}

// Re-pairing on a machine that already records this project: the browser must still get a list
// (with the project marked current), never wait for one that is not coming.
func TestSignupKeepsAnAlreadyRegisteredProject(t *testing.T) {
	e := newEnv(t)
	_ = state.With(e.d.StateDir, func(s *state.State) error {
		s.Folders = map[string]string{e.folder: "01jcm3v8q7s2kx4f9d6b5n0tqy"}
		return nil
	})
	id, err := RequestImport(context.Background(), e.d, "signup_select", []string{e.folder})
	if err != nil {
		t.Fatal(err)
	}
	fs := e.openSignupSummary(t, id)
	if len(fs) != 1 || fs[0]["path"] != e.folder || fs[0]["current"] != true {
		t.Fatalf("summary %+v", fs)
	}
	e.send(t, id, map[string]any{"type": "select_folders", "approval_id": id, "folders": []string{e.folder}}, e.akPriv)
	if ev := e.process(t); len(ev) != 1 || ev[0].Folders != 0 {
		t.Fatalf("events %+v (an already registered folder is not registered again)", ev)
	}
	// AI-asked imports still drop registered folders and refuse an empty list
	if _, err := RequestImport(context.Background(), e.d, "import", []string{e.folder}); !errors.Is(err, ErrBadFolder) {
		t.Fatalf("import of a registered folder: %v", err)
	}
}

// Nothing safe to offer (no project folder, or the project is the home folder): post an empty
// signup list so the browser can finish step 5 instead of timing out.
func TestSignupWithNothingToOfferStillPostsAnEmptyList(t *testing.T) {
	e := newEnv(t)
	fakeHome, _ := filepath.EvalSymlinks(t.TempDir())
	t.Setenv("HOME", fakeHome)
	id, err := RequestImport(context.Background(), e.d, "signup_select", []string{fakeHome})
	if err != nil {
		t.Fatal(err)
	}
	if fs := e.openSignupSummary(t, id); fs == nil || len(fs) != 0 {
		t.Fatalf("summary %#v, want an empty list (not null: the browser requires an array)", fs)
	}
	if _, err := RequestImport(context.Background(), e.d, "signup_select", nil); err != nil {
		t.Fatalf("no project folder: %v", err)
	}
	if _, err := RequestImport(context.Background(), e.d, "import", []string{fakeHome}); !errors.Is(err, ErrBadFolder) {
		t.Fatalf("AI-asked import of home: %v", err)
	}
}

func TestSignupListAtMostFive(t *testing.T) {
	e := newEnv(t)
	var fs []string
	for i := 0; i < 6; i++ {
		d := filepath.Join(filepath.Dir(e.folder), "idea"+string(rune('a'+i)))
		_ = os.MkdirAll(d, 0o700)
		fs = append(fs, d)
	}
	if _, err := RequestImport(context.Background(), e.d, "signup_select", fs); !errors.Is(err, ErrBadFolder) {
		t.Fatalf("six folders: %v", err)
	}
	if _, err := RequestImport(context.Background(), e.d, "signup_select", fs[:MaxFolders]); err != nil {
		t.Fatalf("five folders: %v", err)
	}
}

func TestSignupSelectionReportsRegisteredPaths(t *testing.T) {
	e := newEnv(t)
	id, err := RequestImport(context.Background(), e.d, "signup_select", []string{e.folder})
	if err != nil {
		t.Fatal(err)
	}
	e.send(t, id, map[string]any{"type": "select_folders", "approval_id": id, "folders": []string{e.folder}}, e.akPriv)
	ev := e.process(t)
	if len(ev) != 1 || ev[0].Kind != "folders_registered" || !ev[0].Signup || len(ev[0].Paths) != 1 || ev[0].Paths[0] != e.folder {
		t.Fatalf("events %+v", ev)
	}
}

// Zero folders chosen: the browser sends decide "rejected" + select_folders []. The request closes
// and the event carries no paths, so the first import does nothing.
func TestSignupSelectionOfNothingCarriesNoPaths(t *testing.T) {
	e := newEnv(t)
	id, err := RequestImport(context.Background(), e.d, "signup_select", []string{e.folder})
	if err != nil {
		t.Fatal(err)
	}
	e.send(t, id, map[string]any{"type": "select_folders", "approval_id": id, "folders": []string{}}, e.akPriv)
	ev := e.process(t)
	if len(ev) != 1 || ev[0].Kind != "folders_registered" || ev[0].Folders != 0 || len(ev[0].Paths) != 0 {
		t.Fatalf("events %+v", ev)
	}
	if len(folders(t, e)) != 0 {
		t.Fatal("registered a folder nobody chose")
	}
}

// Only select_folders completes a signup list: an approval_result for it (which would register
// every folder the engine offered) is ignored and leaves the request open.
func TestApprovalResultCannotCompleteASignupList(t *testing.T) {
	e := newEnv(t)
	id, err := RequestImport(context.Background(), e.d, "signup_select", []string{e.folder})
	if err != nil {
		t.Fatal(err)
	}
	e.send(t, id, map[string]any{"type": "approval_result", "approval_id": id, "decision": "approved"}, e.akPriv)
	if ev := e.process(t); len(ev) != 0 {
		t.Fatalf("events %+v", ev)
	}
	if len(folders(t, e)) != 0 {
		t.Fatal("approval_result registered signup folders")
	}
	st, _ := state.Read(e.d.StateDir)
	if st.Approvals[id].Done {
		t.Fatal("approval_result closed the signup list")
	}
}

func pendingUpdate(t *testing.T, e *env, to string) {
	t.Helper()
	_ = state.With(e.d.StateDir, func(s *state.State) error {
		s.ApprovedVersion = "0.1.0"
		s.UpdatePending = &state.UpdatePending{Version: to}
		return nil
	})
}

func TestRequestUpdateSummaryShapeAndStateApproval(t *testing.T) {
	e := newEnv(t)
	pendingUpdate(t, e, "0.2.0")
	id, err := RequestUpdate(context.Background(), e.d, "0.1.0", "0.2.0", []string{"하나", "둘"})
	if err != nil || len(e.approvals) != 1 || e.approvals[0]["kind"] != "update" || e.approvals[0]["appr_seq"] != "1" {
		t.Fatalf("%v %v", err, e.approvals)
	}
	st, _ := state.Read(e.d.StateDir)
	a := st.Approvals[id]
	if a.Kind != "update" || a.Folders != nil || a.Version != "0.2.0" {
		t.Fatalf("%+v", a)
	}
	// open the sealed summary with the account key: same AAD as the other approvals
	sealed, _ := ic.UnB64(e.approvals[0]["summary"].(string))
	pt, err := ic.Open(ic.KindApprovalSummary, e.akPriv, ic.AAD{UserID: testUser, RootID: id, Version: "0"}, sealed)
	if err != nil {
		t.Fatal(err)
	}
	if string(pt) != `{"update":{"changes":["하나","둘"],"from":"0.1.0","to":"0.2.0"},"v":1}` {
		t.Fatalf("%s", pt)
	}
}

func TestApprovedUpdateSetsVersionAndRegistersNoFolder(t *testing.T) {
	e := newEnv(t)
	pendingUpdate(t, e, "0.2.0")
	id, _ := RequestUpdate(context.Background(), e.d, "0.1.0", "0.2.0", nil)
	e.send(t, id, map[string]any{"type": "approval_result", "approval_id": id, "decision": "approved", "folders": []string{e.folder}}, e.akPriv)
	ev := e.process(t)
	if len(ev) != 1 || ev[0].Kind != "update_approved" {
		t.Fatalf("%+v", ev)
	}
	st, _ := state.Read(e.d.StateDir)
	if st.ApprovedVersion != "0.2.0" || st.UpdatePending != nil || len(st.Folders) != 0 {
		t.Fatalf("%+v", st)
	}
}

func TestRejectedUpdateStaysPendingAndRejected(t *testing.T) {
	e := newEnv(t)
	pendingUpdate(t, e, "0.2.0")
	id, _ := RequestUpdate(context.Background(), e.d, "0.1.0", "0.2.0", nil)
	e.send(t, id, map[string]any{"type": "approval_result", "approval_id": id, "decision": "rejected"}, e.akPriv)
	ev := e.process(t)
	if len(ev) != 1 || ev[0].Kind != "update_rejected" {
		t.Fatalf("%+v", ev)
	}
	st, _ := state.Read(e.d.StateDir)
	if st.ApprovedVersion != "0.1.0" || st.UpdatePending == nil || !st.UpdatePending.Rejected || len(st.Folders) != 0 {
		t.Fatalf("%+v", st)
	}
}

func TestSelectFoldersForUpdateIsIgnored(t *testing.T) {
	e := newEnv(t)
	pendingUpdate(t, e, "0.2.0")
	id, _ := RequestUpdate(context.Background(), e.d, "0.1.0", "0.2.0", nil)
	e.send(t, id, map[string]any{"type": "select_folders", "approval_id": id, "folders": []string{e.folder}}, e.akPriv)
	if ev := e.process(t); len(ev) != 0 {
		t.Fatalf("%+v", ev)
	}
	st, _ := state.Read(e.d.StateDir)
	if st.ApprovedVersion != "0.1.0" || len(st.Folders) != 0 {
		t.Fatalf("%+v", st)
	}
}

func TestRequestUpdateNeedsPairing(t *testing.T) {
	e := newEnv(t)
	_ = state.With(e.d.StateDir, func(s *state.State) error { s.UserID = ""; return nil })
	if _, err := RequestUpdate(context.Background(), e.d, "0.1.0", "0.2.0", nil); !errors.Is(err, ErrNotPaired) {
		t.Fatalf("%v", err)
	}
}
