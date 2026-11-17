package github

import (
	"context"
	"encoding/base64"
	"errors"
	"regexp"
	"strconv"
)

const (
	repoName   = "ideatrail-proofs"
	maxSuffix  = 5
	readmeText = "# Ideatrail 증명 보관함\n\n이 저장소의 파일들은 당신의 계정 열쇠로 잠겨 있어요. Ideatrail 대시보드에서만 풀 수 있어요.\n\nThese files are encrypted to your Ideatrail account key and can only be opened in your Ideatrail dashboard.\n"
)

var (
	repoNameRe      = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$`)
	ErrRepoUnsafe   = errors.New("no safe private repository available")
	ErrNotInstalled = errors.New("the GitHub app cannot create repositories for this account")
)

// Repo is the pinned proofs repository.
type Repo struct {
	FullName      string `json:"repo_full_name"`
	ID            int64  `json:"repo_id"`
	DefaultBranch string `json:"default_branch"`
}

type ghRepo struct {
	ID            int64  `json:"id"`
	FullName      string `json:"full_name"`
	Private       bool   `json:"private"`
	DefaultBranch string `json:"default_branch"`
	Owner         struct {
		Login string `json:"login"`
	} `json:"owner"`
	Permissions struct {
		Push bool `json:"push"`
	} `json:"permissions"`
}

// EnsureRepo finds or creates the private proofs repo. An existing repo is used only if it is
// private, owned by the signed-in user and writable; otherwise the next free name is tried.
func EnsureRepo(ctx context.Context, c *Client) (Repo, error) {
	var me struct {
		Login string `json:"login"`
	}
	if err := c.do(ctx, "GET", "/user", nil, &me); err != nil || me.Login == "" {
		return Repo{}, ErrRepoUnsafe
	}
	for i := 0; i < maxSuffix; i++ {
		name := repoName
		if i > 0 {
			name += "-" + strconv.Itoa(i+1)
		}
		var r ghRepo
		err := c.do(ctx, "GET", "/repos/"+me.Login+"/"+name, nil, &r)
		var ge *Error
		switch {
		case err == nil:
			if r.Private && r.Owner.Login == me.Login && r.Permissions.Push && repoNameRe.MatchString(r.FullName) {
				return Repo{FullName: r.FullName, ID: r.ID, DefaultBranch: branchOr(r.DefaultBranch)}, nil
			}
			continue // public, foreign or read-only: never write there
		case errors.As(err, &ge) && ge.Status == 404:
			return create(ctx, c, me.Login, name)
		default:
			return Repo{}, err
		}
	}
	return Repo{}, ErrRepoUnsafe
}

func create(ctx context.Context, c *Client, login, name string) (Repo, error) {
	var r ghRepo
	err := c.do(ctx, "POST", "/user/repos", map[string]any{
		"name": name, "private": true, "auto_init": false, "has_issues": false, "has_wiki": false, "has_projects": false,
		"description": "Ideatrail proofs (encrypted)",
	}, &r)
	var ge *Error
	if errors.As(err, &ge) && ge.Status == 403 {
		return Repo{}, ErrNotInstalled // M0 H17: the app must be installed first
	}
	if err != nil || !r.Private || r.Owner.Login != login || !repoNameRe.MatchString(r.FullName) {
		return Repo{}, ErrRepoUnsafe
	}
	// An empty repo has no branch; the Contents API creates the first commit and the default branch.
	if err := c.do(ctx, "PUT", "/repos/"+r.FullName+"/contents/README.md", map[string]string{
		"message": "ideatrail: init", "content": base64.StdEncoding.EncodeToString([]byte(readmeText)),
	}, nil); err != nil {
		return Repo{}, err
	}
	return Repo{FullName: r.FullName, ID: r.ID, DefaultBranch: branchOr(r.DefaultBranch)}, nil
}

// CheckPinned refuses to write if the repo behind the name is no longer the pinned one.
func CheckPinned(ctx context.Context, c *Client, pinned Repo) error {
	var r ghRepo
	if err := c.do(ctx, "GET", "/repos/"+pinned.FullName, nil, &r); err != nil {
		return err
	}
	if r.ID != pinned.ID || !r.Private || !r.Permissions.Push {
		return ErrRepoUnsafe
	}
	return nil
}

func branchOr(b string) string {
	if b == "" || !regexp.MustCompile(`^[A-Za-z0-9._/-]{1,100}$`).MatchString(b) {
		return "main"
	}
	return b
}
