// Shared between feedback.mjs (the `feedback.no-ci` check) and loop.mjs (the
// scheduled-workflow rung-2 entry-point check): both need to recognize every
// real GitHub Actions workflow file, and GitHub Actions accepts both `.yml`
// and `.yaml` extensions for files under .github/workflows/. A single
// exported source here is what stops the two call sites from drifting apart
// the way PRUNE_DIRS/DEFAULT_IGNORE (scan.mjs), docker.runtimePins/manifest
// (stack.mjs), and CONTAINER_FILES (environment.mjs) all drifted before in
// this project — every one of those was a hand-synced copy that only got
// updated in one place.
export const CI_WORKFLOW_GLOBS = ['.github/workflows/*.yml', '.github/workflows/*.yaml'];
