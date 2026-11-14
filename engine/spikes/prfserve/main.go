// prfserve: Windows PRF 시험용. prf.html을 내장해 http://localhost:8790/prf.html 로만 띄운다(외부 접속 불가).
package main

import (
	_ "embed"
	"fmt"
	"log"
	"net/http"
)

//go:embed prf.html
var page []byte

const addr = "127.0.0.1:8790"

func main() {
	http.HandleFunc("/prf.html", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(page)
	})
	fmt.Println("브라우저에서 열기: http://localhost:8790/prf.html  (끝내려면 이 창을 닫으세요)")
	log.Fatal(http.ListenAndServe(addr, nil))
}
