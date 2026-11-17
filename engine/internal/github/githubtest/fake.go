// Package githubtest is an in-memory fake GitHub for engine tests.
package githubtest

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// fakeGitHub is an in-memory GitHub: users, repos, blobs, trees, commits, refs, contents.
type Fake struct {
	*httptest.Server
	mu            sync.Mutex
	Login         string
	Repos         map[string]map[string]any // full_name → repo json
	blobs         map[string][]byte
	trees         map[string]map[string]string // tree sha → path → blob sha
	commits       map[string][2]string         // commit sha → {tree, parent}
	refs          map[string]string            // full_name → head commit
	CreateErr     int
	BeforePatch   func() // hook to simulate a concurrent push
	RateLimitLeft int
	calls         []string
}

func New(t *testing.T) *Fake {
	f := &Fake{Login: "steven", Repos: map[string]map[string]any{}, blobs: map[string][]byte{},
		trees: map[string]map[string]string{}, commits: map[string][2]string{}, refs: map[string]string{}}
	f.Server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.Close)
	return f
}

func hash(parts ...string) string {
	h := sha1.New()
	for _, p := range parts {
		h.Write([]byte(p))
	}
	return hex.EncodeToString(h.Sum(nil))
}

func (f *Fake) AddRepo(name string, private bool, owner string) {
	full := owner + "/" + name
	f.Repos[full] = map[string]any{"id": len(f.Repos) + 100, "full_name": full, "private": private, "default_branch": "main",
		"owner": map[string]string{"login": owner}, "permissions": map[string]bool{"push": owner == f.Login}}
}

// files returns the head tree of a repo as path → content.
func (f *Fake) Files(full string) map[string]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]string{}
	head := f.refs[full]
	if head == "" {
		return out
	}
	for p, b := range f.trees[f.commits[head][0]] {
		out[p] = string(f.blobs[b])
	}
	return out
}

func (f *Fake) CommitCount(full string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for c := f.refs[full]; c != ""; c = f.commits[c][1] {
		n++
	}
	return n
}

func (f *Fake) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.calls = append(f.calls, r.Method+" "+r.URL.Path)
	if f.RateLimitLeft > 0 {
		f.RateLimitLeft--
		f.mu.Unlock()
		w.Header().Set("Retry-After", "1")
		w.WriteHeader(429)
		return
	}
	f.mu.Unlock()
	body, _ := io.ReadAll(r.Body)
	var in map[string]any
	_ = json.Unmarshal(body, &in)
	reply := func(code int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(v)
	}
	p := r.URL.Path
	f.mu.Lock()
	defer f.mu.Unlock()
	switch {
	case r.Method == "GET" && p == "/user":
		reply(200, map[string]string{"login": f.Login})
	case r.Method == "POST" && p == "/user/repos":
		if f.CreateErr != 0 {
			reply(f.CreateErr, map[string]string{"message": "SECRET-BODY Resource not accessible"})
			return
		}
		name := in["name"].(string)
		f.AddRepo(name, in["private"] == true, f.Login)
		reply(201, f.Repos[f.Login+"/"+name])
	case strings.HasPrefix(p, "/repos/"):
		f.repoAPI(r, strings.TrimPrefix(p, "/repos/"), in, reply)
	default:
		reply(404, map[string]string{"message": "Not Found"})
	}
}

func (f *Fake) repoAPI(r *http.Request, rest string, in map[string]any, reply func(int, any)) {
	parts := strings.SplitN(rest, "/", 3)
	if len(parts) < 2 {
		reply(404, nil)
		return
	}
	full := parts[0] + "/" + parts[1]
	repo, ok := f.Repos[full]
	if !ok {
		reply(404, map[string]string{"message": "Not Found"})
		return
	}
	sub := ""
	if len(parts) == 3 {
		sub = parts[2]
	}
	switch {
	case sub == "" && r.Method == "GET":
		reply(200, repo)
	case strings.HasPrefix(sub, "contents/") && r.Method == "PUT":
		path := strings.TrimPrefix(sub, "contents/")
		content, _ := base64.StdEncoding.DecodeString(in["content"].(string))
		f.commitLocked(full, map[string][]byte{path: content})
		reply(201, map[string]any{})
	case strings.HasPrefix(sub, "contents/") && r.Method == "GET":
		path := strings.TrimPrefix(sub, "contents/")
		commit := r.URL.Query().Get("ref")
		if _, ok := f.trees[f.commits[commit][0]][path]; ok {
			reply(200, map[string]any{"path": path})
			return
		}
		reply(404, nil)
	case sub == "git/ref/heads/main" && r.Method == "GET":
		if f.refs[full] == "" {
			reply(409, map[string]string{"message": "Git Repository is empty."})
			return
		}
		reply(200, map[string]any{"object": map[string]string{"sha": f.refs[full]}})
	case strings.HasPrefix(sub, "git/commits/") && r.Method == "GET":
		c := f.commits[strings.TrimPrefix(sub, "git/commits/")]
		reply(200, map[string]any{"tree": map[string]string{"sha": c[0]}})
	case sub == "git/blobs" && r.Method == "POST":
		b, _ := base64.StdEncoding.DecodeString(in["content"].(string))
		sha := hash("blob", string(b))
		f.blobs[sha] = b
		reply(201, map[string]string{"sha": sha})
	case sub == "git/trees" && r.Method == "POST":
		files := map[string]string{}
		for k, v := range f.trees[in["base_tree"].(string)] {
			files[k] = v
		}
		for _, e := range in["tree"].([]any) {
			m := e.(map[string]any)
			files[m["path"].(string)] = m["sha"].(string)
		}
		sha := hash(fmtTree(files))
		f.trees[sha] = files
		reply(201, map[string]string{"sha": sha})
	case sub == "git/commits" && r.Method == "POST":
		parents := in["parents"].([]any)
		sha := hash(in["tree"].(string), parents[0].(string), in["message"].(string))
		f.commits[sha] = [2]string{in["tree"].(string), parents[0].(string)}
		reply(201, map[string]string{"sha": sha})
	case sub == "git/refs/heads/main" && r.Method == "PATCH":
		if f.BeforePatch != nil {
			hook := f.BeforePatch
			f.BeforePatch = nil
			f.mu.Unlock()
			hook()
			f.mu.Lock()
		}
		newSha := in["sha"].(string)
		if f.commits[newSha][1] != f.refs[full] {
			reply(422, map[string]string{"message": "Update is not a fast forward"})
			return
		}
		f.refs[full] = newSha
		reply(200, map[string]any{})
	default:
		reply(404, nil)
	}
}

// commitLocked commits directly (used by the Contents API and by "someone else pushed").
func (f *Fake) commitLocked(full string, files map[string][]byte) {
	parent := f.refs[full]
	merged := map[string]string{}
	if parent != "" {
		for k, v := range f.trees[f.commits[parent][0]] {
			merged[k] = v
		}
	}
	for p, b := range files {
		sha := hash("blob", string(b))
		f.blobs[sha] = b
		merged[p] = sha
	}
	tree := hash(fmtTree(merged))
	f.trees[tree] = merged
	c := hash(tree, parent, "direct")
	f.commits[c] = [2]string{tree, parent}
	f.refs[full] = c
}

func fmtTree(files map[string]string) string {
	b, _ := json.Marshal(files)
	return string(b)
}

// PushDirect commits as "someone else" (locks internally).
func (f *Fake) PushDirect(full string, files map[string][]byte) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.commitLocked(full, files)
}

// Lock/Unlock expose the fake's mutex for hooks.
func (f *Fake) Lock()   { f.mu.Lock() }
func (f *Fake) Unlock() { f.mu.Unlock() }
