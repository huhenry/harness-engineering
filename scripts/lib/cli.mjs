import { parseArgs } from 'node:util';
import { isAbsolute, resolve } from 'node:path';

export class CliError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CliError';
    this.exitCode = 2;
  }
}

/**
 * Thin wrapper over node:util parseArgs that converts usage errors into
 * CliError so every entry script can exit with code 2 uniformly.
 */
export function parseCli(argv, spec) {
  try {
    return parseArgs({
      args: argv,
      options: spec.options,
      allowPositionals: spec.allowPositional ?? false,
      strict: true,
    });
  } catch (err) {
    throw new CliError(err.message);
  }
}

/** Resolve the target repository path from positionals, defaulting to cwd. */
export function resolveRepoPath(positionals, cwd) {
  const first = positionals[0];
  if (!first) return cwd;
  return isAbsolute(first) ? first : resolve(cwd, first);
}
