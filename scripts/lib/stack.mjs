/**
 * Signature table used both for stack detection and for the Environment
 * scorer's lockfile / runtime-pin checks. Keep ids stable: they appear in
 * the machine-readable report.
 */
export const STACK_SIGNATURES = [
  { id: 'node', manifest: ['package.json'], lockfiles: ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock'], runtimePins: ['.nvmrc', '.node-version'] },
  { id: 'go', manifest: ['go.mod'], lockfiles: ['go.sum'], runtimePins: ['go.mod'] },
  // 'Pipfile' is included alongside the other Python manifests: a
  // Pipenv-only project (Pipfile + Pipfile.lock, no pyproject.toml /
  // requirements.txt / setup.py) would otherwise never be detected as
  // 'python' at all, which would make the declared Pipfile.lock lockfile
  // entry unreachable dead data for the Environment scorer.
  { id: 'python', manifest: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'], lockfiles: ['poetry.lock', 'uv.lock', 'Pipfile.lock', 'requirements.lock', 'pdm.lock'], runtimePins: ['.python-version', 'runtime.txt'] },
  { id: 'rust', manifest: ['Cargo.toml'], lockfiles: ['Cargo.lock'], runtimePins: ['rust-toolchain.toml', 'rust-toolchain'] },
  { id: 'flutter', manifest: ['pubspec.yaml'], lockfiles: ['pubspec.lock'], runtimePins: ['.fvmrc', '.tool-versions'] },
  { id: 'java', manifest: ['pom.xml', 'build.gradle', 'build.gradle.kts'], lockfiles: ['gradle.lockfile'], runtimePins: ['.java-version', '.sdkmanrc'] },
  { id: 'docker', manifest: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'], lockfiles: [], runtimePins: ['Dockerfile'] },
  // CMakeLists.txt deliberately excluded: CMake is used far more by plain
  // desktop/library C/C++ projects than by embedded ones, so its presence
  // carries almost no signal for this stack and would false-positive every
  // ordinary CMake repo as 'embedded' (and then get penalized by the
  // Environment scorer for missing platformio.ini/sdkconfig it never needed).
  { id: 'embedded', manifest: ['platformio.ini', 'sdkconfig'], lockfiles: ['dependencies.lock'], runtimePins: ['platformio.ini', 'sdkconfig'] },
];

/**
 * Detect which stacks a repository uses, based on manifest files at any
 * depth. `ctx.exists(f)` is tried first as a root-level fast path; only when
 * that misses does this fall back to a full-tree glob. `ScanContext.list`
 * memoizes the directory walk per context instance, so this fallback across
 * every signature's manifest names still walks the tree only once.
 */
export function detectStack(ctx) {
  const found = new Set();
  for (const sig of STACK_SIGNATURES) {
    const hit = sig.manifest.some((f) => ctx.exists(f) || ctx.list([`**/${f}`]).length > 0);
    if (hit) found.add(sig.id);
  }
  return [...found].sort();
}

/** Look up a stack signature by id, or null if unrecognized. */
export function signatureFor(id) {
  return STACK_SIGNATURES.find((s) => s.id === id) ?? null;
}
