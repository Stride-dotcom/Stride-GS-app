export interface ClassCubicFeetFields {
  min_cubic_feet: number | null;
  max_cubic_feet: number | null;
}

type PartialCubicFeet = Partial<ClassCubicFeetFields>;

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function asNullableNumber(n: unknown): number | null {
  return isFiniteNumber(n) ? n : null;
}

/**
 * Returns a single cubic-feet size value when the class represents a single size.
 *
 * - If both min/max exist and are equal → that value
 * - If only one side exists → null (legacy one-sided bounds aren't a single size)
 * - If both exist and differ → null (legacy "range" is ambiguous for a single size)
 */
export function getClassCubicFeetSingleValue(cls: PartialCubicFeet): number | null {
  const min = asNullableNumber(cls.min_cubic_feet);
  const max = asNullableNumber(cls.max_cubic_feet);

  if (min === null && max === null) return null;
  if (min !== null && max !== null) {
    return min === max ? min : null;
  }
  return null;
}

/**
 * Human-friendly label for display.
 * Examples:
 * - "12 cu ft" (single value)
 * - "10-20 cu ft" (legacy range)
 * - "12+ cu ft" (legacy lower-bound only)
 */
export function formatClassCubicFeetLabel(cls: PartialCubicFeet): string | null {
  const single = getClassCubicFeetSingleValue(cls);
  if (single !== null) return `${single} cu ft`;

  const min = asNullableNumber(cls.min_cubic_feet);
  const max = asNullableNumber(cls.max_cubic_feet);
  if (min !== null && max !== null) return `${min}-${max} cu ft`;
  if (min !== null) return `${min}+ cu ft`;
  if (max !== null) return `≤${max} cu ft`;
  return null;
}

/**
 * Export-friendly value for spreadsheets/CSV templates.
 * Prefers a number when the class is configured as a single value.
 * Falls back to a string for legacy ranges.
 */
export function getClassCubicFeetExportValue(cls: PartialCubicFeet): number | string | '' {
  const single = getClassCubicFeetSingleValue(cls);
  if (single !== null) return single;

  const min = asNullableNumber(cls.min_cubic_feet);
  const max = asNullableNumber(cls.max_cubic_feet);
  if (min !== null && max !== null) return `${min}-${max}`;
  if (min !== null) return `${min}+`;
  if (max !== null) return `<=${max}`;
  return '';
}

