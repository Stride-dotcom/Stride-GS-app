// Entity configuration for chatbot recognition and deep linking

export const ENTITY_CONFIG = {
  task: {
    prefix: 'TSK',
    pattern: /\b(TSK-\d{5})\b/gi,
    route: '/tasks',
    color: 'blue',
    icon: 'CheckSquare',
    label: 'Task',
  },
  shipment: {
    prefix: 'SHP',
    // Supports both current 5-digit sequence (e.g., INT-00042) and any legacy formats
    // that may still appear in logs (e.g., SHP-000001, SHP-2024-001).
    pattern: /\b((?:SHP|MAN|EXP|INT|OUT)-(?:\d{5,6}|\d{4}-\d{3}))\b/gi,
    route: '/shipments',
    color: 'green',
    icon: 'Truck',
    label: 'Shipment',
  },
  repair_quote: {
    prefix: 'RPQ',
    pattern: /\b(RPQ-\d{5})\b/gi,
    route: '/repair-quotes',
    color: 'orange',
    icon: 'Wrench',
    label: 'Repair Quote',
  },
  item: {
    prefix: 'ITM',
    // Current item_code format: ITM-###-#### (e.g., ITM-123-4567).
    // Keep legacy ITM-##### support for older references.
    pattern: /\b(ITM-(?:\d{3}-\d{4}|\d{5,7}))\b/gi,
    route: '/inventory',
    color: 'purple',
    icon: 'Package',
    label: 'Item',
  },
  quote: {
    prefix: 'EST',
    pattern: /\b(EST-\d{5})\b/gi,
    route: '/quotes',
    color: 'teal',
    icon: 'FileText',
    label: 'Quote',
  },
  claim: {
    prefix: 'CLM',
    // Current format commonly used in-app: CLM-123-4567
    pattern: /\b(CLM-(?:\d{3}-\d{4}|\d{5,8}))\b/gi,
    route: '/claims',
    color: 'rose',
    icon: 'ShieldAlert',
    label: 'Claim',
  },
  stocktake: {
    prefix: 'STK',
    pattern: /\b(STK-[A-Z0-9-]+)\b/gi,
    route: '/stocktakes',
    color: 'amber',
    icon: 'Clipboard',
    label: 'Stocktake',
  },
  invoice: {
    prefix: 'INV',
    // Supports both simple INV-00001 and account-coded INV-ACCT-00001 patterns.
    pattern: /\b(INV-(?:[A-Z0-9]{2,12}-)?\d{5})\b/gi,
    route: '/billing/invoices',
    color: 'emerald',
    icon: 'Receipt',
    label: 'Invoice',
  },
  account: {
    prefix: 'ACC',
    pattern: /\b(ACC-\d{5})\b/gi,
    route: '/accounts',
    color: 'indigo',
    icon: 'Building',
    label: 'Account',
  },
  work_order: {
    prefix: 'WRK',
    pattern: /\b(WRK-\d{5})\b/gi,
    route: '/work-orders',
    color: 'amber',
    icon: 'Clipboard',
    label: 'Work Order',
  },
} as const;

export type EntityType = keyof typeof ENTITY_CONFIG;

export interface EntityConfig {
  prefix: string;
  pattern: RegExp;
  route: string;
  color: string;
  icon: string;
  label: string;
}

// Additional prefixes that map to a canonical entity type.
// Expected (EXP-), Manifest (MAN-), Intake (INT-), and Outbound (OUT-) shipments
// all resolve to the "shipment" entity.
const SHIPMENT_ALIAS_PREFIXES = ['EXP', 'MAN', 'INT', 'OUT'];

// Get entity type from a number string (e.g., "TSK-00142" -> "task")
export function getEntityTypeFromNumber(number: string): EntityType | null {
  const upperNumber = number.toUpperCase();
  for (const [type, config] of Object.entries(ENTITY_CONFIG)) {
    if (upperNumber.startsWith(config.prefix + '-')) {
      return type as EntityType;
    }
  }
  // Check shipment alias prefixes (EXP-, MAN-, INT-, OUT-)
  for (const alias of SHIPMENT_ALIAS_PREFIXES) {
    if (upperNumber.startsWith(alias + '-')) {
      return 'shipment';
    }
  }
  return null;
}

// Extract all entity numbers from text
export function extractEntityNumbers(text: string): string[] {
  const numbers: string[] = [];
  for (const config of Object.values(ENTITY_CONFIG)) {
    // Reset pattern state
    config.pattern.lastIndex = 0;
    const matches = text.match(config.pattern);
    if (matches) {
      numbers.push(...matches.map((m) => m.toUpperCase()));
    }
  }
  return [...new Set(numbers)];
}
