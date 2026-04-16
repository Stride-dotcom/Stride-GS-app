/**
 * Environment variable helpers with blank-string rejection.
 */

/** Returns the env var value or undefined if missing or blank. */
export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return undefined;
  return value;
}

/** Returns the env var value or throws if missing or blank. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Required environment variable ${name} is missing or blank`);
  }
  return value;
}
