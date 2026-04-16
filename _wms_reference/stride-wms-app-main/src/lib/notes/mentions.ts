const MENTION_REGEX = /(^|\s)@([a-zA-Z0-9_]{1,64})/g;

export function extractMentionUsernames(noteText: string): string[] {
  if (!noteText) return [];
  const names = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = MENTION_REGEX.exec(noteText)) !== null) {
    const username = (match[2] || '').toLowerCase().trim();
    if (username) names.add(username);
  }
  return Array.from(names);
}

export function getActiveMentionQuery(
  text: string,
  cursorIndex: number
): { query: string; replaceStart: number; replaceEnd: number } | null {
  if (!text) return null;
  const safeCursor = Math.max(0, Math.min(cursorIndex, text.length));
  const before = text.slice(0, safeCursor);
  const match = before.match(/(^|\s)@([a-zA-Z0-9_]*)$/);
  if (!match) return null;
  const query = (match[2] || '').toLowerCase();
  const tokenLength = query.length + 1; // include @
  const replaceEnd = safeCursor;
  const replaceStart = safeCursor - tokenLength;
  if (replaceStart < 0) return null;
  return { query, replaceStart, replaceEnd };
}

