/**
 * Shipment number helpers.
 *
 * Some environments still generate legacy SHP-###### numbers even for outbound shipments.
 * The desired format for new outbound shipments is OUT-#####.
 */

/**
 * If a shipment_number is a legacy SHP numeric code, return an OUT-##### version.
 * Otherwise returns null (no change required).
 */
export function coerceOutboundShipmentNumber(
  shipmentNumber: string | null | undefined
): string | null {
  const raw = String(shipmentNumber || '').trim().toUpperCase();
  const match = raw.match(/^SHP-(\d{5,})$/);
  if (!match) return null;

  const digits = match[1];
  // Desired format is usually OUT-#####. However legacy SHP numbers are LPAD'd to 6 digits,
  // and truncating to 5 can collide once the sequence exceeds 99999. Preserve 6+ digits
  // once they become significant; otherwise drop only a leading zero.
  const outDigits = digits.length > 5 && digits[0] !== '0' ? digits : digits.slice(-5);
  return `OUT-${outDigits}`;
}

