/**
 * Stride API — Fetch wrapper for the Apps Script API layer.
 *
 * Pattern (confirmed via cross-domain test 2026-03-27):
 *   - Standard fetch to Apps Script "Anyone" web app
 *   - Token sent via query parameter (?token=xxx&action=yyy)
 *   - Responses are JSON via ContentService
 *   - No CORS issues, no auth redirects, no proxy needed
 */

// ─── Configuration ───────────────────────────────────────────────────────────

const API_URL_KEY = 'stride_api_url';
const API_TOKEN_KEY = 'stride_api_token';
const API_CALLER_EMAIL_KEY = 'stride_caller_email';

/**
 * Get the API base URL.
 * Priority: localStorage (user-configured) → VITE_API_URL (baked in at build time).
 * The build-time fallback ensures auth works on any browser without requiring
 * the user to visit Settings → Integrations before they can log in.
 */
export function getApiUrl(): string {
  return localStorage.getItem(API_URL_KEY) || import.meta.env.VITE_API_URL || '';
}

/**
 * Get the API token.
 * Priority: localStorage → VITE_API_TOKEN (baked in at build time).
 */
export function getApiToken(): string {
  return localStorage.getItem(API_TOKEN_KEY) || import.meta.env.VITE_API_TOKEN || '';
}

/**
 * Set API credentials (called from Settings or Login).
 */
export function setApiCredentials(url: string, token: string): void {
  localStorage.setItem(API_URL_KEY, url.trim());
  localStorage.setItem(API_TOKEN_KEY, token.trim());
}

/**
 * Check if API is configured.
 */
export function isApiConfigured(): boolean {
  return !!(getApiUrl() && getApiToken());
}

/**
 * Get/set the caller email used for server-side auth on all data endpoints.
 * Set by AuthContext after successful login, cleared on logout.
 */
export function getCallerEmail(): string {
  return localStorage.getItem(API_CALLER_EMAIL_KEY) || '';
}

export function setCallerEmail(email: string): void {
  if (email) {
    localStorage.setItem(API_CALLER_EMAIL_KEY, email);
  } else {
    localStorage.removeItem(API_CALLER_EMAIL_KEY);
  }
}

// ─── API Response Types ──────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
  ok: boolean;
}

export interface ApiError {
  error: string;
  code?: string;
}

// ─── Fetch Wrapper ───────────────────────────────────────────────────────────

/**
 * Core fetch function. Builds the URL with query params and returns parsed JSON.
 *
 * @param action - The API action (e.g., "getClients", "getPricing")
 * @param extraParams - Additional query parameters beyond token and action
 * @param options - Override fetch options
 */
/** When true, the next apiFetch GET call will include noCache=1 to bypass server cache */
let _nextFetchNoCache = false;
export function setNextFetchNoCache() { _nextFetchNoCache = true; }

export async function apiFetch<T>(
  action: string,
  extraParams?: Record<string, string>,
  options?: { signal?: AbortSignal }
): Promise<ApiResponse<T>> {
  const url = getApiUrl();
  const token = getApiToken();

  if (!url) {
    return { data: null, error: 'API URL not configured. Go to Settings → Integrations.', ok: false };
  }

  // Build query string
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  params.set('action', action);

  // Auto-inject callerEmail for server-side auth (set by AuthContext after login)
  // Skip for health check and getUserByEmail (login lookup — no caller yet)
  const callerEmail = getCallerEmail();
  if (callerEmail && action !== 'health' && action !== 'getUserByEmail') {
    params.set('callerEmail', callerEmail);
  }

  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      params.set(key, value);
    }
  }

  // Bypass server-side CacheService when flagged (e.g., refresh button)
  if (_nextFetchNoCache) {
    params.set('noCache', '1');
    _nextFetchNoCache = false;
  }

  const fullUrl = `${url}?${params.toString()}`;

  try {
    const response = await fetch(fullUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: options?.signal,
    });

    if (!response.ok) {
      return {
        data: null,
        error: `HTTP ${response.status}: ${response.statusText}`,
        ok: false,
      };
    }

    const json = await response.json();

    // Check for API-level errors (Apps Script returns 200 with error object)
    if (json.error) {
      return {
        data: null,
        error: json.error,
        ok: false,
      };
    }

    return {
      data: json as T,
      ok: true,
      error: null,
    };
  } catch (err) {
    // AbortError is expected when component unmounts
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { data: null, error: 'Request cancelled', ok: false };
    }

    return {
      data: null,
      error: err instanceof Error ? err.message : String(err),
      ok: false,
    };
  }
}

// ─── Typed API Functions (Batch 1) ──────────────────────────────────────────

/** Health check response */
export interface HealthResponse {
  status: string;
  timestamp: string;
  version: string;
  message: string;
}

/** Client from CB Clients tab */
export interface ApiClient {
  name: string;
  spreadsheetId: string;
  email: string;
  contactName: string;
  phone: string;
  folderId: string;
  photosFolderId: string;
  invoiceFolderId: string;
  freeStorageDays: number;
  discountStoragePct: number;
  discountServicesPct: number;
  paymentTerms: string;
  enableReceivingBilling: boolean;
  enableShipmentEmail: boolean;
  enableNotifications: boolean;
  autoInspection: boolean;
  separateBySidemark: boolean;
  autoCharge: boolean;
  webAppUrl: string;
  qbCustomerName: string;
  staxCustomerId: string;
  parentClient: string;
  notes: string;
  /** v38.37.0 — per-client receiving instruction rendered as amber banner on Receiving page */
  shipmentNote?: string;
  active: boolean;
}

export interface ClientsResponse {
  clients: ApiClient[];
  count: number;
}

/** Price list row from Master Price List */
export interface ApiPriceRow {
  'Service Code': string;
  'Service Name': string;
  Category: string;
  Active: boolean;
  BillIfPASS: boolean;
  BillIfFAIL: boolean;
  'Show In Task Type': string;
  'XS Time': number;
  'S Time': number;
  'M Time': number;
  'L Time': number;
  'XL Time': number;
  'XS Rate': number;
  'S Rate': number;
  'M Rate': number;
  'L Rate': number;
  'XL Rate': number;
}

/** Class map row */
export interface ApiClassRow {
  Class: string;
  'Cubic Volume': number;
  Notes: string;
}

export interface PricingResponse {
  priceList: ApiPriceRow[];
  classMap: ApiClassRow[];
  priceCount: number;
  classCount: number;
}

/** Location from CB Locations tab */
export interface ApiLocation {
  location: string;
  notes: string;
}

export interface LocationsResponse {
  locations: ApiLocation[];
  count: number;
}

// ─── Batch 2 Types (Operational Data) ────────────────────────────────────────

/** Inventory item from a client sheet */
export interface ApiInventoryItem {
  itemId: string;
  clientName: string;
  clientSheetId: string;
  reference: string;
  qty: number;
  vendor: string;
  description: string;
  itemClass: string;
  location: string;
  sidemark: string;
  room: string;
  itemNotes: string;
  taskNotes: string;
  needsInspection: boolean;
  needsAssembly: boolean;
  carrier: string;
  trackingNumber: string;
  shipmentNumber: string;
  receiveDate: string;
  releaseDate: string;
  status: string;
  invoiceUrl: string;
  shipmentFolderUrl?: string;
}

export interface InventoryResponse {
  items: ApiInventoryItem[];
  count: number;
  clientsQueried: number;
  errors?: { client: string; error: string }[];
}

/** Task from a client sheet */
export interface ApiTask {
  taskId: string;
  clientName: string;
  clientSheetId: string;
  type: string;
  status: string;
  itemId: string;
  vendor: string;
  description: string;
  location: string;
  sidemark: string;
  shipmentNumber: string;
  created: string;
  itemNotes: string;
  completedAt: string;
  cancelledAt: string;
  result: string;
  taskNotes: string;
  svcCode: string;
  billed: boolean;
  assignedTo: string;
  startedAt?: string;
  customPrice?: number;
  taskFolderUrl?: string;
  shipmentFolderUrl?: string;
}

export interface TasksResponse {
  tasks: ApiTask[];
  count: number;
  clientsQueried: number;
  errors?: { client: string; error: string }[];
}

/** Repair from a client sheet */
export interface ApiRepair {
  repairId: string;
  clientName: string;
  clientSheetId: string;
  sourceTaskId: string;
  itemId: string;
  description: string;
  itemClass: string;
  vendor: string;
  location: string;
  sidemark: string;
  taskNotes: string;
  createdBy: string;
  createdDate: string;
  quoteAmount: number | null;
  quoteSentDate: string;
  status: string;
  approved: boolean;
  scheduledDate: string;
  startDate: string;
  repairVendor: string;
  partsCost: number | null;
  laborHours: number | null;
  repairResult: string;
  finalAmount: number | null;
  invoiceId: string;
  itemNotes: string;
  repairNotes: string;
  completedDate: string;
  billed: boolean;
  repairFolderUrl?: string;
  shipmentFolderUrl?: string;
  taskFolderUrl?: string;
}

export interface RepairsResponse {
  repairs: ApiRepair[];
  count: number;
  clientsQueried: number;
  errors?: { client: string; error: string }[];
}

/** WC Item from WC_Items tab */
export interface ApiWCItem {
  wcNumber: string;
  itemId: string;
  qty: number;
  vendor: string;
  description: string;
  itemClass: string;
  location: string;
  sidemark: string;
  room: string;
  wcFee: number | null;
  released: boolean;
  status: string;
}

/** Will Call from a client sheet */
export interface ApiWillCall {
  wcNumber: string;
  clientName: string;
  clientSheetId: string;
  status: string;
  createdDate: string;
  createdBy: string;
  pickupParty: string;
  pickupPhone: string;
  requestedBy: string;
  estimatedPickupDate: string;
  actualPickupDate: string;
  notes: string;
  cod: boolean;
  codAmount: number | null;
  itemsCount: number;
  totalWcFee: number | null;
  items: ApiWCItem[];
  wcFolderUrl?: string;
  shipmentFolderUrl?: string;
}

export interface WillCallsResponse {
  willCalls: ApiWillCall[];
  count: number;
  clientsQueried: number;
  errors?: { client: string; error: string }[];
}

/** Shipment from a client sheet */
export interface ApiShipmentItem {
  itemId: string;
  description: string;
  itemClass: string;
  qty: number;
  location: string;
}

export interface ApiShipment {
  shipmentNumber: string;
  clientName: string;
  clientSheetId: string;
  receiveDate: string;
  itemCount: number;
  carrier: string;
  trackingNumber: string;
  photosUrl: string;
  notes: string;
  invoiceUrl: string;
  folderUrl: string;
}

export interface ShipmentItemsResponse {
  items: ApiShipmentItem[];
  count: number;
}

export interface ShipmentsResponse {
  shipments: ApiShipment[];
  count: number;
  clientsQueried: number;
  errors?: { client: string; error: string }[];
}

// ─── Batch 3 Types (Billing) ─────────────────────────────────────────────────

/** Billing ledger row from a client sheet */
export interface ApiBillingRow {
  ledgerRowId: string;
  clientName: string;
  clientSheetId: string;
  status: string;
  invoiceNo: string;
  client: string;
  date: string;
  svcCode: string;
  svcName: string;
  category: string;
  itemId: string;
  description: string;
  itemClass: string;
  qty: number;
  rate: number | null;
  total: number | null;
  taskId: string;
  repairId: string;
  shipmentNo: string;
  itemNotes: string;
  invoiceDate: string;
  invoiceUrl: string;
  sidemark: string;
  qboStatus?: string | null;
  qboInvoiceId?: string | null;
}

export interface BillingSummary {
  unbilled: number;
  invoiced: number;
  billed: number;
  void_count: number;
  totalUnbilled: number;
}

export interface BillingResponse {
  rows: ApiBillingRow[];
  count: number;
  clientsQueried: number;
  summary: BillingSummary;
  errors?: { client: string; error: string }[];
}

// ─── Batch 4 Types (Claims) ──────────────────────────────────────────────────

/** Claim list row from CB Claims tab (new schema v22+) */
export interface ApiClaim {
  claimId: string;
  claimType: string;
  status: string;
  outcomeType: string;
  resolutionType: string;
  dateOpened: string;
  incidentDate: string;
  dateClosed: string;
  dateSettlementSent: string;
  dateSignedSettlementReceived: string;
  createdBy: string;
  firstReviewedBy: string;
  firstReviewedAt: string;
  primaryContactName: string;
  companyClientName: string;
  email: string;
  phone: string;
  requestedAmount: number | null;
  approvedAmount: number | null;
  coverageType: string;
  clientSelectedCoverage: string;
  propertyIncidentReference: string;
  incidentLocation: string;
  issueDescription: string;
  decisionExplanation: string;
  internalNotesSummary: string;
  publicNotesSummary: string;
  claimFolderUrl: string;
  currentSettlementFileUrl: string;
  currentSettlementVersion: string;
  voidReason: string;
  closeNote: string;
  lastUpdated: string;
}

export interface ApiClaimItem {
  claimId: string;
  itemId: string;
  itemDescriptionSnapshot: string;
  vendorSnapshot: string;
  classSnapshot: string;
  statusSnapshot: string;
  locationSnapshot: string;
  sidemarkSnapshot: string;
  roomSnapshot: string;
  addedAt: string;
  addedBy: string;
}

export interface ApiClaimHistoryEvent {
  claimId: string;
  eventTimestamp: string;
  eventType: string;
  eventMessage: string;
  actor: string;
  isPublic: boolean;
  relatedFileUrl: string;
}

export interface ApiClaimFile {
  claimId: string;
  fileType: string;
  fileName: string;
  fileUrl: string;
  versionNo: number | null;
  isCurrent: boolean;
  createdAt: string;
  createdBy: string;
}

export interface ClaimsResponse {
  claims: ApiClaim[];
  count: number;
  message?: string;
}

export interface ClaimDetailResponse {
  claim: ApiClaim;
  items: ApiClaimItem[];
  history: ApiClaimHistoryEvent[];
  files: ApiClaimFile[];
  firstReviewStamped?: boolean;
}

// ─── Claims Write Types ───────────────────────────────────────────────────────

export interface CreateClaimPayload {
  idempotencyKey: string;
  claimType: 'Item Claim' | 'Property Claim';
  primaryContactName: string;
  companyClientName: string;
  email?: string;
  phone?: string;
  incidentDate?: string;
  coverageType?: string;
  clientSelectedCoverage?: string;
  propertyIncidentReference?: string;
  incidentLocation?: string;
  issueDescription: string;
  requestedAmount?: number;
  itemIds?: string[];
  clientSheetId?: string;
}
export interface CreateClaimResponse {
  success: boolean;
  claimId: string;
  claimFolderUrl: string;
  itemsAdded?: number;
  warnings?: string[];
}

export interface AddClaimItemsPayload {
  claimId: string;
  itemIds: string[];
  clientSheetId: string;
}
export interface AddClaimItemsResponse {
  success: boolean;
  itemsAdded: number;
  warnings?: string[];
}

export interface AddClaimNotePayload {
  claimId: string;
  noteText: string;
  isPublic: boolean;
}
export interface AddClaimNoteResponse {
  success: boolean;
}

export interface RequestMoreInfoPayload {
  claimId: string;
  infoRequested?: string;
}
export interface RequestMoreInfoResponse {
  success: boolean;
  emailSent: boolean;
}

export interface SendClaimDenialPayload {
  claimId: string;
  decisionExplanation: string;
  message?: string;
}
export interface SendClaimDenialResponse {
  success: boolean;
  emailSent: boolean;
}

export interface GenerateClaimSettlementPayload {
  claimId: string;
  approvedAmount: number;
  coverageType: string;
  outcomeType: string;
  resolutionType: string;
  decisionExplanation?: string;
  forceRegenerate?: boolean;
}
export interface GenerateClaimSettlementResponse {
  success: boolean;
  fileUrl: string;
  versionNo: number;
  emailSent: boolean;
  warnings?: string[];
}

export interface UploadSignedSettlementPayload {
  claimId: string;
  driveFileUrl: string;
  fileName?: string;
}
export interface UploadSignedSettlementResponse {
  success: boolean;
  fileUrl: string;
}

export interface CloseClaimPayload {
  claimId: string;
  closeNote?: string;
}
export interface CloseClaimResponse {
  success: boolean;
}

export interface VoidClaimPayload {
  claimId: string;
  voidReason: string;
}
export interface VoidClaimResponse {
  success: boolean;
}

export interface ReopenClaimPayload {
  claimId: string;
  reopenReason?: string;
}
export interface ReopenClaimResponse {
  success: boolean;
}

// ─── Convenience Functions ───────────────────────────────────────────────────

export function fetchHealth(signal?: AbortSignal) {
  return apiFetch<HealthResponse>('health', undefined, { signal });
}

export function fetchClients(signal?: AbortSignal, includeInactive?: boolean) {
  return apiFetch<ClientsResponse>('getClients', includeInactive ? { includeInactive: '1' } : undefined, { signal });
}

export function fetchPricing(signal?: AbortSignal) {
  return apiFetch<PricingResponse>('getPricing', undefined, { signal });
}

export function fetchLocations(signal?: AbortSignal) {
  return apiFetch<LocationsResponse>('getLocations', undefined, { signal });
}

// Batch 2

export function fetchInventory(signal?: AbortSignal, clientSheetId?: string) {
  const extra = clientSheetId ? { clientSheetId } : undefined;
  return apiFetch<InventoryResponse>('getInventory', extra, { signal });
}

export function fetchTasks(signal?: AbortSignal, clientSheetId?: string) {
  const extra = clientSheetId ? { clientSheetId } : undefined;
  return apiFetch<TasksResponse>('getTasks', extra, { signal });
}

/** Fetch a single task by ID — legacy fallback for standalone task detail page */
export function fetchTaskById(taskId: string, clientSheetId: string, signal?: AbortSignal) {
  return apiFetch<{ success: boolean; task: ApiTask }>('getTaskById', { taskId, clientSheetId }, { signal });
}

export function fetchWillCallById(wcNumber: string, clientSheetId: string, signal?: AbortSignal) {
  return apiFetch<{ success: boolean; willCall: ApiWillCall }>('getWillCallById', { wcNumber, clientSheetId }, { signal });
}

export function fetchRepairById(repairId: string, clientSheetId: string, signal?: AbortSignal) {
  return apiFetch<{ success: boolean; repair: ApiRepair }>('getRepairById', { repairId, clientSheetId }, { signal });
}

export function fetchRepairs(signal?: AbortSignal, clientSheetId?: string) {
  const extra = clientSheetId ? { clientSheetId } : undefined;
  return apiFetch<RepairsResponse>('getRepairs', extra, { signal });
}

export function fetchWillCalls(signal?: AbortSignal, clientSheetId?: string) {
  const extra = clientSheetId ? { clientSheetId } : undefined;
  return apiFetch<WillCallsResponse>('getWillCalls', extra, { signal });
}

export function fetchShipments(signal?: AbortSignal, clientSheetId?: string) {
  const extra = clientSheetId ? { clientSheetId } : undefined;
  return apiFetch<ShipmentsResponse>('getShipments', extra, { signal });
}

export function fetchShipmentItems(clientSheetId: string, shipmentNo: string, signal?: AbortSignal) {
  return apiFetch<ShipmentItemsResponse>('getShipmentItems', { clientSheetId, shipmentNo }, { signal });
}

// Batch 3

/** Server-side filter params for billing report builder (v38.13.0) */
export interface BillingFilterParams {
  clientSheetId?: string;
  statusFilter?: string[];
  svcFilter?: string[];
  sidemarkFilter?: string[];
  endDate?: string;
  clientFilter?: string[];
}

export function fetchBilling(signal?: AbortSignal, clientSheetId?: string, filters?: BillingFilterParams) {
  const extra: Record<string, string> = {};
  if (clientSheetId) extra.clientSheetId = clientSheetId;
  if (filters?.statusFilter?.length) extra.statusFilter = filters.statusFilter.join(',');
  if (filters?.svcFilter?.length) extra.svcFilter = filters.svcFilter.join(',');
  if (filters?.sidemarkFilter?.length) extra.sidemarkFilter = filters.sidemarkFilter.join(',');
  if (filters?.endDate) extra.endDate = filters.endDate;
  if (filters?.clientFilter?.length) extra.clientFilter = filters.clientFilter.join(',');
  return apiFetch<BillingResponse>('getBilling', Object.keys(extra).length ? extra : undefined, { signal });
}

// Batch 4

export function fetchClaims(signal?: AbortSignal) {
  return apiFetch<ClaimsResponse>('getClaims', undefined, { signal });
}

export function fetchClaimDetail(claimId: string, signal?: AbortSignal) {
  return apiFetch<ClaimDetailResponse>('getClaimDetail', { claimId }, { signal });
}

// ─── Phase 6 User Types ──────────────────────────────────────────────────────

export interface ApiUser {
  email: string;
  role: 'admin' | 'staff' | 'client';
  clientName: string;          // May be comma-separated for multi-client users
  clientSheetId: string;       // May be comma-separated (source of truth for access)
  active: boolean;
  created: string;
  lastLogin: string;
  lastLoginSource: string;
  updatedBy: string;
  updatedAt: string;
  isParent?: boolean;
  childClientSheetIds?: string[];
  accessibleClientSheetIds?: string[];   // v33: full list of accessible IDs
  accessibleClientNames?: string[];      // v33: matching display names
}

export interface UserResponse {
  user: ApiUser | null;
}

export interface UsersResponse {
  users: ApiUser[];
  count: number;
}

export interface CreateUserResponse {
  success: boolean;
  user: ApiUser;
}

export interface UpdateUserResponse {
  success: boolean;
  user: ApiUser;
}

// ─── Phase 6 User Fetch Functions ───────────────────────────────────────────

/**
 * Look up a user by email after Supabase auth succeeds.
 * Also stamps Last Login on the Users tab.
 */
export function fetchUserByEmail(
  email: string,
  loginSource: 'password' | 'recovery',
  signal?: AbortSignal
) {
  return apiFetch<UserResponse>(
    'getUserByEmail',
    { email, loginSource },
    { signal }
  );
}

/**
 * List all users. Requires callerEmail to be admin/staff.
 */
export function fetchUsers(callerEmail: string, signal?: AbortSignal) {
  return apiFetch<UsersResponse>('getUsers', { callerEmail }, { signal });
}

/**
 * Create a new user. Defaults Active=FALSE.
 */
export function createApiUser(
  callerEmail: string,
  email: string,
  role: string,
  clientName?: string,
  clientSheetId?: string,
  signal?: AbortSignal
) {
  const params: Record<string, string> = { callerEmail, email, role };
  if (clientName) params.clientName = clientName;
  if (clientSheetId) params.clientSheetId = clientSheetId;
  return apiFetch<CreateUserResponse>('createUser', params, { signal });
}

/**
 * Update user fields. v33: supports active, role, clientName, clientSheetId.
 */
export function updateApiUser(
  callerEmail: string,
  email: string,
  updates: { active?: boolean; role?: string; clientName?: string; clientSheetId?: string; newEmail?: string },
  signal?: AbortSignal
) {
  const params: Record<string, string> = { callerEmail, email };
  if (updates.active !== undefined) params.active = updates.active ? 'TRUE' : 'FALSE';
  if (updates.role) params.role = updates.role;
  if (updates.clientName !== undefined) params.clientName = updates.clientName;
  if (updates.clientSheetId !== undefined) params.clientSheetId = updates.clientSheetId;
  if (updates.newEmail) params.newEmail = updates.newEmail;
  return apiFetch<UpdateUserResponse>('updateUser', params, { signal });
}

export function deleteApiUser(callerEmail: string, email: string) {
  return apiFetch<{ success: boolean; deletedEmail: string }>('deleteUser', { callerEmail, email });
}

// ─── POST Fetch Wrapper (Write Operations) ──────────────────────────────────

/** Default timeout for write calls — 90 seconds. Apps Script can be slow. */
const API_POST_TIMEOUT_MS = 90_000;

/** Extended timeout for heavy operations (invoice creation, batch QBO push) — 5 minutes.
 *  GAS itself has a 6-minute execution limit, so 5 min gives it room to finish. */
const API_POST_TIMEOUT_LONG_MS = 300_000;

/** Sentinel error message used by write handlers to detect timeouts vs. other failures. */
export const API_TIMEOUT_ERROR = 'Request timed out — check the sheet to verify if the change was applied before retrying.';

/**
 * Core POST function for write operations. Auth params (token, callerEmail, clientSheetId)
 * go in query string; payload goes in JSON body.
 *
 * Phase 1 additions:
 *  - Auto-generates a requestId UUID and injects it into the body (idempotency token).
 *    Callers can pass body.requestId to reuse an existing token (e.g. retry).
 *  - 90-second timeout watchdog. On timeout, returns an error with API_TIMEOUT_ERROR
 *    so the caller can write a sync_failed event to Supabase.
 *  - Returns requestId on both success and failure so callers can log it.
 */
export async function apiPost<T>(
  action: string,
  body: Record<string, unknown>,
  extraParams?: Record<string, string>,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<ApiResponse<T> & { requestId: string }> {
  const url = getApiUrl();
  const token = getApiToken();

  // Auto-generate requestId if not supplied
  const requestId = (body.requestId as string | undefined) ?? crypto.randomUUID();
  const bodyWithId: Record<string, unknown> = body.requestId ? body : { ...body, requestId };

  if (!url) {
    return { data: null, error: 'API URL not configured. Go to Settings → Integrations.', ok: false, requestId };
  }

  const params = new URLSearchParams();
  if (token) params.set('token', token);
  params.set('action', action);

  const callerEmail = getCallerEmail();
  if (callerEmail) params.set('callerEmail', callerEmail);

  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      params.set(key, value);
    }
  }

  const fullUrl = `${url}?${params.toString()}`;

  // Timeout watchdog (default 90s, configurable per call)
  const effectiveTimeout = options?.timeoutMs ?? API_POST_TIMEOUT_MS;
  const timeoutCtrl = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutCtrl.abort(), effectiveTimeout);

  // Merge caller signal + timeout signal
  const signal = options?.signal
    ? AbortSignal.any([options.signal, timeoutCtrl.signal])
    : timeoutCtrl.signal;

  try {
    const response = await fetch(fullUrl, {
      method: 'POST',
      redirect: 'follow',
      signal,
      headers: { 'Content-Type': 'text/plain' }, // Apps Script limitation
      body: JSON.stringify(bodyWithId),
    });

    clearTimeout(timeoutHandle);

    if (!response.ok) {
      return { data: null, error: `HTTP ${response.status}: ${response.statusText}`, ok: false, requestId };
    }

    const json = await response.json();

    if (json.error) {
      return { data: null, error: json.error, ok: false, requestId };
    }

    return { data: json as T, ok: true, error: null, requestId };
  } catch (err) {
    clearTimeout(timeoutHandle);

    if (err instanceof DOMException && err.name === 'AbortError') {
      // Distinguish timeout from caller-initiated cancellation
      if (timeoutCtrl.signal.aborted) {
        return { data: null, error: API_TIMEOUT_ERROR, ok: false, requestId };
      }
      return { data: null, error: 'Request cancelled', ok: false, requestId };
    }
    return { data: null, error: err instanceof Error ? err.message : String(err), ok: false, requestId };
  }
}

// ─── Write Endpoint Types (Phase 7B) ────────────────────────────────────────

export interface ShipmentItemPayload {
  itemId: string;
  qty: number;
  vendor: string;
  description: string;
  class: string;
  location: string;
  sidemark: string;
  reference?: string;
  room?: string;
  needsInspection: boolean;
  needsAssembly: boolean;
  itemNotes?: string;
}

export interface CompleteShipmentPayload {
  idempotencyKey: string;
  items: ShipmentItemPayload[];
  carrier: string;
  trackingNumber: string;
  notes: string;
  receiveDate: string;
  skipReceivingBilling?: boolean;
}

export interface CompleteShipmentResponse {
  success: boolean;
  shipmentNo?: string;
  itemCount?: number;
  tasksCreated?: number;
  billingRows?: number;
  alreadyProcessed?: boolean;
  message?: string;
  warnings?: string[];
  partialState?: {
    shipmentsWritten: boolean;
    inventoryWritten: boolean;
    tasksWritten: boolean;
    billingWritten: boolean;
  };
}

export function postCompleteShipment(
  payload: CompleteShipmentPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<CompleteShipmentResponse>(
    'completeShipment',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── checkItemIdsAvailable — Phase 2 item_id_ledger preflight ───────────────
// Queries the Supabase item_id_ledger (via StrideAPI.gs v38.52.0+) to see
// whether any Item IDs are already registered. Used by Receiving page on
// submit to block cross-tenant collisions before completeShipment runs.
//
// Returned duplicates may include SAME-tenant rows (e.g. resubmit of an
// already-received shipment) — the caller must filter by tenantId if they
// want "cross-tenant only". The server-side completeShipment guard already
// does the same filter and returns ITEM_ID_COLLISION if any cross-tenant
// dup exists, so this preflight is primarily for UX, not enforcement.

export interface CheckItemIdsAvailableDuplicate {
  itemId: string;
  tenantId: string;
  tenantName?: string;
  status: 'active' | 'released' | 'transferred' | 'voided';
  source: 'auto' | 'manual' | 'import' | 'reassign' | 'backfill';
  createdAt: string;
}

export interface CheckItemIdsAvailableResponse {
  ok: boolean;
  duplicates: CheckItemIdsAvailableDuplicate[];
  /** True when Supabase is unreachable. Duplicates will be []; caller should
   *  warn the user but allow save — nightly reconciliation catches misses. */
  degraded: boolean;
}

export function postCheckItemIdsAvailable(
  itemIds: string[],
  signal?: AbortSignal
) {
  return apiPost<CheckItemIdsAvailableResponse>(
    'checkItemIdsAvailable',
    { itemIds } as Record<string, unknown>,
    {},
    { signal }
  );
}

// ─── completeTask (Phase 7B #2) ──────────────────────────────────────────────

export interface CompleteTaskPayload {
  taskId: string;
  result: 'Pass' | 'Fail';
  taskNotes?: string;
  /** Optional inline Custom Price override — atomically set on the task before
   *  the billing row is written. number = set, null = clear, undefined = no change. */
  customPrice?: number | null;
}

export interface CompleteTaskResponse {
  success: boolean;
  taskId?: string;
  result?: string;
  billingCreated?: boolean;
  repairCreated?: boolean;
  skipped?: boolean;
  message?: string;
  warnings?: string[];
  error?: string;
}

export function postCompleteTask(
  payload: CompleteTaskPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<CompleteTaskResponse>(
    'completeTask',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── requestRepairQuote — create a new Repair row from inventory item ────────

export interface RequestRepairQuotePayload { itemId: string; sourceTaskId?: string; notes?: string; }
export interface RequestRepairQuoteResponse { success: boolean; repairId?: string; itemId?: string; message?: string; error?: string; }

export function postRequestRepairQuote(
  payload: RequestRepairQuotePayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<RequestRepairQuoteResponse>(
    'requestRepairQuote',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── sendRepairQuote (Phase 7B #3) ───────────────────────────────────────────

export interface SendRepairQuotePayload {
  repairId: string;
  quoteAmount: number;
}

export interface SendRepairQuoteResponse {
  success: boolean;
  repairId?: string;
  quoteAmount?: number;
  emailSent?: boolean;
  skipped?: boolean;
  message?: string;
  warnings?: string[];
  error?: string;
}

export function postSendRepairQuote(
  payload: SendRepairQuotePayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<SendRepairQuoteResponse>(
    'sendRepairQuote',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── respondToRepairQuote (Phase 7B #4) ──────────────────────────────────────

export interface RespondToRepairQuotePayload {
  repairId: string;
  decision: 'Approve' | 'Decline';
}

export interface RespondToRepairQuoteResponse {
  success: boolean;
  repairId?: string;
  decision?: string;
  emailSent?: boolean;
  skipped?: boolean;
  message?: string;
  warnings?: string[];
  error?: string;
}

export function postRespondToRepairQuote(
  payload: RespondToRepairQuotePayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<RespondToRepairQuoteResponse>(
    'respondToRepairQuote',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Phase 7B #5: Complete Repair ────────────────────────────────────────────

export interface CompleteRepairPayload {
  repairId: string;
  resultValue: 'Pass' | 'Fail';
  finalAmount?: number;
  repairNotes?: string;
}

export interface CompleteRepairResponse {
  success: boolean;
  repairId?: string;
  resultValue?: string;
  billingCreated?: boolean;
  billingAmount?: number;
  emailSent?: boolean;
  skipped?: boolean;
  message?: string;
  warnings?: string[];
  error?: string;
}

export function postCompleteRepair(
  payload: CompleteRepairPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<CompleteRepairResponse>(
    'completeRepair',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Start Repair ───────────────────────────────────────────────────────────

export interface StartRepairPayload {
  repairId: string;
}

export interface StartRepairResponse {
  success: boolean;
  repairId?: string;
  startDate?: string;
  skipped?: boolean;
  message?: string;
  warnings?: string[];
  error?: string;
}

export function postStartRepair(
  payload: StartRepairPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<StartRepairResponse>(
    'startRepair',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Phase 7B #6: Create Will Call ───────────────────────────────────────────

export interface CreateWillCallPayload {
  items: string[];           // array of itemIds
  pickupParty: string;
  pickupPhone?: string;
  requestedBy?: string;
  estDate?: string;
  notes?: string;
  cod: boolean;
  codAmount?: number;
  createdBy?: string;
}

export interface CreateWillCallResponse {
  success: boolean;
  wcNumber?: string;
  itemCount?: number;
  totalFee?: number;
  emailSent?: boolean;
  warnings?: string[];
  error?: string;
}

export function postCreateWillCall(
  payload: CreateWillCallPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<CreateWillCallResponse>(
    'createWillCall',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Phase 7B #7: Process WC Release ────────────────────────────────────────

export interface ProcessWcReleasePayload {
  wcNumber: string;
  releaseItemIds: string[];  // itemIds to release (all = full release, subset = partial)
}

export interface ProcessWcReleaseResponse {
  success: boolean;
  releasedCount?: number;
  isPartial?: boolean;
  newWcNumber?: string;   // only present for partial release
  emailSent?: boolean;
  skipped?: boolean;
  warnings?: string[];
  error?: string;
}

export function postProcessWcRelease(
  payload: ProcessWcReleasePayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<ProcessWcReleaseResponse>(
    'processWcRelease',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Cancel Will Call ─────────────────────────────────────────────────────────

export interface CancelWillCallPayload {
  wcNumber: string;
}

export interface CancelWillCallResponse {
  success: boolean;
  wcNumber: string;
  itemsCancelled?: number;
  emailSent?: boolean;
  skipped?: boolean;
  error?: string;
  warnings?: string[];
}

export function postCancelWillCall(
  payload: CancelWillCallPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<CancelWillCallResponse>(
    'cancelWillCall',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Update Will Call Fields ────────────────────────────────────────────────

export interface UpdateWillCallPayload {
  wcNumber: string;
  estimatedPickupDate?: string;
  pickupParty?: string;
  pickupPhone?: string;
  requestedBy?: string;
  notes?: string;
  cod?: boolean;
  codAmount?: number;
  status?: string;
}

export interface UpdateWillCallResponse {
  success: boolean;
  wcNumber: string;
  updated?: Record<string, unknown>;
  statusPromoted?: boolean;
  error?: string;
}

export function postUpdateWillCall(
  payload: UpdateWillCallPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<UpdateWillCallResponse>(
    'updateWillCall',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Generate Will Call Document (PDF) ───────────────────────────────────────

export interface GenerateWcDocResponse {
  success: boolean;
  wcNumber: string;
  folderUrl?: string;
  itemCount?: number;
  error?: string;
}

export function postGenerateWcDoc(
  wcNumber: string,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<GenerateWcDocResponse>(
    'generateWcDoc',
    { wcNumber } as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Add Items to Existing Will Call ──────────────────────────────────────────

export interface AddItemsToWillCallPayload {
  wcNumber: string;
  items: string[];  // array of itemIds
}

export interface AddItemsToWillCallResponse {
  success: boolean;
  addedCount?: number;
  totalItems?: number;
  totalFee?: number;
  skipped?: string[];
  warnings?: string[];
  error?: string;
}

export function postAddItemsToWillCall(
  payload: AddItemsToWillCallPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<AddItemsToWillCallResponse>(
    'addItemsToWillCall',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Remove Items from Will Call ─────────────────────────────────────────────

export interface RemoveItemsFromWillCallPayload {
  wcNumber: string;
  itemIds: string[];
}

export interface RemoveItemsFromWillCallResponse {
  success: boolean;
  removedCount?: number;
  remainingItems?: number;
  totalFee?: number;
  cancelled?: boolean;
  skippedReleased?: string[];
  error?: string;
}

export function postRemoveItemsFromWillCall(
  payload: RemoveItemsFromWillCallPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<RemoveItemsFromWillCallResponse>(
    'removeItemsFromWillCall',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Release Items (bulk set Release Date + Status=Released) ─────────────────

export interface ReleaseItemsPayload {
  itemIds: string[];
  releaseDate: string; // YYYY-MM-DD
  notes?: string;
}

export interface ReleaseItemsResponse {
  success: boolean;
  releasedCount?: number;
  skipped?: string[];
  totalRequested?: number;
  error?: string;
}

export function postReleaseItems(
  payload: ReleaseItemsPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<ReleaseItemsResponse>(
    'releaseItems',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Will Call PDF URL (Print Release Doc) ─────────────────────────────────

export interface WcDocUrlResponse {
  wcNumber: string;
  folderUrl: string | null;
  pdfUrl: string | null;
  pdfName: string | null;
  error?: string;
}

export function fetchWcDocUrl(
  wcNumber: string,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiFetch<WcDocUrlResponse>('getWcDocUrl', { wcNumber, clientSheetId }, { signal });
}

// ─── Autocomplete DB ────────────────────────────────────────────────────────

export interface AutocompleteResponse {
  sidemarks: string[];
  vendors: string[];
  descriptions: string[];
}

export function fetchAutocomplete(clientSheetId: string, signal?: AbortSignal) {
  return apiFetch<AutocompleteResponse>('getAutocomplete', { clientSheetId }, { signal });
}

// ─── Phase 7B #8: Transfer Items ────────────────────────────────────────────

export interface TransferItemsPayload {
  destinationClientSheetId: string;
  itemIds: string[];
  /**
   * Cutover date for storage billing (YYYY-MM-DD).
   * - Source bills storage through (transferDate - 1)
   * - Destination bills from transferDate forward with fresh free-days credit
   * Defaults to today on the backend if omitted. Past dates allowed (backfill).
   * Future dates rejected in Phase 1.
   */
  transferDate?: string;
}

export interface TransferItemsResponse {
  success: boolean;
  copiedItems?: number;
  voidedLedgerRows?: number;
  createdLedgerRows?: number;
  tasksTransferred?: number;
  repairsTransferred?: number;
  emailSent?: boolean;
  warnings?: string[];
  error?: string;
}

export function postTransferItems(
  payload: TransferItemsPayload,
  sourceClientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<TransferItemsResponse>(
    'transferItems',
    payload as unknown as Record<string, unknown>,
    { clientSheetId: sourceClientSheetId },
    { signal }
  );
}

// ─── Phase 7B #9: Generate Storage Charges ───────────────────────────────────

export interface GenerateStorageChargesPayload {
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
}

export interface GenerateStorageChargesResponse {
  success: boolean;
  totalCreated?: number;
  clientsProcessed?: number;
  skippedItems?: string[];
  failedClients?: string[];
  message?: string;
  error?: string;
}

export function postGenerateStorageCharges(
  payload: GenerateStorageChargesPayload,
  signal?: AbortSignal
) {
  return apiPost<GenerateStorageChargesResponse>(
    'generateStorageCharges',
    payload as unknown as Record<string, unknown>,
    {},
    { signal }
  );
}

// ─── Preview Storage Charges (read-only) ────────────────────────────────────

export interface PreviewStorageRow {
  client: string;
  itemId: string;
  description: string;
  itemClass: string;
  sidemark: string;
  qty: number;
  rate: number;
  total: number;
  date: string;
  notes: string;
  taskId: string;
  shipmentNo: string;
  sourceSheetId: string;
}

export interface PreviewStorageChargesResponse {
  success: boolean;
  rows?: PreviewStorageRow[];
  count?: number;
  totalAmount?: number;
  skippedItems?: string[];
  failedClients?: string[];
  error?: string;
}

export interface PreviewStorageChargesPayload {
  startDate: string;         // YYYY-MM-DD
  endDate: string;           // YYYY-MM-DD
  clientFilter?: string;     // comma-separated client names (empty = all)
  sidemarkFilter?: string;   // comma-separated sidemark names (empty = all)
}

export function postPreviewStorageCharges(
  payload: PreviewStorageChargesPayload,
  signal?: AbortSignal
) {
  return apiPost<PreviewStorageChargesResponse>(
    'previewStorageCharges',
    payload as unknown as Record<string, unknown>,
    {},
    { signal }
  );
}

// ─── QB IIF Export ──────────────────────────────────────────────────────────

export interface QbExportPayload {
  source: 'invoiced' | 'selected';
  ledgerRowIds?: string[];
}

export interface QbExportResponse {
  success: boolean;
  invoiceCount?: number;
  lineCount?: number;
  fileName?: string;
  fileUrl?: string;
  error?: string;
}

export function postQbExport(
  payload: QbExportPayload,
  signal?: AbortSignal
) {
  return apiPost<QbExportResponse>(
    'qbExport',
    payload as unknown as Record<string, unknown>,
    {},
    { signal, timeoutMs: API_POST_TIMEOUT_LONG_MS }
  );
}

// QB Excel Export (QBO-compatible .xlsx)
export function postQbExcelExport(
  payload: QbExportPayload,
  signal?: AbortSignal
) {
  return apiPost<QbExportResponse>(
    'qbExcelExport',
    payload as unknown as Record<string, unknown>,
    {},
    { signal, timeoutMs: API_POST_TIMEOUT_LONG_MS }
  );
}

// ─── Phase 7B #10: Generate Unbilled Report ──────────────────────────────────

export interface GenerateUnbilledReportPayload {
  endDate: string;          // YYYY-MM-DD
  clientFilter?: string;    // exact client name match (empty = all clients)
  svcFilter?: string;       // comma-separated service codes e.g. "RCVG,INSP" (empty = all)
  sidemarkFilter?: string;  // comma-separated sidemark names (empty = all)
  includeStorage?: boolean; // default true
}

export interface UnbilledReportRow {
  client: string;
  sidemark: string;
  date: string;       // YYYYMMDD for sorting
  svcCode: string;
  svcName: string;
  itemId: string;
  description: string;
  itemClass: string;
  qty: number;
  rate: number;
  total: number;
  notes: string;
  taskId: string;
  repairId: string;
  shipmentNo: string;
  category: string;
  ledgerRowId: string;
  sourceSheetId: string;
}

export interface GenerateUnbilledReportStats {
  matched: number;
  scanned: number;
  clientsOpened: number;
  clientsFailed?: number;
}

export interface GenerateUnbilledReportResponse {
  success: boolean;
  rows?: UnbilledReportRow[];
  stats?: GenerateUnbilledReportStats;
  message?: string;
  error?: string;
}

export function postGenerateUnbilledReport(
  payload: GenerateUnbilledReportPayload,
  signal?: AbortSignal
) {
  return apiPost<GenerateUnbilledReportResponse>(
    'generateUnbilledReport',
    payload as unknown as Record<string, unknown>,
    {},
    { signal }
  );
}

/** Read existing Unbilled_Report sheet from CB (previously generated data) */
export interface ExistingUnbilledReportResponse {
  success: boolean;
  rows: UnbilledReportRow[];
  count: number;
  message?: string;
}

export function fetchUnbilledReport(signal?: AbortSignal) {
  return apiFetch<ExistingUnbilledReportResponse>('getUnbilledReport', undefined, { signal });
}

// ─── Phase 7B #11: Create Invoice ────────────────────────────────────────────

export interface CreateInvoicePayload {
  idempotencyKey: string;
  rows: UnbilledReportRow[];
  client: string;
  sidemark?: string;
  sourceSheetId: string;
}

export interface CreateInvoiceResponse {
  success: boolean;
  invoiceNo?: string;
  invoiceUrl?: string;
  emailStatus?: string;
  grandTotal?: number;
  lineItemCount?: number;
  alreadyProcessed?: boolean;
  warnings?: string[];
  error?: string;
}

export function postCreateInvoice(
  payload: CreateInvoicePayload,
  signal?: AbortSignal
) {
  return apiPost<CreateInvoiceResponse>(
    'createInvoice',
    payload as unknown as Record<string, unknown>,
    {},
    { signal, timeoutMs: API_POST_TIMEOUT_LONG_MS }
  );
}

// ─── Update Billing Row (inline edit from Billing page) ─────────────────────

export interface UpdateBillingRowPayload {
  ledgerRowId: string;
  sidemark?: string;
  description?: string;
  rate?: number;
  qty?: number;
  notes?: string;
}

export interface UpdateBillingRowResponse {
  success: boolean;
  ledgerRowId: string;
  updatedRow: { sidemark?: string; description?: string; rate?: number; qty?: number; total?: number; notes?: string };
  message?: string;
  error?: string;
}

export function postUpdateBillingRow(
  payload: UpdateBillingRowPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<UpdateBillingRowResponse>(
    'updateBillingRow',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Phase 7B #12: Resend Invoice Email ──────────────────────────────────────

export interface ResendInvoiceEmailPayload {
  invoiceNo: string;
  clientSheetId: string;
}

export interface ResendInvoiceEmailResponse {
  success: boolean;
  invoiceNo?: string;
  emailStatus?: string;
  error?: string;
}

export function postResendInvoiceEmail(
  payload: ResendInvoiceEmailPayload,
  signal?: AbortSignal
) {
  return apiPost<ResendInvoiceEmailResponse>(
    'resendInvoiceEmail',
    payload as unknown as Record<string, unknown>,
    {},
    { signal }
  );
}

// ─── Phase 7B #13: Client Onboarding ─────────────────────────────────────────

export interface OnboardClientPayload {
  clientName: string;
  clientEmail: string;
  contactName?: string;
  phone?: string;
  qbCustomerName?: string;
  staxCustomerId?: string;
  paymentTerms?: string;
  freeStorageDays?: number;
  discountStoragePct?: number;
  discountServicesPct?: number;
  enableReceivingBilling?: boolean;
  enableShipmentEmail?: boolean;
  enableNotifications?: boolean;
  autoInspection?: boolean;
  separateBySidemark?: boolean;
  autoCharge?: boolean;
  importInventoryUrl?: string;
  notes?: string;
  /** v38.37.0 — receiving-page banner text */
  shipmentNote?: string;
  parentClient?: string;
  userAction?: 'add_access' | 'skip';  // v33: conflict resolution
}

export interface OnboardClientResponse {
  success: boolean;
  clientName?: string;
  clientSheetId?: string;
  spreadsheetUrl?: string;
  clientFolderId?: string;
  clientFolderUrl?: string;
  photosFolderId?: string;
  invoicesFolderId?: string;
  warnings?: string[];
  error?: string;
  existingUser?: {               // v33: returned when contact email already exists as a user
    email: string;
    clientName: string;
    role: string;
  };
}

export interface ResolveOnboardUserPayload {
  email: string;
  clientName: string;
  clientSheetId: string;
  userAction: 'add_access' | 'skip';
}

export interface ResolveOnboardUserResponse {
  success: boolean;
  action: string;
  error?: string;
}

export function postOnboardClient(
  payload: OnboardClientPayload,
  signal?: AbortSignal
) {
  // Long timeout — onboarding creates spreadsheets, folders, deploys Web App, installs triggers
  return apiPost<OnboardClientResponse>(
    'onboardClient',
    payload as unknown as Record<string, unknown>,
    {},
    { signal, timeoutMs: API_POST_TIMEOUT_LONG_MS }
  );
}

// ─── Finish Setup (recovery for partial onboard) ────────────────────────────

export interface FinishClientSetupResponse {
  success: boolean;
  clientName?: string;
  clientSheetId?: string;
  scriptId?: string;
  webAppUrl?: string;
  deploymentId?: string;
  warnings?: string[];
  message?: string;
  error?: string;
}

/**
 * Re-runs Web App deploy + trigger install for a client that was partially
 * onboarded (e.g. Drive indexing lag caused the initial script ID discovery to fail).
 * Idempotent — safe to call multiple times. Called from the "Finish Setup" button
 * on client cards in Settings → Clients.
 */
export function postFinishClientSetup(clientSheetId: string, signal?: AbortSignal) {
  return apiPost<FinishClientSetupResponse>(
    'finishClientSetup',
    { clientSheetId },
    {},
    { signal, timeoutMs: API_POST_TIMEOUT_LONG_MS }
  );
}

export interface RediscoverScriptIdsResponse {
  success: boolean;
  processed: number;
  updated: number;
  skipped: number;
  clients: Array<{ name: string; before: string; after: string; source?: string; error?: string }>;
  error?: string;
}

/**
 * Bulk rediscover + write back Script IDs for every client whose CB SCRIPT ID
 * column is blank or still contains the master template id. Wraps the same
 * logic as per-client Finish Setup. Idempotent. Admin-only.
 */
export function postRediscoverAllScriptIds(signal?: AbortSignal) {
  return apiPost<RediscoverScriptIdsResponse>(
    'rediscoverAllScriptIds',
    {},
    {},
    { signal, timeoutMs: API_POST_TIMEOUT_LONG_MS }
  );
}

/**
 * Authoritative bulk backfill — calls each client's Web App with action=get_script_id.
 * The client's bound script runs ScriptApp.getScriptId() in ITS OWN context and
 * returns its real id. Then writes to CB. Can't return wrong ids the way
 * Drive/Settings searches can. Requires RemoteAdmin.gs v1.5.0+ on each client.
 */
export function postBackfillScriptIdsViaWebApp(signal?: AbortSignal) {
  return apiPost<RediscoverScriptIdsResponse & { failed?: number }>(
    'backfillScriptIdsViaWebApp',
    {},
    {},
    { signal, timeoutMs: API_POST_TIMEOUT_LONG_MS }
  );
}

export function postResolveOnboardUser(
  payload: ResolveOnboardUserPayload,
  signal?: AbortSignal
) {
  return apiPost<ResolveOnboardUserResponse>(
    'resolveOnboardUser',
    payload as unknown as Record<string, unknown>,
    {},
    { signal }
  );
}

// ─── Phase 7B #14: Update Client ─────────────────────────────────────────────

export interface UpdateClientPayload {
  spreadsheetId: string;       // Required — identifies which row to update
  clientName?: string;
  clientEmail?: string;
  contactName?: string;
  phone?: string;
  qbCustomerName?: string;
  staxCustomerId?: string;
  paymentTerms?: string;
  freeStorageDays?: number;
  discountStoragePct?: number;
  discountServicesPct?: number;
  enableReceivingBilling?: boolean;
  enableShipmentEmail?: boolean;
  enableNotifications?: boolean;
  autoInspection?: boolean;
  separateBySidemark?: boolean;
  notes?: string;
  /** v38.37.0 — receiving-page banner text */
  shipmentNote?: string;
  active?: boolean;
  folderId?: string;
  photosFolderId?: string;
  invoiceFolderId?: string;
  syncToSheet?: boolean;       // Default true — push to client Settings tab
  parentClient?: string;
}

export interface UpdateClientResponse {
  success: boolean;
  clientName?: string;
  spreadsheetId?: string;
  synced?: boolean;
  warnings?: string[];
  error?: string;
}

export function postUpdateClient(
  payload: UpdateClientPayload,
  signal?: AbortSignal
) {
  return apiPost<UpdateClientResponse>(
    'updateClient',
    payload as unknown as Record<string, unknown>,
    {},
    { signal }
  );
}

// ─── Phase 7B #15: Sync Settings ─────────────────────────────────────────────

export interface SyncSettingsPayload {
  clientSheetIds?: string[];
  syncAll?: boolean;
}

export interface SyncSettingsResponse {
  success: boolean;
  synced?: string[];
  failed?: Array<{ name: string; error: string }>;
  syncedCount?: number;
  failedCount?: number;
  error?: string;
}

export function postSyncSettings(
  payload: SyncSettingsPayload,
  signal?: AbortSignal
) {
  return apiPost<SyncSettingsResponse>(
    'syncSettings',
    payload as unknown as Record<string, unknown>,
    {},
    { signal }
  );
}

// ─── Phase 7B #16: Batch Create Tasks ────────────────────────────────────────

export interface BatchCreateTasksItem {
  itemId: string;
  shipmentNo?: string;
  vendor?: string;
  description?: string;
  location?: string;
  sidemark?: string;
  itemNotes?: string;
}

export interface BatchCreateTasksPayload {
  items: BatchCreateTasksItem[];
  svcCodes: string[];
}

export interface BatchCreateTasksResponse {
  success: boolean;
  created: number;
  skipped: Array<{ itemId: string; svcCode: string; reason: string }>;
  taskIds: string[];
  error?: string;
}

export function postBatchCreateTasks(
  payload: BatchCreateTasksPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<BatchCreateTasksResponse>(
    'batchCreateTasks',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Phase 8A: Maintenance ────────────────────────────────────────────────────

export interface RefreshCachesPayload {
  clientSheetIds?: string[];
}

export interface RefreshCachesResponse {
  success: boolean;
  synced: { name: string; sheetId: string }[];
  failed: { name: string; sheetId: string; error: string }[];
}

export function postRefreshCaches(
  payload: RefreshCachesPayload,
  signal?: AbortSignal
) {
  // Long timeout (5 min) — per-client refresh can be slow on big clients (all 4
  // cache tabs rewritten + rate recalculation). React caller uses per-client loop.
  return apiPost<RefreshCachesResponse>(
    'refreshCaches',
    payload as unknown as Record<string, unknown>,
    {},
    { signal, timeoutMs: API_POST_TIMEOUT_LONG_MS }
  );
}

export interface RunOnClientsPayload {
  functionName: 'updateHeaders' | 'installTriggers' | 'syncAutocompleteDB' | 'sendWelcomeEmail';
  clientSheetIds?: string[];
}

export interface RunOnClientsResult {
  name: string;
  sheetId: string;
  ok: boolean;
  error?: string;
}

export interface RunOnClientsResponse {
  success: boolean;
  functionName: string;
  succeeded: number;
  failed: number;
  results: RunOnClientsResult[];
}

export function postRunOnClients(
  payload: RunOnClientsPayload,
  signal?: AbortSignal
) {
  return apiPost<RunOnClientsResponse>(
    'runOnClients',
    payload as unknown as Record<string, unknown>,
    {},
    { signal }
  );
}

// ─── Phase 7B #17: Start Task ─────────────────────────────────────────────────

export interface StartTaskPayload {
  taskId: string;
  assignedTo?: string;
  forceOverride?: boolean;
}

export interface StartTaskResponse {
  success: boolean;
  noOp?: boolean;
  conflict?: boolean;
  started?: boolean;
  taskId?: string;
  folderUrl?: string;
  pdfCreated?: boolean;
  startedAt?: string;
  assignedTo?: string;
  warnings?: string[];
  message?: string;
  error?: string;
}

export function postStartTask(
  payload: StartTaskPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<StartTaskResponse>(
    'startTask',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Update Task Notes (save-on-blur) ────────────────────────────────────────

export interface UpdateTaskNotesPayload { taskId: string; taskNotes?: string; location?: string; }
export interface UpdateTaskNotesResponse { success: boolean; taskId: string; message?: string; error?: string; }

export function postUpdateTaskNotes(
  payload: UpdateTaskNotesPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<UpdateTaskNotesResponse>(
    'updateTaskNotes',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Update Task Custom Price (admin price override, save-on-blur) ──────────

export interface UpdateTaskCustomPricePayload { taskId: string; customPrice: number | null; }
export interface UpdateTaskCustomPriceResponse { success: boolean; taskId: string; customPrice: number | null; message?: string; error?: string; }

export function postUpdateTaskCustomPrice(
  payload: UpdateTaskCustomPricePayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<UpdateTaskCustomPriceResponse>(
    'updateTaskCustomPrice',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Cancel Task ──────────────────────────────────────────────────────────────

export interface CancelTaskPayload { taskId: string; }
export interface CancelTaskResponse { success: boolean; taskId: string; skipped?: boolean; message?: string; error?: string; }

export function postCancelTask(
  payload: CancelTaskPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<CancelTaskResponse>(
    'cancelTask',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Cancel Repair ────────────────────────────────────────────────────────────

export interface CancelRepairPayload { repairId: string; }
export interface CancelRepairResponse { success: boolean; repairId: string; skipped?: boolean; message?: string; error?: string; }

export function postCancelRepair(
  payload: CancelRepairPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<CancelRepairResponse>(
    'cancelRepair',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Bulk action batch endpoints (v38.9.0) ────────────────────────────────────
// Standardized result contract shared across all 4 new batch endpoints AND all
// loop-based bulk actions (see src/lib/batchLoop.ts). The frontend has exactly
// one result-handling code path for every bulk operation.

export interface BatchMutationResult {
  success: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: Array<{ id: string; reason: string }>;
  errors:  Array<{ id: string; reason: string }>;
  message?: string;
}

export interface BatchCancelTasksPayload     { taskIds: string[] }
export interface BatchCancelRepairsPayload   { repairIds: string[] }
export interface BatchCancelWillCallsPayload { wcNumbers: string[] }
export interface BatchReassignTasksPayload   { taskIds: string[]; assignedTo: string }

export function postBatchCancelTasks(
  payload: BatchCancelTasksPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<BatchMutationResult>(
    'batchCancelTasks',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

export function postBatchCancelRepairs(
  payload: BatchCancelRepairsPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<BatchMutationResult>(
    'batchCancelRepairs',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

export function postBatchCancelWillCalls(
  payload: BatchCancelWillCallsPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<BatchMutationResult>(
    'batchCancelWillCalls',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

export function postBatchReassignTasks(
  payload: BatchReassignTasksPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<BatchMutationResult>(
    'batchReassignTasks',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Update Inventory Item (inline edit, save-on-blur) ──────────────────────

export interface UpdateInventoryItemPayload {
  itemId: string;
  vendor?: string;
  description?: string;
  reference?: string;
  sidemark?: string;
  room?: string;
  location?: string;
  itemClass?: string;
  qty?: number;
  status?: string;
  itemNotes?: string;
}

export interface UpdateInventoryItemResponse {
  success: boolean;
  itemId: string;
  updated?: Record<string, unknown>;
  error?: string;
}

export function postUpdateInventoryItem(
  payload: UpdateInventoryItemPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<UpdateInventoryItemResponse>(
    'updateInventoryItem',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── Claims Write Functions ───────────────────────────────────────────────────

export function postCreateClaim(payload: CreateClaimPayload, signal?: AbortSignal) {
  return apiPost<CreateClaimResponse>(
    'createClaim',
    payload as unknown as Record<string, unknown>,
    undefined,
    { signal }
  );
}

export function postAddClaimItems(payload: AddClaimItemsPayload, signal?: AbortSignal) {
  return apiPost<AddClaimItemsResponse>(
    'addClaimItems',
    payload as unknown as Record<string, unknown>,
    undefined,
    { signal }
  );
}

export function postAddClaimNote(payload: AddClaimNotePayload, signal?: AbortSignal) {
  return apiPost<AddClaimNoteResponse>(
    'addClaimNote',
    payload as unknown as Record<string, unknown>,
    undefined,
    { signal }
  );
}

export function postRequestMoreInfo(payload: RequestMoreInfoPayload, signal?: AbortSignal) {
  return apiPost<RequestMoreInfoResponse>(
    'requestMoreInfo',
    payload as unknown as Record<string, unknown>,
    undefined,
    { signal }
  );
}

export function postSendClaimDenial(payload: SendClaimDenialPayload, signal?: AbortSignal) {
  return apiPost<SendClaimDenialResponse>(
    'sendClaimDenial',
    payload as unknown as Record<string, unknown>,
    undefined,
    { signal }
  );
}

export function postGenerateClaimSettlement(
  payload: GenerateClaimSettlementPayload,
  signal?: AbortSignal
) {
  return apiPost<GenerateClaimSettlementResponse>(
    'generateClaimSettlement',
    payload as unknown as Record<string, unknown>,
    undefined,
    { signal }
  );
}

export function postUploadSignedSettlement(
  payload: UploadSignedSettlementPayload,
  signal?: AbortSignal
) {
  return apiPost<UploadSignedSettlementResponse>(
    'uploadSignedSettlement',
    payload as unknown as Record<string, unknown>,
    undefined,
    { signal }
  );
}

export function postCloseClaim(payload: CloseClaimPayload, signal?: AbortSignal) {
  return apiPost<CloseClaimResponse>(
    'closeClaim',
    payload as unknown as Record<string, unknown>,
    undefined,
    { signal }
  );
}

export function postVoidClaim(payload: VoidClaimPayload, signal?: AbortSignal) {
  return apiPost<VoidClaimResponse>(
    'voidClaim',
    payload as unknown as Record<string, unknown>,
    undefined,
    { signal }
  );
}

export function postReopenClaim(payload: ReopenClaimPayload, signal?: AbortSignal) {
  return apiPost<ReopenClaimResponse>(
    'reopenClaim',
    payload as unknown as Record<string, unknown>,
    undefined,
    { signal }
  );
}

// ─── Update Claim Fields (inline edit from detail panel) ──────────────────────

export interface UpdateClaimPayload {
  claimId: string;
  requestedAmount?: number | null;
  approvedAmount?: number | null;
  coverageType?: string;
  clientSelectedCoverage?: string;
  primaryContactName?: string;
  email?: string;
  phone?: string;
  incidentDate?: string;
  incidentLocation?: string;
  propertyIncidentReference?: string;
  issueDescription?: string;
  decisionExplanation?: string;
}
export interface UpdateClaimResponse { success: boolean; claimId: string; saved?: string[]; message?: string; error?: string; }

export function postUpdateClaim(payload: UpdateClaimPayload, signal?: AbortSignal) {
  return apiPost<UpdateClaimResponse>(
    'updateClaim',
    payload as unknown as Record<string, unknown>,
    undefined,
    { signal }
  );
}

// ─── Test Send Email Types ────────────────────────────────────────────────────

export interface TestSendResult {
  key: string;
  sent: boolean;
  error: string | null;
  usedFallback?: boolean;
}

export interface TestSendClientTemplatesPayload {
  toEmail: string;
  templateKey?: string;
}

export interface TestSendClientTemplatesResponse {
  success: boolean;
  sent: number;
  total: number;
  results: TestSendResult[];
  error?: string;
}

export function postTestSendClientTemplates(
  payload: TestSendClientTemplatesPayload,
  signal?: AbortSignal
) {
  return apiPost<TestSendClientTemplatesResponse>(
    'testSendClientTemplates',
    payload as unknown as Record<string, unknown>,
    undefined,
    { signal }
  );
}

export interface TestSendClaimEmailsPayload {
  toEmail: string;
  templateKey?: string;
}

export interface TestSendClaimEmailsResponse {
  success: boolean;
  sent: number;
  total: number;
  results: TestSendResult[];
  error?: string;
}

export function postTestSendClaimEmails(
  payload: TestSendClaimEmailsPayload,
  signal?: AbortSignal
) {
  return apiPost<TestSendClaimEmailsResponse>(
    'testSendClaimEmails',
    payload as unknown as Record<string, unknown>,
    undefined,
    { signal }
  );
}

// ─── Send Welcome Email to Users (v38.43.0) ──────────────────────────────────

export interface SendWelcomeToUsersPayload {
  userEmails: string[];
}

export interface SendWelcomeToUsersResult {
  email: string;
  ok: boolean;
  reason?: string;
  error?: string;
  sentTo?: string;
  role?: string;
}

export interface SendWelcomeToUsersResponse {
  success: boolean;
  sent: number;
  failed: number;
  total: number;
  results: SendWelcomeToUsersResult[];
  error?: string;
}

/**
 * Batch resend the welcome email to one or more users.
 * Admin-only. Bypasses the dedup guard (explicit resend) but updates the
 * Welcome Sent At column after successful send.
 */
export function postSendWelcomeToUsers(
  payload: SendWelcomeToUsersPayload,
  signal?: AbortSignal
) {
  return apiPost<SendWelcomeToUsersResponse>(
    'sendWelcomeToUsers',
    payload as unknown as Record<string, unknown>,
    undefined,
    { signal }
  );
}

// ─── Template Management (v38.12.0) ──────────────────────────────────────────

export interface EmailTemplate {
  key: string;
  subject: string;
  bodyHtml: string;
  notes: string;
  recipients: string;
  attachDoc: string;
  category: 'email' | 'doc' | 'system';
}

export interface GetEmailTemplatesResponse {
  success: boolean;
  templates: EmailTemplate[];
  error?: string;
}

export function fetchEmailTemplates(signal?: AbortSignal) {
  return apiFetch<GetEmailTemplatesResponse>('getEmailTemplates', undefined, { signal });
}

export interface UpdateEmailTemplatePayload {
  templateKey: string;
  subject?: string;
  bodyHtml?: string;
}

export interface UpdateEmailTemplateResponse {
  success: boolean;
  templateKey: string;
  message?: string;
  error?: string;
}

export function postUpdateEmailTemplate(
  payload: UpdateEmailTemplatePayload,
  signal?: AbortSignal
) {
  return apiPost<UpdateEmailTemplateResponse>(
    'updateEmailTemplate',
    payload as unknown as Record<string, unknown>,
    undefined,
    { signal }
  );
}

export interface SyncTemplatesToClientsResponse {
  success: boolean;
  synced: number;
  failed: number;
  total: number;
  errors: Array<{ client: string; error: string }>;
  message?: string;
}

export function postSyncTemplatesToClients(signal?: AbortSignal) {
  return apiPost<SyncTemplatesToClientsResponse>(
    'syncTemplatesToClients',
    {},
    undefined,
    { signal }
  );
}

// ─── Batch Endpoint (Performance) ──────────────────────────────────────────

/** Lightweight inventory item from batch response */
export interface BatchInventoryItem {
  itemId: string;
  clientSheetId: string;
  qty: number;
  vendor: string;
  description: string;
  itemClass: string;
  location: string;
  sidemark: string;
  room: string;
  shipmentNumber: string;
  receiveDate: string;
  releaseDate: string;
  status: string;
  shipmentFolderUrl?: string;
}

/** Lightweight task from batch response */
export interface BatchTask {
  taskId: string;
  clientSheetId: string;
  type: string;
  status: string;
  itemId: string;
  vendor: string;
  description: string;
  location: string;
  sidemark: string;
  shipmentNumber: string;
  created: string;
  completedAt: string;
  result: string;
  svcCode: string;
  billed: boolean;
  assignedTo: string;
  startedAt: string;
  customPrice?: number;
  taskFolderUrl?: string;
  shipmentFolderUrl?: string;
}

/** Lightweight repair from batch response */
export interface BatchRepair {
  repairId: string;
  clientSheetId: string;
  sourceTaskId: string;
  itemId: string;
  description: string;
  vendor: string;
  status: string;
  quoteAmount: number | null;
  createdDate: string;
  completedDate: string;
  repairVendor: string;
  billed: boolean;
  repairFolderUrl?: string;
  shipmentFolderUrl?: string;
  taskFolderUrl?: string;
}

/** Lightweight will call from batch response */
export interface BatchWillCall {
  wcNumber: string;
  clientSheetId: string;
  status: string;
  pickupParty: string;
  estimatedPickupDate: string;
  createdDate: string;
  itemsCount: number;
  cod: boolean;
  codAmount: number | null;
  wcFolderUrl?: string;
}

/** Lightweight shipment from batch response */
export interface BatchShipment {
  shipmentNumber: string;
  clientSheetId: string;
  receiveDate: string;
  itemCount: number;
  carrier: string;
  trackingNumber: string;
  notes: string;
  folderUrl?: string;
}

/** Lightweight billing row from batch response */
export interface BatchBillingRow {
  ledgerRowId: string;
  clientSheetId: string;
  status: string;
  invoiceNo: string;
  date: string;
  svcCode: string;
  svcName: string;
  itemId: string;
  description: string;
  qty: number | null;
  rate: number | null;
  total: number | null;
  sidemark?: string;
}

export interface BatchBillingSummary {
  unbilled: number;
  invoiced: number;
  billed: number;
  void_count: number;
  totalUnbilled: number;
}

export interface BatchResponse {
  inventory: BatchInventoryItem[];
  tasks: BatchTask[];
  repairs: BatchRepair[];
  willCalls: BatchWillCall[];
  shipments: BatchShipment[];
  billing: BatchBillingRow[];
  billingSummary: BatchBillingSummary;
  counts: {
    inventory: number;
    tasks: number;
    repairs: number;
    willCalls: number;
    shipments: number;
    billing: number;
  };
}

export function fetchBatch(clientSheetId: string, signal?: AbortSignal, noCache?: boolean) {
  const extra: Record<string, string> = { clientSheetId };
  if (noCache) extra.noCache = '1';
  return apiFetch<BatchResponse>('getBatch', extra, { signal });
}

// ─── Dashboard Summary (lightweight cross-client) ─────────────────────────────

export interface SummaryTask {
  taskId: string;
  clientName: string;
  clientSheetId: string;
  itemId: string;
  taskType: string;
  status: string;
  assignedTo: string;
  created: string;
  dueDate: string;
  startedAt: string;
  description: string;
  vendor: string;
  sidemark: string;
  location: string;
  taskFolderUrl?: string;
  shipmentFolderUrl?: string;
}

export interface SummaryRepair {
  repairId: string;
  clientName: string;
  clientSheetId: string;
  itemId: string;
  vendor: string;
  status: string;
  createdDate: string;
  quoteAmount: number | null;
  description: string;
  sidemark: string;
  location: string;
  repairFolderUrl?: string;
  shipmentFolderUrl?: string;
}

export interface SummaryWillCall {
  wcNumber: string;
  clientName: string;
  clientSheetId: string;
  status: string;
  pickupParty: string;
  createdDate: string;
  estPickupDate: string;
  itemCount: number;
  notes: string;
  wcFolderUrl?: string;
  shipmentFolderUrl?: string;
}

export interface BatchSummaryResponse {
  tasks: SummaryTask[];
  repairs: SummaryRepair[];
  willCalls: SummaryWillCall[];
  counts: { tasks: number; repairs: number; willCalls: number };
  summaryVersion: number;
  errors?: { client: string; spreadsheetId: string; error: string }[];
}

export function fetchBatchSummary(signal?: AbortSignal, noCache = false) {
  const extra: Record<string, string> = {};
  if (noCache) extra.noCache = '1';
  return apiFetch<BatchSummaryResponse>('getBatchSummary', extra, { signal });
}

// ─── Fix Missing Folders & Links ─────────────────────────────────────────────

export interface FixMissingFoldersResponse {
  success: boolean;
  fixed: {
    inventory: number;
    tasks: number;
    repairs: number;
    shipments: number;
    willCalls: number;
    wcItems: number;
  };
  total: number;
  message: string;
}

export function postFixMissingFolders(
  clientSheetId: string,
  signal?: AbortSignal
) {
  // Long timeout (5 min) — scanning all sheet tabs on a big client can take a while.
  return apiPost<FixMissingFoldersResponse>(
    'fixMissingFolders',
    { clientSheetId } as unknown as Record<string, unknown>,
    {},
    { signal, timeoutMs: API_POST_TIMEOUT_LONG_MS }
  );
}

// ─── Auto-Generated Item IDs ─────────────────────────────────────────────────

export interface AutoIdSettingResponse {
  enabled: boolean;
}

export interface NextItemIdResponse {
  itemId: string;
}

export interface UpdateAutoIdSettingResponse {
  success: boolean;
  enabled: boolean;
}

/** Check whether auto-generated Item IDs are enabled (reads CB Settings). */
export function fetchAutoIdSetting() {
  return apiFetch<AutoIdSettingResponse>('getAutoIdSetting');
}

/** Atomically allocate the next Item ID from the CB counter. Returns { itemId: "80000" }. */
export function fetchNextItemId() {
  return apiFetch<NextItemIdResponse>('getNextItemId');
}

/** Toggle the AUTO_GENERATE_ITEM_IDS setting on/off (admin-only). */
export function postUpdateAutoIdSetting(enabled: boolean) {
  return apiPost<UpdateAutoIdSettingResponse>(
    'updateAutoIdSetting',
    { enabled }
  );
}

// ─── Supabase Phase 3 — Admin Endpoints ─────────────────────────────────────

export interface BulkSyncResult {
  success: boolean;
  clientsSynced: number;
  totalRows: { inventory: number; tasks: number; repairs: number; will_calls: number; shipments: number; billing: number };
  totalDeleted?: { inventory: number; tasks: number; repairs: number; will_calls: number; shipments: number; billing: number };
  clients: Array<{
    client: string;
    spreadsheetId: string;
    counts: Record<string, number>;
    deleted?: Record<string, number>;
    errors: string[];
  }>;
  /** v38.45.0: Number of inactive clients whose Supabase data was purged */
  inactivePurged?: number;
}

export interface ReconcileResult {
  success: boolean;
  dryRun: boolean;
  clientsChecked: number;
  tablesResynced: number;
  clients: Array<{
    client: string;
    spreadsheetId: string;
    tables: Record<string, { sheetCount: number; supabaseCount: number; drift: boolean; resynced: boolean; error?: string }>;
    error?: string;
  }>;
}

export function postBulkSyncToSupabase(clientSheetId?: string) {
  // Long timeout (5 min) — per-client sync can take 30-60s on big clients
  // (read all sheets + upsert all rows + fetch existing IDs + delete orphans)
  return apiPost<BulkSyncResult>(
    'bulkSyncToSupabase',
    clientSheetId ? { clientSheetId } : {},
    {},
    { timeoutMs: API_POST_TIMEOUT_LONG_MS }
  );
}

/** v38.45.0: Purge Supabase data for all inactive clients. Called after Bulk Sync loop completes. */
export function postPurgeInactiveFromSupabase() {
  return apiPost<{ success: boolean; purgedCount: number; purged: Array<{ name: string; spreadsheetId: string }> }>(
    'purgeInactiveFromSupabase',
    {},
    {},
    { timeoutMs: API_POST_TIMEOUT_LONG_MS }
  );
}

export function postReconcileSupabase(clientSheetId?: string, dryRun = false) {
  return apiPost<ReconcileResult>('reconcileSupabase', { clientSheetId: clientSheetId || '', dryRun });
}

// ─── Move History ───────────────────────────────────────────────────────────

export interface MoveHistoryEntry {
  timestamp: string;
  user: string;
  itemId: string;
  fromLocation: string;
  toLocation: string;
  type?: string;
}

export interface MoveHistoryResponse {
  moves: MoveHistoryEntry[];
}

export function fetchItemMoveHistory(
  itemId: string,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiFetch<MoveHistoryResponse>('getItemMoveHistory', { itemId, clientSheetId }, { signal });
}

// ─── Stax Payments ──────────────────────────────────────────────────────────

export interface StaxInvoice {
  rowIndex: number;
  qbInvoice: string;
  customer: string;
  staxCustomerId: string;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  lineItemsJson: string;
  staxId: string;
  status: string;
  createdAt: string;
  notes: string;
  isTest?: boolean;
  autoCharge?: boolean;
  paymentMethodStatus?: 'has_pm' | 'no_pm' | 'no_customer' | 'unknown';
}

export interface StaxInvoicesResponse {
  invoices: StaxInvoice[];
  count: number;
}

export interface StaxCharge {
  timestamp: string;
  qbInvoice: string;
  staxInvoiceId: string;
  staxCustomerId: string;
  customer: string;
  amount: number;
  status: string;
  txnId: string;
  notes: string;
}

export interface StaxChargeLogResponse {
  charges: StaxCharge[];
  count: number;
}

export interface StaxException {
  timestamp: string;
  qbInvoice: string;
  customer: string;
  staxCustomerId: string;
  amount: number;
  dueDate: string;
  reason: string;
  payLink: string;
  resolved: boolean;
}

export interface StaxExceptionsResponse {
  exceptions: StaxException[];
  count: number;
  unresolvedCount: number;
}

export interface StaxCustomerRow {
  qbName: string;
  staxCompany: string;
  staxName: string;
  staxId: string;
  email: string;
  payMethod: string;
  notes: string;
}

export interface StaxCustomersResponse {
  customers: StaxCustomerRow[];
  count: number;
}

export interface StaxRunLogEntry {
  timestamp: string;
  fn: string;
  summary: string;
  details: string;
}

export interface StaxRunLogResponse {
  entries: StaxRunLogEntry[];
  count: number;
}

export interface StaxConfigResponse {
  config: Record<string, string | boolean>;
}

export function fetchStaxInvoices(signal?: AbortSignal) {
  return apiFetch<StaxInvoicesResponse>('getStaxInvoices', undefined, { signal });
}

export function fetchStaxChargeLog(signal?: AbortSignal) {
  return apiFetch<StaxChargeLogResponse>('getStaxChargeLog', undefined, { signal });
}

export function fetchStaxExceptions(signal?: AbortSignal) {
  return apiFetch<StaxExceptionsResponse>('getStaxExceptions', undefined, { signal });
}

export function fetchStaxCustomers(signal?: AbortSignal) {
  return apiFetch<StaxCustomersResponse>('getStaxCustomers', undefined, { signal });
}

export function fetchStaxRunLog(signal?: AbortSignal) {
  return apiFetch<StaxRunLogResponse>('getStaxRunLog', undefined, { signal });
}

export function fetchStaxConfig(signal?: AbortSignal) {
  return apiFetch<StaxConfigResponse>('getStaxConfig', undefined, { signal });
}

// ─── Stax POST endpoints ───

export interface ImportIIFResponse {
  success: boolean;
  invoicesAdded: number;
  duplicatesSkipped: number;
  exceptionsLogged: number;
  summary: string;
}

export function postImportIIF(fileContent: string, fileName: string) {
  return apiPost<ImportIIFResponse>('importIIF', { fileContent, fileName });
}

export interface ResolveStaxExceptionResponse {
  success: boolean;
  resolvedAt: string;
}

export function postResolveStaxException(params: { qbInvoiceNo?: string; timestamp: string }) {
  return apiPost<ResolveStaxExceptionResponse>('resolveStaxException', params as Record<string, unknown>);
}

export interface UpdateStaxConfigResponse {
  success: boolean;
  key: string;
  value: string;
}

export function postUpdateStaxConfig(key: string, value: string) {
  return apiPost<UpdateStaxConfigResponse>('updateStaxConfig', { key, value });
}

export interface SaveStaxCustomerMappingResponse {
  success: boolean;
  updated: number;
  added: number;
}

export function postSaveStaxCustomerMapping(mappings: Array<{ qbCustomerName: string; staxCustomerId: string }>) {
  return apiPost<SaveStaxCustomerMappingResponse>('saveStaxCustomerMapping', { mappings } as Record<string, unknown>);
}

export interface AutoMatchStaxCustomersResponse {
  success: boolean;
  added: number;
  alreadyExisted: number;
}

export function postAutoMatchStaxCustomers() {
  return apiPost<AutoMatchStaxCustomersResponse>('autoMatchStaxCustomers', {});
}

// ─── Stax Phase 3: Customer Sync ───────────────────────────────────────────

export interface PullStaxCustomersResponse {
  total: number;
  withStaxId: number;
  missingStaxId: number;
  apiErrors: number;
  summary: string;
}

export function postPullStaxCustomers() {
  return apiPost<PullStaxCustomersResponse>('pullStaxCustomers', {});
}

export interface SyncStaxCustomersResponse {
  verified: number;
  hasPayment: number;
  noPayment: number;
  foundByEmail: number;
  notFound: number;
  ambiguous: number;
  noIdentifier: number;
  apiErrors: number;
  companyPushed: number;
  total: number;
}

export function postSyncStaxCustomers() {
  return apiPost<SyncStaxCustomersResponse>('syncStaxCustomers', {});
}

// ─── Stax Phase 4: Financial Operations ─────────────────────────────────────

export interface CreateStaxInvoicesResponse {
  created: number;
  skippedDupe: number;
  skippedNoCustomer: number;
  skippedInvalid: number;
  apiErrors: number;
  total: number;
  summary: string;
}

export function postCreateStaxInvoices(params?: { invoiceNos?: string[] }) {
  return apiPost<CreateStaxInvoicesResponse>('createStaxInvoices', (params || {}) as Record<string, unknown>);
}

export function postStaxRefreshCustomerIds() {
  return apiPost<{ success: boolean; updated: string }>('staxRefreshCustomerIds', {});
}

export interface RunStaxChargesResponse {
  eligible: number;
  paid: number;
  dryRunPassed?: number;
  declined: number;
  noPaymentMethod: number;
  alreadyPaid: number;
  partial: number;
  apiErrors: number;
  testMode?: boolean;
  summary: string;
}

export function postRunStaxCharges(params?: { testMode?: boolean }) {
  return apiPost<RunStaxChargesResponse>('runStaxCharges', (params || {}) as Record<string, unknown>);
}

export interface ChargeSingleInvoiceResponse {
  success: boolean;
  status: string;
  transactionId: string;
  testMode?: boolean;
  message?: string;
  error: string | null;
}

export function postChargeSingleInvoice(params: { qbInvoiceNo?: string; staxInvoiceId?: string; testMode?: boolean }) {
  return apiPost<ChargeSingleInvoiceResponse>('chargeSingleInvoice', params as Record<string, unknown>);
}

// ─── Test Invoice Creation ──────────────────────────────────────────────────

export interface CreateTestInvoiceResponse {
  success: boolean;
  qbInvoiceNo: string;
  customer: string;
  amount: number;
  isTest: true;
  error?: string;
}

export function postResetStaxInvoiceStatus(params: { qbInvoiceNo: string }) {
  return apiPost<{ success: boolean; qbInvoiceNo: string; previousStatus: string; newStatus: string }>('resetStaxInvoiceStatus', params as Record<string, unknown>);
}

export function postToggleAutoCharge(params: { invoiceNos: string[]; autoCharge: boolean }) {
  return apiPost<{ success: boolean; updated: number; autoCharge: boolean; message: string }>('toggleAutoCharge', params as Record<string, unknown>);
}

export function postVoidStaxInvoice(params: { qbInvoiceNo: string; rowIndex?: number }) {
  return apiPost<{ success: boolean; qbInvoiceNo: string; previousStatus: string }>('voidStaxInvoice', params as Record<string, unknown>);
}

export function postUpdateStaxInvoice(params: { qbInvoiceNo: string; dueDate?: string; amount?: number; customer?: string; notes?: string }) {
  return apiPost<{ success: boolean; qbInvoiceNo: string; changed: string[]; message: string }>('updateStaxInvoice', params as Record<string, unknown>);
}

export interface IIFFile {
  id: string;
  name: string;
  size: number;
  lastUpdated: string;
  url: string;
}

export function fetchIIFFiles(signal?: AbortSignal) {
  return apiFetch<{ files: IIFFile[]; count: number; folderId: string; folderName: string }>('listIIFFiles', undefined, { signal });
}

export function postImportIIFFromDrive(params: { fileId: string }) {
  return apiPost<ImportIIFResponse>('importIIFFromDrive', params as Record<string, unknown>);
}

export function postDeleteStaxInvoice(params: { qbInvoiceNo: string; rowIndex?: number }) {
  return apiPost<{ success: boolean; qbInvoiceNo: string; previousStatus: string }>('deleteStaxInvoice', params as Record<string, unknown>);
}

export function postCreateTestInvoice(params: { customer: string; amount: number; qbInvoiceNo?: string; dueDate?: string }) {
  return apiPost<CreateTestInvoiceResponse>('createTestInvoice', params as Record<string, unknown>);
}

export interface SendStaxPayLinksResponse {
  sent: number;
  failed: number;
  total: number;
  summary: string;
}

export function postSendStaxPayLinks() {
  return apiPost<SendStaxPayLinksResponse>('sendStaxPayLinks', {});
}

export interface SendStaxPayLinkResponse {
  success: boolean;
  error: string | null;
}

export function postSendStaxPayLink(params: { qbInvoiceNo?: string; staxInvoiceId?: string }) {
  return apiPost<SendStaxPayLinkResponse>('sendStaxPayLink', params as Record<string, unknown>);
}

// ─── Marketing Campaign Manager ─────────────────────────────────────────────

// Status enums
export type CampaignStatus = 'Draft' | 'Active' | 'Paused' | 'Complete';
export type CampaignType = 'Blast' | 'Sequence';
export type ContactStatus = 'Pending' | 'Client' | 'Suppressed';
export type CampaignContactStatus = 'Pending' | 'Sent' | 'Follow-Up Scheduled' | 'Replied' | 'Bounced' | 'Unsubscribed' | 'Exhausted' | 'Complete';
export type LogResult = 'Success' | 'Failed' | 'Skipped';

export interface MarketingCampaign {
  campaignId: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  priority: number;
  targetType: string;
  targetValue: string;
  enrollmentMode: string;
  initialTemplate: string;
  followUp1Template: string;
  followUp2Template: string;
  followUp3Template: string;
  maxFollowUps: number;
  followUpIntervalDays: number;
  dailySendLimit: number;
  sendWindowStart: number;
  sendWindowEnd: number;
  startDate: string | null;
  endDate: string | null;
  testMode: boolean;
  testRecipient: string;
  createdDate: string;
  lastRunDate: string | null;
  validationStatus: string;
  validationNotes: string;
  lastError: string;
  totalSent: number;
  totalReplied: number;
  totalBounced: number;
  totalUnsubscribed: number;
  totalConverted: number;
  notes: string;
  custom1: string;
  custom2: string;
  custom3: string;
}

export interface MarketingContact {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  status: ContactStatus;
  existingClient: boolean;
  campaignTag: string;
  dateAdded: string;
  addedBy: string;
  source: string;
  lastCampaignDate: string | null;
  replied: boolean;
  converted: boolean;
  bounced: boolean;
  unsubscribed: boolean;
  suppressed: boolean;
  suppressionReason: string;
  suppressionDate: string | null;
  manualReleaseNote: string;
  notes: string;
}

export interface CampaignContact {
  campaignId: string;
  campaignName: string;
  email: string;
  contactName: string;
  campaignType: CampaignType;
  status: CampaignContactStatus;
  currentStep: string;
  followUpCount: number;
  lastContactDate: string | null;
  nextFollowUpDate: string | null;
  lastAttemptDate: string | null;
  replied: boolean;
  bounced: boolean;
  unsubscribed: boolean;
  converted: boolean;
  suppressed: boolean;
  suppressionReason: string;
  dateEntered: string;
  dateCompleted: string | null;
  completedReason: string;
}

export interface MarketingTemplate {
  name: string;
  subject: string;
  previewText: string;
  htmlBody: string;
  version: string;
  type?: string;
  active?: boolean;
}

export interface CampaignLogEntry {
  timestamp: string;
  campaignId: string;
  campaignName: string;
  email: string;
  contactName: string;
  company: string;
  templateName: string;
  emailStep: string;
  subject: string;
  result: LogResult;
  errorMessage: string;
  testModeUsed: boolean;
}

export interface SuppressionLogEntry {
  timestamp: string;
  email: string;
  firstName: string;
  company: string;
  reason: string;
  triggeredBy: string;
}

export interface MarketingSettings {
  dailyDigestEmail: string;
  bookingUrl: string;
  unsubscribeBaseUrl: string;
  senderName: string;
  senderPhone: string;
  senderEmail: string;
  sendFromEmail: string;
  websiteUrl: string;
}

export interface DashboardCampaignRow {
  campaignId: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  priority: number;
  enrolled: number;
  sent: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
  converted: number;
  pending: number;
  exhausted: number;
  lastRunDate: string | null;
}

export interface DashboardStats {
  totalContacts: number;
  activeLeads: number;
  existingClients: number;
  suppressed: number;
  activeCampaigns: number;
  gmailQuotaRemaining: number;
  campaigns: DashboardCampaignRow[];
  globalTotals: {
    sent: number;
    replied: number;
    bounced: number;
    unsubscribed: number;
    converted: number;
  };
}

// Response wrappers
export interface MarketingDashboardResponse { success: boolean; data: DashboardStats }
export interface MarketingCampaignsResponse { success: boolean; data: { campaigns: MarketingCampaign[] } }
export interface MarketingCampaignDetailResponse {
  success: boolean;
  data: {
    campaign: MarketingCampaign;
    contacts: CampaignContact[];
    stats: { enrolled: number; pending: number; sent: number; replied: number; bounced: number; unsubscribed: number; exhausted: number; converted: number };
  };
}
export interface MarketingContactsResponse {
  success: boolean;
  data: { contacts: MarketingContact[]; total: number; page: number; pageSize: number };
}
export interface MarketingContactDetailResponse {
  success: boolean;
  data: { contact: MarketingContact; campaignHistory: CampaignContact[] };
}
export interface MarketingTemplatesResponse { success: boolean; data: { templates: MarketingTemplate[] } }
export interface MarketingCampaignLogsResponse {
  success: boolean;
  data: { logs: CampaignLogEntry[]; total: number; page: number; pageSize: number };
}
export interface MarketingSuppressionLogsResponse {
  success: boolean;
  data: { logs: SuppressionLogEntry[]; total: number; page: number; pageSize: number };
}
export interface MarketingSettingsResponse { success: boolean; data: MarketingSettings }

// Fetch functions
export function fetchMarketingDashboard(signal?: AbortSignal) {
  return apiFetch<MarketingDashboardResponse>('getMarketingDashboard', undefined, { signal });
}

export function fetchMarketingCampaigns(signal?: AbortSignal, status?: string) {
  const extra = status ? { status } : undefined;
  return apiFetch<MarketingCampaignsResponse>('getMarketingCampaigns', extra, { signal });
}

export function fetchMarketingCampaignDetail(campaignId: string, signal?: AbortSignal) {
  return apiFetch<MarketingCampaignDetailResponse>('getMarketingCampaignDetail', { campaignId }, { signal });
}

export function fetchMarketingContacts(signal?: AbortSignal, params?: { status?: string; search?: string; page?: string; pageSize?: string }) {
  return apiFetch<MarketingContactsResponse>('getMarketingContacts', params, { signal });
}

export function fetchMarketingContactDetail(email: string, signal?: AbortSignal) {
  return apiFetch<MarketingContactDetailResponse>('getMarketingContactDetail', { email }, { signal });
}

export function fetchMarketingTemplates(signal?: AbortSignal) {
  return apiFetch<MarketingTemplatesResponse>('getMarketingTemplates', undefined, { signal });
}

export function fetchMarketingLogs(signal?: AbortSignal, params?: { logType?: string; campaignId?: string; result?: string; startDate?: string; endDate?: string; page?: string; pageSize?: string }) {
  return apiFetch<MarketingCampaignLogsResponse>('getMarketingLogs', params, { signal });
}

export function fetchMarketingSuppressionLogs(signal?: AbortSignal, params?: { logType?: string; page?: string; pageSize?: string }) {
  return apiFetch<MarketingSuppressionLogsResponse>('getMarketingLogs', { logType: 'suppression', ...params }, { signal });
}

export function fetchMarketingSettings(signal?: AbortSignal) {
  return apiFetch<MarketingSettingsResponse>('getMarketingSettings', undefined, { signal });
}

// ─── Marketing POST functions (Phase 4) ─────────────────────────────────────

export interface MarketingWriteResponse {
  success: boolean;
  message?: string;
  error?: string;
}

// Campaign CRUD
export interface CreateCampaignPayload {
  name: string;
  type?: CampaignType;
  priority?: number;
  targetType?: string;
  targetValue?: string;
  enrollment?: string;
  tplInitial?: string;
  tplFU1?: string;
  tplFU2?: string;
  tplFU3?: string;
  maxFU?: number;
  interval?: number;
  dailyLimit?: number;
  sendStart?: number;
  sendEnd?: number;
  testMode?: boolean;
  testRecipient?: string;
  notes?: string;
  custom1?: string;
  custom2?: string;
  custom3?: string;
}

export function postCreateMarketingCampaign(payload: CreateCampaignPayload) {
  return apiPost<MarketingWriteResponse & { campaignId?: string }>('createMarketingCampaign', payload as unknown as Record<string, unknown>);
}

export function postUpdateMarketingCampaign(payload: { campaignId: string } & Partial<CreateCampaignPayload>) {
  return apiPost<MarketingWriteResponse>('updateMarketingCampaign', payload as unknown as Record<string, unknown>);
}

export function postActivateCampaign(campaignId: string) {
  return apiPost<MarketingWriteResponse>('activateCampaign', { campaignId });
}

export function postPauseCampaign(campaignId: string) {
  return apiPost<MarketingWriteResponse>('pauseCampaign', { campaignId });
}

export function postCompleteCampaign(campaignId: string) {
  return apiPost<MarketingWriteResponse>('completeCampaign', { campaignId });
}

export function postRunCampaignNow(campaignId: string) {
  return apiPost<MarketingWriteResponse & { sent?: number; skipped?: number; errors?: number }>('runCampaignNow', { campaignId });
}

export function postDeleteCampaign(campaignId: string) {
  return apiPost<MarketingWriteResponse>('deleteCampaign', { campaignId });
}

// Contact CRUD
export interface CreateContactPayload {
  email: string;
  firstName: string;
  lastName: string;
  company?: string;
  status?: ContactStatus;
  existingClient?: boolean;
  campaignTag?: string;
  source?: string;
  notes?: string;
}

export function postCreateMarketingContact(payload: CreateContactPayload) {
  return apiPost<MarketingWriteResponse>('createMarketingContact', payload as unknown as Record<string, unknown>);
}

export function postImportMarketingContacts(contacts: CreateContactPayload[]) {
  return apiPost<MarketingWriteResponse & { imported?: number; skipped?: number }>('importMarketingContacts', { contacts } as unknown as Record<string, unknown>);
}

export function postUpdateMarketingContact(payload: { email: string } & Partial<CreateContactPayload>) {
  return apiPost<MarketingWriteResponse>('updateMarketingContact', payload as unknown as Record<string, unknown>);
}

export function postSuppressContact(email: string, reason?: string) {
  return apiPost<MarketingWriteResponse>('suppressContact', { email, reason: reason || 'Manual' });
}

export function postUnsuppressContact(email: string, releaseNote?: string) {
  return apiPost<MarketingWriteResponse>('unsuppressContact', { email, releaseNote });
}

// Template CRUD
export interface CreateTemplatePayload {
  name: string;
  subject: string;
  previewText?: string;
  htmlBody: string;
  type?: string;
  active?: boolean;
}

export function postCreateMarketingTemplate(payload: CreateTemplatePayload) {
  return apiPost<MarketingWriteResponse>('createMarketingTemplate', payload as unknown as Record<string, unknown>);
}

export function postUpdateMarketingTemplate(payload: { name: string } & Partial<CreateTemplatePayload>) {
  return apiPost<MarketingWriteResponse>('updateMarketingTemplate', payload as unknown as Record<string, unknown>);
}

// Settings
export function postUpdateMarketingSettings(settings: Partial<MarketingSettings>) {
  return apiPost<MarketingWriteResponse>('updateMarketingSettings', settings as unknown as Record<string, unknown>);
}

// Gmail
export function postSendTestEmail(campaignId: string, recipientEmail?: string) {
  return apiPost<MarketingWriteResponse>('sendTestEmail', { campaignId, recipientEmail });
}

export function postPreviewTemplate(templateName: string) {
  return apiPost<MarketingWriteResponse & { html?: string }>('previewTemplate', { templateName });
}

export function postCheckMarketingInbox() {
  return apiPost<MarketingWriteResponse & { replies?: number; bounces?: number; unsubscribes?: number }>('checkMarketingInbox', {});
}

// ─── Generate Task Work Order PDF (v38.10.0) ─────────────────────────────────
export interface GenerateTaskWorkOrderPayload { taskId: string }
export interface GenerateTaskWorkOrderResponse {
  success: boolean;
  taskId: string;
  pdfCreated: boolean;
  message?: string;
  error?: string;
}

export function postGenerateTaskWorkOrder(
  payload: GenerateTaskWorkOrderPayload,
  clientSheetId: string,
  signal?: AbortSignal
) {
  return apiPost<GenerateTaskWorkOrderResponse>(
    'generateTaskWorkOrder',
    payload as unknown as Record<string, unknown>,
    { clientSheetId },
    { signal }
  );
}

// ─── QBO (QuickBooks Online) Integration ────────────────────────────────────

export interface QboStatus {
  connected: boolean;
  realmId?: string;
  companyName?: string;
  error?: string;
}

export interface QboCustomer {
  id: string;
  displayName: string;
  fullyQualifiedName: string;
  job: boolean;
  parentId?: string | null;
}

export interface QboInvoiceResult {
  strideInvoiceNumber: string;
  success: boolean;
  skipped: boolean;
  warning?: string | null;
  existingQboInvoiceId?: string | null;
  qboInvoiceId?: string | null;
  qboDocNumber?: string | null;
  customerName?: string | null;
  subJobName?: string | null;
  error?: string | null;
}

export interface QboCreateInvoiceResponse {
  success: boolean;
  pushedCount: number;
  skippedCount: number;
  failedCount: number;
  results: QboInvoiceResult[];
  error?: string;
}

export function fetchQboStatus(signal?: AbortSignal) {
  return apiFetch<QboStatus>('qboGetStatus', undefined, { signal });
}

export function fetchQboAuthUrl(signal?: AbortSignal) {
  return apiFetch<{ url: string }>('qboAuthUrl', undefined, { signal });
}

export function fetchQboCustomers(signal?: AbortSignal) {
  return apiFetch<{ customers: QboCustomer[] }>('qboGetCustomers', undefined, { signal });
}

export function postQboCreateInvoice(
  ledgerRowIds: string[],
  forceRePush: boolean = false,
  signal?: AbortSignal
) {
  return apiPost<QboCreateInvoiceResponse>(
    'qboCreateInvoice',
    { ledgerRowIds, forceRePush } as unknown as Record<string, unknown>,
    {},
    { signal, timeoutMs: API_POST_TIMEOUT_LONG_MS }
  );
}

export function postQboDisconnect(signal?: AbortSignal) {
  return apiPost<{ success: boolean }>(
    'qboDisconnect',
    {} as Record<string, unknown>,
    {},
    { signal }
  );
}

export function postUpdateQboStatus(
  ledgerRowIds: string[],
  qboStatus: string,
  clearInvoiceId: boolean = false,
  signal?: AbortSignal
) {
  return apiPost<{ success: boolean; updatedCount: number }>(
    'updateQboStatus',
    { ledgerRowIds, qboStatus, clearInvoiceId } as unknown as Record<string, unknown>,
    {},
    { signal }
  );
}
