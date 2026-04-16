export type BuiltinItemExceptionFlag = {
  /** Stored code (used in item_flags.service_code and receiving shipment_items.flags). */
  code: string;
  label: string;
  description: string;
  /** Optional Material Symbols icon name. */
  icon?: string;
};

/**
 * Built-in, non-removable item exception/condition flags.
 *
 * These are system-defined flags that should always exist even if a tenant has
 * zero Pricing -> Flags configured.
 */
export const BUILTIN_ITEM_EXCEPTION_FLAGS: BuiltinItemExceptionFlag[] = [
  {
    code: 'ITMEX_DAMAGE',
    label: 'Damage',
    description: 'Item is damaged or broken on arrival.',
    icon: 'warning',
  },
  {
    code: 'ITMEX_WET',
    label: 'Wet',
    description: 'Item is wet or shows water exposure.',
    icon: 'water_drop',
  },
  {
    code: 'ITMEX_MISSING_DOCS',
    label: 'Missing docs',
    description: 'Item arrived missing required documents or paperwork.',
    icon: 'description',
  },
  {
    code: 'ITMEX_CRUSHED_TORN',
    label: 'Crushed/Torn',
    description: 'Packaging is crushed, torn, or otherwise compromised.',
    icon: 'broken_image',
  },
  {
    code: 'ITMEX_OPEN',
    label: 'Open',
    description: 'Packaging is open / unsealed on arrival.',
    icon: 'inventory_2',
  },
  {
    code: 'ITMEX_OTHER',
    label: 'Other',
    description: 'Other item-level exception or condition.',
    icon: 'more_horiz',
  },
];

