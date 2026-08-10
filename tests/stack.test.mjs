import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectStack, STACK_SIGNATURES, signatureFor } from '../scripts/lib/stack.mjs';
import { createScanContext } from '../scripts/lib/scan.mjs';

function fakeCtx(files) {
  const set = new Set(files);
  return {
    root: '/fake',
    exists: (rel) => set.has(rel),
    read: () => null,
    readJson: () => null,
    list: (patterns) => [...set].filter((f) => patterns.some((p) => f.endsWith(p.replace('**/', '')))).sort(),
    mtime: () => null,
    gitLastCommit: () => null,
  };
}

test('detects a single stack', () => {
  assert.deepEqual(detectStack(fakeCtx(['go.mod'])), ['go']);
});

test('detects multiple stacks sorted and deduped', () => {
  const ctx = fakeCtx(['go.mod', 'package.json', 'Dockerfile']);
  assert.deepEqual(detectStack(ctx), ['docker', 'go', 'node']);
});

test('returns empty array when nothing recognizable', () => {
  assert.deepEqual(detectStack(fakeCtx(['README.md'])), []);
});

test('every signature declares manifest, lockfiles and runtimePins', () => {
  for (const sig of STACK_SIGNATURES) {
    assert.ok(sig.id, 'id required');
    assert.ok(Array.isArray(sig.manifest) && sig.manifest.length > 0, `${sig.id} manifest`);
    assert.ok(Array.isArray(sig.lockfiles), `${sig.id} lockfiles`);
    assert.ok(Array.isArray(sig.runtimePins), `${sig.id} runtimePins`);
  }
});

// --- Self-review: behavior against a *real* createScanContext, not the fake ---

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'harness-stack-'));
  writeFileSync(join(root, 'package.json'), '{"name":"x"}');
  writeFileSync(join(root, 'package-lock.json'), '{}');
  mkdirSync(join(root, 'services', 'api'), { recursive: true });
  writeFileSync(join(root, 'services', 'api', 'go.mod'), 'module x\n\ngo 1.21\n');
  return root;
}

test('real ScanContext: detects root-level manifest and a manifest nested in a subdirectory', () => {
  const ctx = createScanContext(makeRepo());
  assert.deepEqual(detectStack(ctx), ['go', 'node']);
});

test('real ScanContext: a manifest only in a subdirectory (services/api/go.mod) is still detected', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-stack-nested-'));
  mkdirSync(join(root, 'services', 'api'), { recursive: true });
  writeFileSync(join(root, 'services', 'api', 'go.mod'), 'module x\n\ngo 1.21\n');
  const ctx = createScanContext(root);
  // Deliberate: the brief's contract is "manifest files at any depth", so a
  // buried manifest in one subdirectory of an otherwise-unrelated repo marks
  // the whole repo as that stack. See report for the tradeoff this implies.
  assert.deepEqual(detectStack(ctx), ['go']);
});

test('real ScanContext: no recognizable manifest returns [], not undefined or a throw', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-stack-empty-'));
  writeFileSync(join(root, 'README.md'), '# hi\n');
  const ctx = createScanContext(root);
  assert.deepEqual(detectStack(ctx), []);
});

test('real ScanContext: ignored directories (node_modules) do not trigger a false positive', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-stack-ignored-'));
  mkdirSync(join(root, 'node_modules', 'some-dep'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'some-dep', 'go.mod'), 'module dep\n');
  writeFileSync(join(root, 'README.md'), '# hi\n');
  const ctx = createScanContext(root);
  assert.deepEqual(detectStack(ctx), []);
});

test('real ScanContext: detectStack output is sorted and identical across repeated calls', () => {
  const ctx = createScanContext(makeRepo());
  const first = detectStack(ctx);
  const second = detectStack(ctx);
  assert.deepEqual(first, second);
  assert.deepEqual(first, [...first].sort());
});

test('signatureFor returns the matching signature', () => {
  const sig = signatureFor('node');
  assert.equal(sig.id, 'node');
  assert.ok(sig.manifest.includes('package.json'));
});

test('signatureFor returns null for an unknown id rather than throwing', () => {
  assert.equal(signatureFor('nope'), null);
});

// --- Review fix: CMakeLists.txt alone must not be mistaken for 'embedded' ---

test('real ScanContext: a plain CMake C++ project (no platformio.ini/sdkconfig) is not classified embedded', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-stack-cmake-'));
  writeFileSync(join(root, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.20)\nproject(x)\n');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'main.cpp'), 'int main() { return 0; }\n');
  const ctx = createScanContext(root);
  assert.deepEqual(detectStack(ctx), []);
});

test('real ScanContext: a platformio.ini project is still detected as embedded', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-stack-platformio-'));
  writeFileSync(join(root, 'platformio.ini'), '[env:esp32dev]\nplatform = espressif32\n');
  const ctx = createScanContext(root);
  assert.deepEqual(detectStack(ctx), ['embedded']);
});

// --- Review fix: docker manifest must cover all Compose file name variants ---

test('real ScanContext: a repo with only compose.yml (no Dockerfile) is detected as docker', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-stack-compose-'));
  writeFileSync(join(root, 'compose.yml'), 'services:\n  app:\n    image: alpine\n');
  const ctx = createScanContext(root);
  assert.deepEqual(detectStack(ctx), ['docker']);
});

// --- Fix: docker.runtimePins must mirror docker.manifest, or a compose-only
// repo (detected as 'docker' via manifest) shows zero runtime-pin signal to
// every downstream consumer (the Environment scorer's rung-1 check) even
// though its compose file is exactly the artifact that pins its runtime.

test("docker signature's runtimePins mirrors its manifest — every compose filename plus Dockerfile", () => {
  const sig = signatureFor('docker');
  for (const f of ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    assert.ok(sig.runtimePins.includes(f), `docker.runtimePins missing ${f}`);
  }
  assert.deepEqual([...sig.runtimePins].sort(), [...sig.manifest].sort());
});
