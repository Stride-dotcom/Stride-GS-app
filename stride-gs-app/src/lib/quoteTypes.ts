// Quote Tool — TypeScript types

export interface ClassDef {
  id: string;       // XS, S, M, L, XL
  name: string;     // Extra Small, Small, ...
  order: number;
  active: boolean;
}

export interface ServiceRate {
  XS: number;
  S: number;
  M: number;
  L: number;
  XL: number;
}

export type ServiceUnit = 'per_item' | 'per_day' | 'per_task' | 'per_hour';
export type ServiceBilling = 'class_based' | 'flat';
export type ServiceCategory = 'Warehouse' | 'Storage' | 'Shipping' | 'Assembly' | 'Repair' | 'Labor' | 'Admin';

export interface ServiceDef {
  id: string;
  code: string;
  name: string;
  category: ServiceCategory;
  unit: ServiceUnit;
  billing: ServiceBilling;
  isStorage: boolean;
  taxable: boolean;
  active: boolean;
  flatRate: number;
  rates: ServiceRate;
  showInMatrix: boolean;
  matrixOrder: number;
}

export interface TaxArea {
  id: string;
  name: string;
  rate: number; // e.g. 10.4 for 10.4%
}

export type CoverageMethod = 'per_lb' | 'percent_declared' | 'flat' | 'included';

export interface CoverageOption {
  id: string;
  name: string;
  description: string;
  method: CoverageMethod;
  rate: number;         // $/lb, percentage, or flat amount
  included: boolean;    // true = free (Standard Valuation)
}

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'void';

export interface ClassLine {
  classId: string;
  qty: number;
}

export interface MatrixCell {
  selected: boolean;
  qty: number;
}

export interface StorageCell {
  selected: boolean;
}

export interface OtherServiceEntry {
  selected: boolean;
  qty: number;
  rateOverride: number | null;
}

export interface QuoteDiscount {
  type: 'percent' | 'flat';
  value: number;
  reason: string;
}

export interface QuoteCoverage {
  typeId: string;
  declaredValue: number;
  weightLbs: number;
  costOverride: number | null;
}

export interface QuoteStorage {
  months: number;
  days: number;
}

export interface Quote {
  id: string;
  number: string;          // EST-1000, EST-1001, ...
  status: QuoteStatus;
  client: string;
  clientSheetId: string;   // linked client or empty for free-text
  project: string;
  address: string;
  date: string;            // ISO date
  expiration: string;      // ISO date
  ratesLocked: boolean;
  classLines: ClassLine[];
  matrixCells: Record<string, MatrixCell>;       // "classId:svcId"
  storageCells: Record<string, StorageCell>;     // "classId:svcId"
  storage: QuoteStorage;
  otherServices: Record<string, OtherServiceEntry>; // svcId
  discount: QuoteDiscount;
  taxEnabled: boolean;
  taxRate: number;
  taxAreaId: string;
  coverage: QuoteCoverage;
  customerNotes: string;
  internalNotes: string;
  createdAt: string;
  updatedAt: string;
}

// Calculator result types

export interface CalcLineItem {
  serviceId: string;
  serviceName: string;
  serviceCode: string;
  classId?: string;
  className?: string;
  qty: number;
  rate: number;
  amount: number;
  taxable: boolean;
  category: string;
}

export interface CalcResult {
  lineItems: CalcLineItem[];
  subtotal: number;
  taxableSubtotal: number;
  nonTaxableSubtotal: number;
  discountAmount: number;
  taxAmount: number;
  coverageCost: number;
  grandTotal: number;
}

// Store types

export interface QuoteCatalog {
  services: ServiceDef[];
  classes: ClassDef[];
  taxAreas: TaxArea[];
  coverageOptions: CoverageOption[];
}

export interface QuoteStoreSettings {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  defaultExpirationDays: number;
  defaultStorageMonths: number;
  defaultTaxAreaId: string;
  quotePrefix: string;
  nextQuoteNumber: number;
}
