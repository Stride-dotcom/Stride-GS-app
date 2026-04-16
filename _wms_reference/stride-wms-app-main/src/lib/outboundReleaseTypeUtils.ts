/**
 * release_type is a legacy field still used by some validation/billing logic.
 *
 * Outbound Type (outbound_types) is the "current" system for classifying outbound shipments.
 * We derive the legacy release_type from outbound_types.name so users don't have to pick both.
 */

export type LegacyOutboundReleaseType = 'will_call' | 'disposal' | 'return';

export function deriveLegacyReleaseTypeFromOutboundTypeName(
  outboundTypeName: string | null | undefined
): LegacyOutboundReleaseType {
  const name = String(outboundTypeName || '').trim().toLowerCase();

  if (name.includes('disposal')) return 'disposal';
  if (name.includes('return')) return 'return';

  // Default (most common outbound flow)
  return 'will_call';
}

