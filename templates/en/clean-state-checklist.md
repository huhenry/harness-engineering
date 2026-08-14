# Clean State Checklist

Walk this before ending a session -- every item should be true right now,
not just true "in general".

- [ ] `git status` shows nothing you did not mean to leave uncommitted.
- [ ] Every command declared in `harness.config.json`'s `verify` block
      exits 0 (or is still legitimately `null`, with a reason written
      somewhere a human can find it).
- [ ] `PROGRESS.md` reflects what actually happened this session, not what
      was planned at the start of it.
- [ ] `feature_list.json` statuses match reality.
- [ ] `session-handoff.md` says exactly what the next session should do
      first.
- [ ] No secret, credential, or `.env` file is staged for commit.
