import { parseScanPayload } from '@/lib/scan/parseScanPayload';

export function isLikelyLocationCode(input: string, locations: ReadonlyArray<{ code: string }>): boolean {
  const payload = parseScanPayload(input);
  if (!payload) return false;
  if (payload.type === 'location') return true;
  const codeToMatch = (payload.code || input).trim().toLowerCase();
  if (!codeToMatch) return false;
  return locations.some((l) => l.code.toLowerCase() === codeToMatch);
}

