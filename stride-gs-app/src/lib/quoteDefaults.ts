import type {
  ClassDef, ServiceDef, TaxArea, CoverageOption, QuoteStoreSettings,
} from './quoteTypes';

export const DEFAULT_CLASSES: ClassDef[] = [
  { id: 'XS',  name: 'Extra Small',  order: 1, active: true },
  { id: 'S',   name: 'Small',        order: 2, active: true },
  { id: 'M',   name: 'Medium',       order: 3, active: true },
  { id: 'L',   name: 'Large',        order: 4, active: true },
  { id: 'XL',  name: 'Extra Large',  order: 5, active: true },
  { id: 'XXL', name: 'XX-Large',     order: 6, active: true },
];

let _order = 0;
function svc(
  id: string, code: string, name: string, category: ServiceDef['category'],
  unit: ServiceDef['unit'], billing: ServiceDef['billing'],
  opts: Partial<Pick<ServiceDef, 'isStorage' | 'taxable' | 'flatRate' | 'showInMatrix' | 'active'>> & { rates?: Partial<ServiceDef['rates']> }
): ServiceDef {
  _order++;
  return {
    id, code, name, category, unit, billing,
    isStorage: opts.isStorage ?? false,
    taxable: opts.taxable ?? true,
    active: opts.active ?? true,
    flatRate: opts.flatRate ?? 0,
    rates: { XS: 0, S: 0, M: 0, L: 0, XL: 0, XXL: 0, ...opts.rates },
    showInMatrix: opts.showInMatrix ?? false,
    matrixOrder: opts.showInMatrix ? _order : 999,
  };
}

export const DEFAULT_SERVICES: ServiceDef[] = [
  // Class-based matrix services
  svc('RCVG', 'RCVG', 'Receiving', 'Warehouse', 'per_item', 'class_based',
    { showInMatrix: true, rates: { XS: 10, S: 10, M: 15, L: 15, XL: 20 } }),
  svc('INSP', 'INSP', 'Inspection', 'Warehouse', 'per_item', 'class_based',
    { showInMatrix: true, rates: { XS: 15, S: 35, M: 35, L: 55, XL: 65 } }),
  svc('Pull_Prep', 'PICK', 'Pull Prep', 'Warehouse', 'per_item', 'class_based',
    { showInMatrix: true, rates: { XS: 2, S: 3, M: 5, L: 6.98, XL: 9 } }),
  svc('Returns', 'RSTK', 'Returns Processing', 'Warehouse', 'per_item', 'class_based',
    { showInMatrix: true, rates: { XS: 10, S: 10, M: 15, L: 15, XL: 20 } }),

  // Storage services (per-day, class-based)
  svc('STRG_DAY', 'STOR', 'Daily Storage', 'Storage', 'per_day', 'class_based',
    { isStorage: true, rates: { XS: 0.20, S: 0.60, M: 1.80, L: 3.00, XL: 4.00 } }),
  svc('Short_Storage', 'SSTOR', 'Short-Term Storage', 'Storage', 'per_day', 'class_based',
    { isStorage: true, rates: { XS: 0.50, S: 1.50, M: 4.50, L: 7.50, XL: 10.00 } }),

  // Flat-rate services
  svc('60MA', '60MA', 'Assembly (60 min)', 'Assembly', 'per_task', 'flat',
    { flatRate: 140 }),
  svc('1HRO', '1HRO', 'Onsite Assembly (1 hr)', 'Assembly', 'per_task', 'flat',
    { flatRate: 175 }),
  svc('Climate_Control', 'CLMT', 'Climate Control', 'Warehouse', 'per_item', 'flat',
    { flatRate: 25 }),
  svc('LABOR', 'LABOR', 'Warehouse Labor', 'Labor', 'per_hour', 'flat',
    { flatRate: 75 }),
  svc('Wrap', 'WRAP', 'Protective Wrapping', 'Warehouse', 'per_item', 'flat',
    { flatRate: 15 }),
  svc('Stocktake', 'STCK', 'Stocktake / Inventory Count', 'Admin', 'per_item', 'flat',
    { flatRate: 2 }),
  svc('Disposal', 'DISP', 'Disposal', 'Warehouse', 'per_item', 'flat',
    { flatRate: 25 }),
  svc('Relabeling', 'LABEL', 'Relabeling', 'Warehouse', 'per_item', 'flat',
    { flatRate: 5 }),
  svc('Palletize', 'PLLT', 'Palletize', 'Shipping', 'per_item', 'flat',
    { flatRate: 35 }),
  svc('Crating', 'CRATE', 'Custom Crating', 'Shipping', 'per_item', 'flat',
    { flatRate: 150 }),
  svc('Blanket_Wrap', 'BLNK', 'Blanket Wrap Delivery', 'Shipping', 'per_task', 'flat',
    { flatRate: 250 }),
  svc('White_Glove', 'WGLV', 'White Glove Delivery', 'Shipping', 'per_task', 'flat',
    { flatRate: 450 }),
  svc('Photo_Doc', 'PHOTO', 'Photo Documentation', 'Admin', 'per_item', 'flat',
    { flatRate: 3 }),
  svc('MinorTouchUp', 'MNRTU', 'Minor Touch-Up', 'Repair', 'per_item', 'flat',
    { flatRate: 85 }),
  svc('Repair_Flat', 'REPAIR', 'Repair (Flat Rate)', 'Repair', 'per_task', 'flat',
    { flatRate: 125 }),
  svc('Furniture_Medic', 'FMED', 'Furniture Medic Repair', 'Repair', 'per_task', 'flat',
    { flatRate: 200 }),
  svc('SIT_Test', 'SIT', 'Sit Test', 'Warehouse', 'per_item', 'flat',
    { flatRate: 15 }),
  svc('Rush_Fee', 'RUSH', 'Rush Processing Fee', 'Admin', 'per_task', 'flat',
    { flatRate: 50 }),
  svc('After_Hours', 'AFHR', 'After-Hours Access', 'Admin', 'per_hour', 'flat',
    { flatRate: 95 }),
  svc('Appointment_Fee', 'APPT', 'Scheduled Appointment', 'Admin', 'per_task', 'flat',
    { flatRate: 35 }),
  svc('Stairs_Fee', 'STRS', 'Stairs / Difficult Access', 'Shipping', 'per_task', 'flat',
    { flatRate: 75 }),
  svc('LongCarry', 'LCRY', 'Long Carry Fee', 'Shipping', 'per_task', 'flat',
    { flatRate: 50 }),
  svc('Debris_Removal', 'DBRS', 'Debris Removal', 'Warehouse', 'per_task', 'flat',
    { flatRate: 45 }),
  svc('Insurance_Surcharge', 'INSR', 'Insurance Surcharge', 'Admin', 'per_task', 'flat',
    { flatRate: 0, taxable: false }),
  svc('WillCall', 'WC', 'Will Call Release', 'Warehouse', 'per_item', 'flat',
    { flatRate: 10 }),
];

export const DEFAULT_TAX_AREAS: TaxArea[] = [
  { id: 'kent',     name: 'Kent',     rate: 10.4 },
  { id: 'renton',   name: 'Renton',   rate: 10.3 },
  { id: 'seattle',  name: 'Seattle',  rate: 10.35 },
  { id: 'bellevue', name: 'Bellevue', rate: 10.3 },
  { id: 'tacoma',   name: 'Tacoma',   rate: 10.3 },
];

export const DEFAULT_COVERAGE_OPTIONS: CoverageOption[] = [
  { id: 'standard', name: 'Standard Valuation', description: '$0.60 per pound per article', method: 'per_lb', rate: 0.60, included: true },
  { id: 'fnd',      name: 'Full Value (New for New)', description: '2% of declared value', method: 'percent_declared', rate: 2, included: false },
  { id: 'fwd',      name: 'Full Value (w/ Depreciation)', description: '1.5% of declared value', method: 'percent_declared', rate: 1.5, included: false },
];

export const DEFAULT_SETTINGS: QuoteStoreSettings = {
  companyName: 'Stride Logistics',
  companyAddress: '625 Industry Dr, Tukwila, WA 98188',
  companyPhone: '(253) 200-1432',
  companyEmail: 'whse@stridenw.com',
  defaultExpirationDays: 30,
  defaultStorageMonths: 1,
  defaultTaxAreaId: 'kent',
  quotePrefix: 'EST',
  nextQuoteNumber: 1000,
};
