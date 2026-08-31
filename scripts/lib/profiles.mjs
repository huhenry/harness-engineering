import { CliError } from './cli.mjs';

export const DEFAULT_PROFILE = 'repository';
export const SUPPORTED_PROFILES = ['repository', 'harness-distribution'];

/** Resolve the optional CLI/library value to one canonical profile id. */
export function assertProfile(raw) {
  const profile = raw ?? DEFAULT_PROFILE;
  if (!SUPPORTED_PROFILES.includes(profile)) {
    throw new CliError(
      `Invalid --profile '${profile}': expected one of ${SUPPORTED_PROFILES.join(', ')}.`,
    );
  }
  return profile;
}
