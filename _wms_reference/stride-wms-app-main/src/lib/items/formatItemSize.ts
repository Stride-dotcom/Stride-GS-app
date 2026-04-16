function formatSizeUnit(unit: string | null | undefined): string {
  if (!unit) return '';
  switch (unit) {
    case 'cu_ft':
      return 'ft³';
    case 'sq_ft':
      return 'ft²';
    case 'inches':
      return 'in';
    case 'feet':
      return 'ft';
    default:
      return String(unit).replace(/_/g, ' ');
  }
}

function formatSizeNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (Number.isInteger(n)) return String(n);
  // Keep it readable, avoid trailing zeros.
  return String(parseFloat(n.toFixed(2)));
}

export function formatItemSize(size: number | null | undefined, unit: string | null | undefined): string {
  if (size === null || size === undefined) return '-';
  const n = Number(size);
  if (!Number.isFinite(n)) return '-';

  const num = formatSizeNumber(n);
  const u = formatSizeUnit(unit);
  return u ? `${num} ${u}` : num;
}

