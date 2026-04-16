import type { EntityType } from '@/config/entities';

export type UnifiedNoteType = 'internal' | 'public' | 'exception';

export type UnifiedNoteEntityType =
  | 'shipment'
  | 'task'
  | 'item'
  | 'claim'
  | 'quote'
  | 'stocktake'
  | 'repair_quote';

interface UnifiedEntityMeta {
  label: string;
  linkType?: EntityType;
}

export const UNIFIED_NOTE_ENTITY_META: Record<UnifiedNoteEntityType, UnifiedEntityMeta> = {
  shipment: { label: 'Shipment', linkType: 'shipment' },
  task: { label: 'Task', linkType: 'task' },
  item: { label: 'Item', linkType: 'item' },
  claim: { label: 'Claim', linkType: 'claim' },
  quote: { label: 'Quote', linkType: 'quote' },
  stocktake: { label: 'Stocktake', linkType: 'stocktake' },
  repair_quote: { label: 'Repair Quote', linkType: 'repair_quote' },
};

export function getUnifiedEntityLabel(entityType: string): string {
  const typed = entityType as UnifiedNoteEntityType;
  return UNIFIED_NOTE_ENTITY_META[typed]?.label || entityType;
}

export function buildUnifiedEntityRoute(
  entityType: string,
  entityId: string,
  entityNumber?: string | null
): string {
  if (entityType === 'item') {
    return `/inventory/${entityId}`;
  }

  if (entityType === 'shipment') {
    const prefix = (entityNumber || '').toUpperCase().split('-')[0];
    if (prefix === 'MAN') return `/incoming/manifest/${entityId}`;
    if (prefix === 'EXP') return `/incoming/expected/${entityId}`;
    if (prefix === 'INT') return `/incoming/dock-intake/${entityId}`;
    return `/shipments/${entityId}`;
  }

  if (entityType === 'task') return `/tasks/${entityId}`;
  if (entityType === 'claim') return `/claims/${entityId}`;
  if (entityType === 'quote') return `/quotes/${entityId}`;
  if (entityType === 'stocktake') return `/stocktakes/${entityId}`;
  if (entityType === 'repair_quote') return `/repair-quotes/${entityId}`;
  return '';
}

