const SKIP_WORDS = ['the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'per'];

export function generateServiceCode(name: string): string {
  if (!name.trim()) return '';
  const words = name.trim().split(/\s+/).filter(w => !SKIP_WORDS.includes(w.toLowerCase())).map(w => w.toUpperCase());
  if (words.length === 0) return name.substring(0, 5).toUpperCase();
  if (words.length === 1) return words[0].substring(0, 5);
  return words.map((w, i) => i === words.length - 1 ? w.substring(0, 4) : w.substring(0, 2)).join('').substring(0, 8);
}
