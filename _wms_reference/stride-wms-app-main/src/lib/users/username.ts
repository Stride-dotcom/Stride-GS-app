const USERNAME_REGEX = /^[a-z0-9_]{3,32}$/;

export function normalizeUsernameInput(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized.slice(0, 32);
}

export function isUsernameFormatValid(value: string): boolean {
  return USERNAME_REGEX.test(value);
}

export const USERNAME_FORMAT_HINT =
  'Use 3-32 characters: lowercase letters, numbers, and underscores.';
