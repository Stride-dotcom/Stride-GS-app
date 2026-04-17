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
}

export type InventoryStatus = 'Active' | 'Released' | 'On Hold' | 'Transferred';

export interface Task {
  taskId: string;
  type: ServiceCode;
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
  dueDate?: string; // ISO date
  startedAt?: string; // ISO date
  completedAt?: string; // ISO date
  cancelledAt?: string; // ISO date
  result?: 'Pass' | 'Fail';
  itemNotes?: string;
  taskNotes?: string;
  svcCode: ServiceCode;
  billed: boolean;
  billedAmount?: number;
  customPrice?: number;
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
  | 'OTHER';

export interface Repair {
  repairId: string;
  sourceTaskId?: string;
  itemId: string;
  clientId: string;
  clientSheetId?: string;
  clientName: string;
  description: string;
  status: RepairStatus;
  quoteAmount?: number;
  approvedAmount?: number;
  repairVendor?: string;
  assignedTo?: string;
  createdDate: string; // ISO date
  quoteSentDate?: string; // ISO date
  approvedDate?: string; // ISO date
  completedDate?: string; // ISO date
  notes?: string;
  internalNotes?: string;
  room?: string;
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
