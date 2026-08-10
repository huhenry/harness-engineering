import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCli, resolveRepoPath, CliError } from '../scripts/lib/cli.mjs';

const SPEC = {
  options: {
    json: { type: 'boolean', default: false },
    lang: { type: 'string' },
    'min-level': { type: 'string' },
  },
  allowPositional: true,
};

test('parses boolean flag and positional', () => {
  const { values, positionals } = parseCli(['/tmp/repo', '--json'], SPEC);
  assert.equal(values.json, true);
  assert.deepEqual(positionals, ['/tmp/repo']);
});

test('applies declared defaults', () => {
  const { values } = parseCli([], SPEC);
  assert.equal(values.json, false);
  assert.equal(values.lang, undefined);
});

test('unknown flag throws CliError with exitCode 2', () => {
  assert.throws(
    () => parseCli(['--nope'], SPEC),
    (err) => err instanceof CliError && err.exitCode === 2,
  );
});

test('resolveRepoPath defaults to cwd and returns absolute path', () => {
  assert.equal(resolveRepoPath([], '/home/x'), '/home/x');
  assert.equal(resolveRepoPath(['sub'], '/home/x'), '/home/x/sub');
  assert.equal(resolveRepoPath(['/abs'], '/home/x'), '/abs');
});
