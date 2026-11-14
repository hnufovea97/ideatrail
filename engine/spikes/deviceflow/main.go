package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// 출입증은 저장소 밖 임시 폴더에만 둔다. 값은 절대 출력하지 않는다.
var tokenPath = filepath.Join(os.TempDir(), "ideatrail-spike-token")

// Windows용 빌드에서 -ldflags "-X main.defaultClientID=..."로 넣는다 (client_id는 비밀 아님).
var defaultClientID string

func clientID() string {
	if v := os.Getenv("GH_APP_CLIENT_ID"); v != "" {
		return v
	}
	return defaultClientID
}

func post(u string, v url.Values, out any) error {
	req, _ := http.NewRequest("POST", u, strings.NewReader(v.Encode()))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return json.NewDecoder(resp.Body).Decode(out)
}

func copyAndOpen(code, link string) {
	switch runtime.GOOS {
	case "darwin":
		c := exec.Command("pbcopy")
		c.Stdin = strings.NewReader(code)
		c.Run()
		exec.Command("open", link).Run()
	case "windows":
		c := exec.Command("clip")
		c.Stdin = strings.NewReader(code)
		c.Run()
		exec.Command("rundll32", "url.dll,FileProtocolHandler", link).Run()
	}
}

func login() error {
	if clientID() == "" {
		return errors.New("GH_APP_CLIENT_ID가 비어 있음")
	}
	var dc struct {
		DeviceCode      string `json:"device_code"`
		UserCode        string `json:"user_code"`
		VerificationURI string `json:"verification_uri"`
		Interval        int    `json:"interval"`
	}
	if err := post("https://github.com/login/device/code", url.Values{"client_id": {clientID()}}, &dc); err != nil {
		return err
	}
	fmt.Println("코드(클립보드에 복사됨):", dc.UserCode)
	copyAndOpen(dc.UserCode, dc.VerificationURI)
	for {
		time.Sleep(time.Duration(dc.Interval+1) * time.Second)
		var tok map[string]any
		if err := post("https://github.com/login/oauth/access_token", url.Values{
			"client_id": {clientID()}, "device_code": {dc.DeviceCode},
			"grant_type": {"urn:ietf:params:oauth:grant-type:device_code"}}, &tok); err != nil {
			return err
		}
		switch tok["error"] {
		case "authorization_pending":
			continue
		case "slow_down":
			dc.Interval += 5
			continue
		case nil:
		default:
			return fmt.Errorf("승인 실패: %v", tok["error"])
		}
		at, ok := tok["access_token"].(string)
		if !ok || at == "" {
			return errors.New("응답에 토큰 없음")
		}
		if err := os.WriteFile(tokenPath, []byte(at), 0o600); err != nil {
			return err
		}
		_, hasExp := tok["expires_in"]
		fmt.Println("토큰 받음: true / 만료 있음:", hasExp, "/ 저장 위치:", tokenPath)
		return nil // 토큰 값은 출력하지 않는다
	}
}

// api는 저장된 토큰으로 GitHub REST를 부른다. 오류에는 상태 코드와 응답 본문만 싣는다(토큰 없음).
func api(method, path string, body, out any) (int, error) {
	tok, err := os.ReadFile(tokenPath)
	if err != nil {
		return 0, fmt.Errorf("먼저 login 하세요: %w", err)
	}
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, err
		}
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, "https://api.github.com"+path, rd)
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(string(tok)))
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return resp.StatusCode, fmt.Errorf("%s %s → %d %s", method, path, resp.StatusCode, b)
	}
	if out != nil {
		return resp.StatusCode, json.Unmarshal(b, out)
	}
	return resp.StatusCode, nil
}

// createRepo: ① 엔진이 비공개 저장소를 만들 수 있나 ③ 설치된 저장소 목록을 찾을 수 있나
func createRepo(name string) error {
	var r struct {
		FullName string `json:"full_name"`
	}
	if _, err := api("POST", "/user/repos", map[string]any{"name": name, "private": true, "auto_init": true}, &r); err != nil {
		fmt.Println("① 만들기 실패:", err)
	} else {
		fmt.Println("① 만들기 성공:", r.FullName)
	}
	var inst struct {
		Installations []struct {
			ID int64 `json:"id"`
		} `json:"installations"`
	}
	if _, err := api("GET", "/user/installations", nil, &inst); err != nil {
		return err
	}
	for _, in := range inst.Installations {
		var rs struct {
			Repositories []struct {
				FullName string `json:"full_name"`
			} `json:"repositories"`
		}
		if _, err := api("GET", fmt.Sprintf("/user/installations/%d/repositories", in.ID), nil, &rs); err != nil {
			return err
		}
		for _, x := range rs.Repositories {
			fmt.Println("③ 설치", in.ID, "에 포함:", x.FullName)
		}
	}
	return nil
}

var errBehind = errors.New("앞서 바뀜(fast-forward 아님)")

// commitOnce: blob 3개 → tree → commit → ref 갱신(force 없음)을 한 번 시도한다.
func commitOnce(repo, label string) error {
	var ref struct {
		Object struct {
			SHA string `json:"sha"`
		} `json:"object"`
	}
	if _, err := api("GET", "/repos/"+repo+"/git/ref/heads/main", nil, &ref); err != nil {
		return err
	}
	var parent struct {
		Tree struct {
			SHA string `json:"sha"`
		} `json:"tree"`
	}
	if _, err := api("GET", "/repos/"+repo+"/git/commits/"+ref.Object.SHA, nil, &parent); err != nil {
		return err
	}
	var tree []map[string]string
	for i := 1; i <= 3; i++ {
		var blob struct {
			SHA string `json:"sha"`
		}
		if _, err := api("POST", "/repos/"+repo+"/git/blobs", map[string]string{"content": fmt.Sprintf("%s %d\n", label, i), "encoding": "utf-8"}, &blob); err != nil {
			return err
		}
		tree = append(tree, map[string]string{"path": fmt.Sprintf("spike/%s-%d.txt", label, i), "mode": "100644", "type": "blob", "sha": blob.SHA})
	}
	var t, c struct {
		SHA string `json:"sha"`
	}
	if _, err := api("POST", "/repos/"+repo+"/git/trees", map[string]any{"base_tree": parent.Tree.SHA, "tree": tree}, &t); err != nil {
		return err
	}
	if _, err := api("POST", "/repos/"+repo+"/git/commits", map[string]any{"message": "spike " + label, "tree": t.SHA, "parents": []string{ref.Object.SHA}}, &c); err != nil {
		return err
	}
	code, err := api("PATCH", "/repos/"+repo+"/git/refs/heads/main", map[string]any{"sha": c.SHA, "force": false}, nil)
	if code == http.StatusUnprocessableEntity {
		return errBehind
	}
	return err
}

// batchCommit: 두 묶음 커밋을 동시에 시도 → 하나는 "앞서 바뀜"을 받고 다시 시도해 성공해야 한다(§3.1.10 F).
func batchCommit(repo string) {
	var wg sync.WaitGroup
	for _, label := range []string{"A", "B"} {
		wg.Add(1)
		go func(label string) {
			defer wg.Done()
			for try := 1; try <= 5; try++ {
				err := commitOnce(repo, label)
				fmt.Printf("%s 시도 %d: %v\n", label, try, err)
				if !errors.Is(err, errBehind) {
					return
				}
			}
		}(label)
	}
	wg.Wait()
}

func main() {
	cmd := "login"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	var err error
	switch cmd {
	case "login":
		err = login()
	case "create-repo":
		name := "ideatrail-spike"
		if len(os.Args) > 2 {
			name = os.Args[2]
		}
		err = createRepo(name)
	case "batch-commit":
		if len(os.Args) < 3 {
			err = errors.New("사용법: batch-commit <owner>/<repo>")
		} else {
			batchCommit(os.Args[2])
		}
	case "cleanup":
		err = os.Remove(tokenPath)
	default:
		err = fmt.Errorf("모르는 명령: %s", cmd)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "오류:", err)
		os.Exit(1)
	}
}
