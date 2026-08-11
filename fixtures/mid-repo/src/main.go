package main

import (
	"fmt"
	"net/http"
)

func healthz() string {
	return "ok"
}

func main() {
	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, healthz())
	})
	http.ListenAndServe(":8080", nil)
}
