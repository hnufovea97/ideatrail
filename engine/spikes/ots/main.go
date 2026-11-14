package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

var calendars = []string{
	"https://a.pool.opentimestamps.org",
	"https://b.pool.opentimestamps.org",
	"https://a.pool.eternitywall.com",
}

func main() {
	d := sha256.Sum256([]byte(fmt.Sprintf("ideatrail spike %d", time.Now().UnixNano())))
	fmt.Printf("digest %x\n", d)
	// 몇 시간 뒤 확정본을 받으러 올 때 쓸 값 (.gitignore 대상)
	if err := os.WriteFile("digest.hex", []byte(hex.EncodeToString(d[:])), 0o600); err != nil {
		fmt.Println("digest.hex 저장 실패:", err)
		os.Exit(1)
	}
	ok := 0
	for _, c := range calendars {
		resp, err := http.Post(c+"/digest", "application/octet-stream", bytes.NewReader(d[:]))
		if err != nil {
			fmt.Println(c, "ERR", err)
			continue
		}
		b, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		fmt.Println(c, resp.StatusCode, len(b), "bytes")
		if resp.StatusCode == 200 {
			ok++
			if err := os.WriteFile(fmt.Sprintf("pending-%d.bin", ok), b, 0o600); err != nil {
				fmt.Println("영수증 저장 실패:", err)
			}
		}
	}
	fmt.Println("accepted by", ok, "calendars")
}
