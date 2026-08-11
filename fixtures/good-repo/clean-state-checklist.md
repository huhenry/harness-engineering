# Clean State Checklist

Run before ending a session:

- [ ] `git status` is clean (no stray uncommitted files).
- [ ] `go test ./...` passes.
- [ ] `golangci-lint run` passes.
- [ ] PROGRESS.md reflects what actually happened this session.
- [ ] feature_list.json statuses are up to date.
