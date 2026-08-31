import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROFILE,
  SUPPORTED_PROFILES,
  assertProfile,
} from '../scripts/lib/profiles.mjs';

test('repository is the default and supported profile ids have one source of truth', () => {
  assert.equal(DEFAULT_PROFILE, 'repository');
  assert.deepEqual(SUPPORTED_PROFILES, ['repository', 'harness-distribution']);
  assert.equal(assertProfile(undefined), DEFAULT_PROFILE);
  for (const profile of SUPPORTED_PROFILES) assert.equal(assertProfile(profile), profile);
});

test('an unknown profile is a usage error that names every accepted value', () => {
  assert.throws(
    () => assertProfile('unknown'),
    (err) => err?.exitCode === 2
      && /unknown/.test(err.message)
      && SUPPORTED_PROFILES.every((profile) => err.message.includes(profile)),
  );
});
