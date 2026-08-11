package main

import "testing"

func TestHealthz(t *testing.T) {
	if healthz() != "ok" {
		t.Fatal("expected healthz() to return \"ok\"")
	}
}
