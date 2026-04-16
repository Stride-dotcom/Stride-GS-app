export const RETURN_INTAKE_TYPE = 'return_intake';

export interface ReturnIntakeShipmentLike {
  shipment_type?: string | null;
  return_type?: string | null;
}

/**
 * Treat shipments as return-intake when they are explicit return shipments
 * or inbound shipments flagged as return-intake in Stage 1.
 */
export function isReturnIntakeShipment(
  shipment: ReturnIntakeShipmentLike | null | undefined
): boolean {
  if (!shipment) return false;
  return shipment.shipment_type === 'return' || shipment.return_type === RETURN_INTAKE_TYPE;
}
