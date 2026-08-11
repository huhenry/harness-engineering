# Demo API Service

A small Go HTTP service used to exercise the harness scoring rubric. It
exposes a single `/healthz` endpoint.

Stack: Go 1.23 / PostgreSQL 16.

## Setup

```bash
./init.sh
```

Run `make test` to run the test suite, and `make lint` to lint the code
before committing.

## Constraints

Never deploy from a local branch. Never commit secrets or `.env` files to
the repository.

## Verification

```bash
go test ./...
```
