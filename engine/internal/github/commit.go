package github

import (
	"context"
	"encoding/base64"
	"errors"
	"sort"
	"time"
)

const (
	maxRefRetries = 5
	maxRateWait   = 60 * time.Second
)

var ErrRateWaitTooLong = errors.New("github rate limit: try again later")

// CommitFiles writes files in one commit on the repo's branch (Git Data API, never forced).
// If existsPath is already in the branch head, nothing is committed (a retried queue item).
// A ref race ("not fast-forward") is retried from the new head, up to 5 times.
func CommitFiles(ctx context.Context, c *Client, repo Repo, files map[string][]byte, message, existsPath string, sleep func(context.Context, time.Duration) error) (string, error) {
	if sleep == nil {
		sleep = sleepCtx
	}
	for attempt := 0; attempt < maxRefRetries; attempt++ {
		sha, err := commitOnce(ctx, c, repo, files, message, existsPath)
		var rl *RateLimited
		var ge *Error
		switch {
		case err == nil:
			return sha, nil
		case errors.As(err, &rl):
			if rl.Wait > maxRateWait {
				return "", ErrRateWaitTooLong
			}
			if err := sleep(ctx, rl.Wait); err != nil {
				return "", err
			}
		case errors.As(err, &ge) && (ge.Status == 409 || ge.Status == 422):
			// head moved under us: start again from the new head
		default:
			return "", err
		}
	}
	return "", errors.New("github: branch kept moving")
}

var errAlreadyThere = errors.New("already committed")

func commitOnce(ctx context.Context, c *Client, repo Repo, files map[string][]byte, message, existsPath string) (string, error) {
	base := "/repos/" + repo.FullName
	var ref struct {
		Object struct {
			SHA string `json:"sha"`
		} `json:"object"`
	}
	if err := c.do(ctx, "GET", base+"/git/ref/heads/"+repo.DefaultBranch, nil, &ref); err != nil {
		return "", err
	}
	if existsPath != "" {
		err := c.do(ctx, "GET", base+"/contents/"+existsPath+"?ref="+ref.Object.SHA, nil, nil)
		var ge *Error
		if err == nil {
			return ref.Object.SHA, nil // already in the head: do not commit twice
		}
		if !errors.As(err, &ge) || ge.Status != 404 {
			return "", err
		}
	}
	var head struct {
		Tree struct {
			SHA string `json:"sha"`
		} `json:"tree"`
	}
	if err := c.do(ctx, "GET", base+"/git/commits/"+ref.Object.SHA, nil, &head); err != nil {
		return "", err
	}
	paths := make([]string, 0, len(files))
	for p := range files {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	tree := make([]map[string]string, 0, len(files))
	for _, p := range paths {
		var blob struct {
			SHA string `json:"sha"`
		}
		if err := c.do(ctx, "POST", base+"/git/blobs", map[string]string{"content": base64.StdEncoding.EncodeToString(files[p]), "encoding": "base64"}, &blob); err != nil {
			return "", err
		}
		tree = append(tree, map[string]string{"path": p, "mode": "100644", "type": "blob", "sha": blob.SHA})
	}
	var newTree struct {
		SHA string `json:"sha"`
	}
	if err := c.do(ctx, "POST", base+"/git/trees", map[string]any{"base_tree": head.Tree.SHA, "tree": tree}, &newTree); err != nil {
		return "", err
	}
	var commit struct {
		SHA string `json:"sha"`
	}
	if err := c.do(ctx, "POST", base+"/git/commits", map[string]any{"message": message, "tree": newTree.SHA, "parents": []string{ref.Object.SHA}}, &commit); err != nil {
		return "", err
	}
	if err := c.do(ctx, "PATCH", base+"/git/refs/heads/"+repo.DefaultBranch, map[string]any{"sha": commit.SHA, "force": false}, nil); err != nil {
		return "", err
	}
	return commit.SHA, nil
}
