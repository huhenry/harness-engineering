# Architecture

This service is a single Go binary exposing a small HTTP API backed by
PostgreSQL.

## Components

- `src/main.go` — HTTP entrypoint and route wiring.
- PostgreSQL 16 — primary datastore (see `init.sh` for local setup).

## Request flow

1. Client calls `/healthz`.
2. Handler returns `ok`.
