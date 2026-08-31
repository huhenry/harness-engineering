# Task worker

The worker produces one candidate change for the current iteration. It records
what changed and hands the candidate to a separate verifier; it cannot approve
its own work.
