# Timer Loop

A timer loop wakes on a schedule (a cron job, a CI scheduled workflow) and
does one bounded unit of work, rather than running continuously. Use this
for maintenance-shaped work with no single "done" state -- triage, sweeps,
periodic checks.

## Stop condition

- Each invocation stops after completing exactly one unit of work (one
  triage pass, one sweep), regardless of whether more work is queued -- the
  next scheduled run picks up where this one left off.
- <!-- FILL: what counts as "one unit" for this specific loop. -->

## Budget cap

- Max iterations per invocation: <!-- FILL, e.g. 1 -->.
- Wall-clock cap per invocation: <!-- FILL, e.g. 10 minutes -->.
- Schedule: <!-- FILL: the cron expression or trigger, e.g. every 6 hours -->.
- A run that hits its cap mid-task exits cleanly and leaves state (via
  `PROGRESS.md` or `feature_list.json`) for the next scheduled run to
  resume from, instead of leaving something half-done and unrecorded.
