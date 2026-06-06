export interface Client {
  id: string;
  name: string;
  email: string;
  phone?: string;
  contactName?: string;
  activeItems: number;
  onHold: number;
}

export interface InventoryItem {
  /** Postgres UUID of the source inventory row — distinct from itemId
   *  (the human Stride code, which is NOT unique across tenants once an
   *  item is transferred). Carried so consumers can key/match on the
   *  unique row identity instead of the ambiguous itemId. Absent on the
   *  legacy GAS payload (only fetchInventoryFromSupabase populates it). */
  inventoryRowId?: string;
  itemId: string;
  clientId: string;
  clientName: string;
  vendor: string;
  description: string;
  itemClass: string; // e.g. "Sofa", "Chair", "Table"
  qty: number;
  location: string; // e.g. "A-01-02" (Aisle-Rack-Level)
  sidemark: string;
  status: InventoryStatus;
  shipmentNumber?: string;
  shipmentFolderUrl?: string;
  receiveDate: string; // ISO date
  releaseDate?: string; // ISO date
  room?: string;
  reference?: string;
  poNumber?: string;
  trackingNumber?: string;
  carrier?: string;
  notes?: string;
  itemNotes?: string;
  taskNotes?: string;
  itemFolderUrl?: string;
  shipmentPhotosUrl?: string;
  inspectionPhotosUrl?: string;
  repairPhotosUrl?: string;
  invoiceUrl?: string;
  transferDate?: string;
  condition?: string;
  dimensions?: string;
  weight?: number;
  images?: string[];
  declaredValue?: number;
  coverageOptionId?: string;
  // COD Storage (end customers pay storage). cod_storage flags an item so the
  // designer is billed storage only through codStorageStartDate - 1; remaining
  // days are collected from the end customer at delivery.
  codStorage?: boolean;
  codStorageStartDate?: string; // ISO date (YYYY-MM-DD) or ''
}

export type InventoryStatus = 'Active' | 'Released' | 'On Hold' | 'Transferred';

export interface Task {
  taskId: string;
  // Widened to `string` 2026-05-29: tasks can carry any service_catalog code
  // (FAB_RUG, FAB_SOFA, DISP, MULTI_INS, NO_ID, …), not just the legacy
  // ServiceCode union. The Tasks page and detail panel resolve the
  // human-readable label by joining to service_catalog.name.
  type: string;
  status: TaskStatus;
  itemId: string;
  clientId?: string;
  clientSheetId?: string;
  clientName: string;
  vendor?: string;
  description: string;
  location?: string;
  sidemark?: string;
  room?: string;
  reference?: string;
  itemClass?: string;
  carrier?: string;
  trackingNumber?: string;
  assignedTo?: string;
  created: string; // ISO date
  dueDate?: string; // ISO date YYYY-MM-DD
  priority?: 'High' | 'Normal';
  startedAt?: string; // ISO date
  completedAt?: string; // ISO date
  cancelledAt?: string; // ISO date
  result?: 'Pass' | 'Fail';
  itemNotes?: string;
  taskNotes?: string;
  // Widened 2026-05-29 — see `type` above.
  svcCode: string;
  billed: boolean;
  billedAmount?: number;
  customPrice?: number;
  /** Number of items this task covers — defaults to 1, editable via
   *  BillingPreviewCard's primary line. complete_task_atomic
   *  multiplies qty × rate when inserting the ledger row.
   *  Added 2026-05-21 with migration 20260521210000. */
  qty?: number;
  taskFolderUrl?: string;
  shipmentFolderUrl?: string;
  shipmentPhotosUrl?: string;
  inspectionPhotosUrl?: string;
  repairPhotosUrl?: string;
}

export type TaskType =
  | 'Receiving'
  | 'Inspection'
  | 'Assembly'
  | 'Repair'
  | 'Storage'
  | 'Delivery'
  | 'Will Call'
  | 'Split'
  | 'Other';

export type TaskStatus = 'Open' | 'In Progress' | 'Completed' | 'Cancelled';

export type ServiceCode =
  | 'RCVG'
  | 'INSP'
  | 'ASM'
  | 'REPAIR'
  | 'STOR'
  | 'DLVR'
  | 'WCPU'
  | 'SPLIT'
  | 'OTHER';

/** One line item on a repair quote. svcCode comes from the
 *  `service_catalog` table (filtered to Warehouse + Repair categories
 *  on the picker). taxable is snapshotted from the catalog at quote
 *  time so historical quotes' tax math is reproducible even after a
 *  catalog flag flip. */
export interface RepairQuoteLine {
  svcCode: string;
  svcName: string;
  qty: number;
  rate: number;
  taxable: boolean;
}

export interface Repair {
  repairId: string;
  sourceTaskId?: string;
  itemId: string;
  clientId: string;
  clientSheetId?: string;
  clientName: string;
  vendor?: string;
  description: string;
  status: RepairStatus;
  // quoteAmount stays as the PRE-TAX subtotal for back-compat — it
  // equals the sum of all quoteLines line totals once the multi-line
  // builder is in use. Legacy single-amount quotes have only this.
  quoteAmount?: number;
  approvedAmount?: number;
  // ─── multi-line repair quote (session 80+) ───────────────────────────
  // Set by the new RepairDetailPanel quote builder; persisted on the
  // Repairs sheet as Quote Lines JSON + the 6 totals columns.
  // Customer email shows tax-inclusive grandTotal in the hero.
  // On completion, one billing row is written per line, each pre-tax,
  // so QB applies its own sales tax without double-taxing.
  quoteLines?: RepairQuoteLine[];
  quoteSubtotal?: number;
  quoteTaxableSubtotal?: number;
  quoteTaxAreaId?: string;
  quoteTaxAreaName?: string;
  quoteTaxRate?: number;       // percent, e.g. 10.4
  quoteTaxAmount?: number;
  quoteGrandTotal?: number;
  repairVendor?: string;
  assignedTo?: string;
  createdDate: string; // ISO date
  quoteSentDate?: string; // ISO date
  approvedDate?: string; // ISO date
  completedDate?: string; // ISO date
  notes?: string;
  internalNotes?: string;
  room?: string;
  location?: string;        // Session 74: warehouse location — mirrored from inventory so the Repair panel can show it without a join
  sidemark?: string;        // Session 74: same rationale — was read by RepairDetailPanel but never declared on the type
  reference?: string;
  itemClass?: string;
  carrier?: string;
  trackingNumber?: string;
  repairFolderUrl?: string;
  taskFolderUrl?: string;
  shipmentFolderUrl?: string;
  shipmentPhotosUrl?: string;
  inspectionPhotosUrl?: string;
  repairPhotosUrl?: string;
}

export type RepairStatus =
  | 'Pending Quote'
  | 'Quote Sent'
  | 'Approved'
  | 'Declined'
  | 'In Progress'
  | 'Complete'
  | 'Cancelled';

export interface WillCall {
  wcNumber: string;
  clientId: string;
  clientSheetId?: string;
  clientName: string;
  status: WillCallStatus;
  pickupParty: string;
  pickupPartyPhone?: string;
  pickupPartyEmail?: string;
  scheduledDate?: string; // ISO date
  actualPickupDate?: string; // ISO date
  itemCount: number;
  items: WCItem[];
  createdDate: string; // ISO date
  notes?: string;
  requiresSignature: boolean;
  releasedBy?: string;
  wcFolderUrl?: string;
  shipmentFolderUrl?: string;
  cod?: boolean;
  codAmount?: number;
}

export type WillCallStatus = 'Pending' | 'Scheduled' | 'Released' | 'Partial' | 'Cancelled';

export interface WCItem {
  itemId: string;
  description: string;
  qty: number;
  released: boolean;
  vendor?: string;
  location?: string;
  status?: string;
  room?: string;
  reference?: string;
  itemClass?: string;
  sidemark?: string;
  carrier?: string;
  trackingNumber?: string;
  shipmentNumber?: string;
}

export interface Shipment {
  shipmentId: string;
  clientId: string;
  clientName: string;
  carrier: string;
  trackingNumber: string;
  status: 'Expected' | 'Received' | 'Exception';
  expectedDate: string; // ISO date
  receivedDate?: string; // ISO date
  itemCount: number;
  poNumber?: string;
  notes?: string;
  folderUrl?: string;
}

export interface BillingLedgerRow {
  ledgerId: string;
  clientId: string;
  clientName: string;
  taskId?: string;
  serviceCode: ServiceCode;
  serviceDescription: string;
  quantity: number;
  unitRate: number;
  totalAmount: number;
  billedDate: string; // ISO date
  invoiceId?: string;
  status: 'Unbilled' | 'Invoiced' | 'Paid' | 'Void';
  sidemark?: string;
  notes?: string;
}

// ─── Claims ──────────────────────────────────────────────────────────────────

export interface Claim {
  claimId: string;
  claimType: ClaimType;
  status: ClaimStatus;
  outcomeType?: string;
  resolutionType?: string;
  dateOpened: string;
  incidentDate?: string;
  dateClosed?: string;
  dateSettlementSent?: string;
  dateSignedSettlementReceived?: string;
  createdBy?: string;
  firstReviewedBy?: string;
  firstReviewedAt?: string;
  primaryContactName?: string;
  companyClientName: string;
  email?: string;
  phone?: string;
  requestedAmount?: number;
  approvedAmount?: number;
  coverageType?: string;
  clientSelectedCoverage?: string;
  propertyIncidentReference?: string;
  incidentLocation?: string;
  issueDescription?: string;
  decisionExplanation?: string;
  internalNotesSummary?: string;
  publicNotesSummary?: string;
  claimFolderUrl?: string;
  currentSettlementFileUrl?: string;
  currentSettlementVersion?: string;
  voidReason?: string;
  closeNote?: string;
  lastUpdated?: string;
}

export interface ClaimItem {
  claimId: string;
  itemId: string;
  itemDescriptionSnapshot?: string;
  vendorSnapshot?: string;
  classSnapshot?: string;
  statusSnapshot?: string;
  locationSnapshot?: string;
  sidemarkSnapshot?: string;
  roomSnapshot?: string;
  addedAt?: string;
  addedBy?: string;
}

export interface ClaimHistoryEvent {
  claimId: string;
  eventTimestamp: string;
  eventType: string;
  eventMessage: string;
  actor?: string;
  isPublic: boolean;
  relatedFileUrl?: string;
}

export interface ClaimFile {
  claimId: string;
  fileType: string;
  fileName: string;
  fileUrl: string;
  versionNo?: number;
  isCurrent: boolean;
  createdAt?: string;
  createdBy?: string;
}

export type ClaimType = 'Item Claim' | 'Property Claim';

export type ClaimStatus =
  | 'Under Review'
  | 'Waiting on Info'
  | 'Settlement Sent'
  | 'Approved'
  | 'Closed'
  | 'Void';

export interface ActivityEntry {
  id: string;
  timestamp: string; // ISO datetime
  type: 'receive' | 'release' | 'task' | 'repair' | 'willcall' | 'note';
  title: string;
  subtitle: string;
  clientName?: string;
  itemId?: string;
  taskId?: string;
}
