export interface BillingEventForBuilder {
  id: string;
  account_id: string;
  account_name: string;
  account_code: string;
  sidemark_id: string | null;
  sidemark_name: string | null;
  charge_type: string;
  description: string | null;
  quantity: number;
  unit_rate: number;
  total_amount: number;
  occurred_at: string;
  item_id: string | null;
  item_code: string | null;
}

export interface InvoicePreview {
  id: string;
  groupKey: string;
  accountId: string;
  accountName: string;
  accountCode: string;
  sidemarkId: string | null;
  sidemarkName: string | null;
  chargeTypes: string[];
  billingEventIds: string[];
  lineItems: PreviewLineItem[];
  subtotal: number;
  periodStart: string;
  periodEnd: string;
  notes: string;
}

export interface PreviewLineItem {
  billingEventId: string;
  occurredAt: string;
  chargeType: string;
  description: string | null;
  quantity: number;
  unitRate: number;
  totalAmount: number;
  itemCode: string | null;
  sidemarkName: string | null;
}

export interface GroupByOptions {
  account: boolean;
  sidemark: boolean;
  chargeType: boolean;
}

export interface CreationResult {
  success: number;
  failed: number;
  invoiceIds: string[];
  batchId: string;
}

export interface InvoiceBuilderSummary {
  eventCount: number;
  total: number;
  accountCount: number;
  dateRange: {
    start: string;
    end: string;
  };
}

export interface PreviewCounts {
  byAccount: number;
  bySidemark: number;
  byChargeType: number;
  custom: number;
}
