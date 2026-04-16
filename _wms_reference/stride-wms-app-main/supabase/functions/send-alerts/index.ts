import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { isValidEmail, resolvePlatformEmailDefaults } from "../_shared/platformEmail.ts";
import { resolvePlatformInboundReplyConfig, resolveTenantReplyToRoutingAddress } from "../_shared/inboundReplyRouting.ts";
import { sendPlatformEmail } from "../_shared/emailProviders.ts";
import { renderBrandedEmail, resolvePlatformEmailWrapperTemplate } from "../_shared/emailBranding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AlertPayload {
  alert_id: string;
  tenant_id: string;
  alert_type: string;
  entity_type: string;
  entity_id: string;
  recipient_emails: string[];
  subject: string;
  body_html?: string;
  body_text?: string;
}

// =============================================================================
// EMAIL VALIDATION & UTILS
// =============================================================================

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmails(emails: string[]): string[] {
  const cleaned = emails
    .map(e => (e || '').trim().toLowerCase())
    .filter(e => EMAIL_REGEX.test(e));
  return [...new Set(cleaned)];
}

function parseCommaEmails(str: string | null | undefined): string[] {
  if (!str) return [];
  return str.split(',').map(e => e.trim().toLowerCase()).filter(e => EMAIL_REGEX.test(e));
}

function escapeHtml(input: string): string {
  return (input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateValue(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTimeValue(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatCurrencyValue(value: number | string | null | undefined): string {
  if (value == null) return '';
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return '';
  return `$${parsed.toFixed(2)}`;
}

const SHIPMENT_EXCEPTION_LABELS: Record<string, string> = {
  SHORTAGE: 'Shortage',
  OVERAGE: 'Overage',
  MIS_SHIP: 'Mis-Ship',
  DAMAGE: 'Damage',
  WET: 'Wet',
  OPEN: 'Open',
  MISSING_DOCS: 'Missing Docs',
  CRUSHED_TORN_CARTONS: 'Crushed/Torn Cartons',
  OTHER: 'Other',
};

const ALERT_TRIGGER_ALIASES: Record<string, string[]> = {
  'shipment.received': ['shipment_received'],
  'shipment_received': ['shipment.received'],
  'shipment.completed': ['shipment_completed'],
  'shipment_completed': ['shipment.completed'],
  'shipment.status_changed': ['shipment_status_changed'],
  'shipment_status_changed': ['shipment.status_changed'],
  'task.assigned': ['task_assigned'],
  'task_assigned': ['task.assigned'],
  'task.completed': ['task_completed'],
  'task_completed': ['task.completed'],
  'task.overdue': ['task_overdue'],
  'task_overdue': ['task.overdue'],
  'task.unable_to_complete': ['task_unable_to_complete'],
  'task_unable_to_complete': ['task.unable_to_complete'],
};

function getAlertTriggerCandidates(alertType: string): string[] {
  const candidates = [alertType, ...(ALERT_TRIGGER_ALIASES[alertType] || [])];
  return [...new Set(candidates.filter(Boolean))];
}

function pickPreferredTriggerMatch<T extends Record<string, unknown>>(
  rows: T[] | null | undefined,
  candidates: string[],
  field: keyof T,
): T | null {
  if (!rows || rows.length === 0) return null;
  for (const candidate of candidates) {
    const match = rows.find((row) => String(row[field] || '') === candidate);
    if (match) return match;
  }
  return rows[0] || null;
}

// =============================================================================
// RECIPIENT RESOLUTION (Hardened)
// =============================================================================

/**
 * Get manager/admin emails via direct join: user_roles → roles + users
 * This avoids the fragile nested embed that was causing empty results.
 */
async function getManagerEmails(supabase: any, tenantId: string): Promise<string[]> {
  try {
    // Step 1: Get role IDs for admin/manager/billing_manager
    const { data: roles, error: rolesError } = await supabase
      .from('roles')
      .select('id, name')
      .in('name', ['admin', 'manager', 'billing_manager'])
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);

    if (rolesError || !roles || roles.length === 0) {
      console.warn('[getManagerEmails] No admin/manager/billing_manager roles found for tenant:', tenantId, rolesError);
      return [];
    }

    const roleIds = roles.map((r: any) => r.id);

    // Step 2: Get user IDs with those roles
    const { data: userRoles, error: urError } = await supabase
      .from('user_roles')
      .select('user_id')
      .in('role_id', roleIds)
      .is('deleted_at', null);

    if (urError || !userRoles || userRoles.length === 0) {
      console.warn('[getManagerEmails] No user_roles found for roles:', roleIds, urError);
      return [];
    }

    const userIds = [...new Set(userRoles.map((ur: any) => ur.user_id))];

    // Step 3: Get emails for those users
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('email')
      .in('id', userIds)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);

    if (usersError || !users) {
      console.warn('[getManagerEmails] Failed to fetch user emails:', usersError);
      return [];
    }

    const emails = users.map((u: any) => u.email).filter(Boolean);
    console.log(`[getManagerEmails] Found ${emails.length} manager/admin emails for tenant ${tenantId}`);
    return cleanEmails(emails);
  } catch (err) {
    console.error('[getManagerEmails] Unexpected error:', err);
    return [];
  }
}

/**
 * Get office_alert_emails from tenant_company_settings (comma-separated field)
 */
async function getOfficeAlertEmails(supabase: any, tenantId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('tenant_company_settings')
      .select('office_alert_emails')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error || !data) return [];
    return parseCommaEmails(data.office_alert_emails);
  } catch {
    return [];
  }
}

/**
 * Get per-alert send_to override from communication_alerts (if configured)
 */
async function getAlertSendToEmails(supabase: any, tenantId: string, alertType: string): Promise<string[]> {
  try {
    const candidates = getAlertTriggerCandidates(alertType);
    const { data, error } = await supabase
      .from('communication_alerts')
      .select('trigger_event, channels')
      .eq('tenant_id', tenantId)
      .in('trigger_event', candidates)
      .eq('is_enabled', true)
      .limit(candidates.length);

    if (error || !data || data.length === 0) return [];

    const alertRow = pickPreferredTriggerMatch(data, candidates, 'trigger_event');
    if (!alertRow) return [];

    // Check for send_to_emails inside channels JSON
    const channels = alertRow.channels as Record<string, any>;
    if (channels && channels.send_to_emails) {
      if (typeof channels.send_to_emails === 'string') {
        return parseCommaEmails(channels.send_to_emails);
      }
      if (Array.isArray(channels.send_to_emails)) {
        return cleanEmails(channels.send_to_emails);
      }
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * Resolve recipients with deterministic precedence:
 * 1) alert_queue.recipient_emails (explicit per-alert)
 * 2) communication_alerts.channels.send_to_emails (per-trigger override)
 * 3) tenant_company_settings.office_alert_emails (tenant-wide fallback)
 * 4) getManagerEmails() (role-based fallback)
 */
async function resolveRecipients(
  supabase: any,
  tenantId: string,
  alertType: string,
  queueRecipients: string[] | null
): Promise<{ emails: string[]; source: string }> {
  // 1) Explicit recipients from alert_queue
  if (queueRecipients && queueRecipients.length > 0) {
    const cleaned = cleanEmails(queueRecipients);
    if (cleaned.length > 0) {
      return { emails: cleaned, source: 'alert_queue.recipient_emails' };
    }
  }

  // 2) Per-alert send_to override from communication_alerts
  const alertSendTo = await getAlertSendToEmails(supabase, tenantId, alertType);
  if (alertSendTo.length > 0) {
    return { emails: alertSendTo, source: 'communication_alerts.send_to_emails' };
  }

  // 3) Tenant office_alert_emails setting
  const officeEmails = await getOfficeAlertEmails(supabase, tenantId);
  if (officeEmails.length > 0) {
    return { emails: officeEmails, source: 'tenant_company_settings.office_alert_emails' };
  }

  // 4) Manager/admin role-based fallback
  const managerEmails = await getManagerEmails(supabase, tenantId);
  if (managerEmails.length > 0) {
    return { emails: managerEmails, source: 'getManagerEmails (role-based)' };
  }

  return { emails: [], source: 'none' };
}

// =============================================================================
// CATALOG AUDIENCE LOOKUP
// =============================================================================

type Audience = 'internal' | 'client' | 'both';

async function getCatalogAudience(
  supabase: any,
  triggerEvent: string
): Promise<Audience> {
  try {
    const candidates = getAlertTriggerCandidates(triggerEvent);
    const { data, error } = await supabase
      .from('communication_trigger_catalog')
      .select('key, audience')
      .in('key', candidates)
      .eq('is_active', true)
      .limit(candidates.length);

    if (error || !data || data.length === 0) {
      // If trigger not in catalog, default to internal (safe default)
      return 'internal';
    }

    const matched = pickPreferredTriggerMatch(data, candidates, 'key');
    const audience = matched?.audience as string | undefined;
    if (audience === 'client' || audience === 'both') {
      return audience;
    }
    return 'internal';
  } catch {
    return 'internal';
  }
}

// =============================================================================
// ENTITY → ACCOUNT CONTEXT RESOLUTION
// =============================================================================

interface AccountContext {
  accountId: string;
  accountName: string;
}

async function getAccountContext(
  supabase: any,
  entityType: string,
  entityId: string,
  tenantId: string
): Promise<AccountContext | null> {
  try {
    // Map entity_type to table + join path
    const entityTableMap: Record<string, { table: string; accountJoin?: boolean }> = {
      shipment: { table: 'shipments', accountJoin: true },
      item: { table: 'items', accountJoin: true },
      task: { table: 'tasks', accountJoin: true },
      invoice: { table: 'invoices', accountJoin: true },
      release: { table: 'releases', accountJoin: true },
      claim: { table: 'claims', accountJoin: true },
      repair_quote: { table: 'repair_quotes', accountJoin: true },
      billing_event: { table: 'billing_events', accountJoin: true },
    };

    const mapping = entityTableMap[entityType];
    if (!mapping) {
      console.log(`[getAccountContext] NO_ACCOUNT_CONTEXT: unknown entity_type "${entityType}"`);
      return null;
    }

    const { data, error } = await supabase
      .from(mapping.table)
      .select('account_id, account:accounts(id, account_name)')
      .eq('id', entityId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error || !data) {
      console.log(`[getAccountContext] NO_ACCOUNT_CONTEXT: entity ${entityType}/${entityId} not found or no tenant match`);
      return null;
    }

    if (!data.account_id) {
      console.log(`[getAccountContext] NO_ACCOUNT_CONTEXT: entity ${entityType}/${entityId} has no account_id`);
      return null;
    }

    const accountName = data.account?.account_name || '';
    return {
      accountId: data.account_id,
      accountName,
    };
  } catch (err) {
    console.error(`[getAccountContext] NO_ACCOUNT_CONTEXT: unexpected error for ${entityType}/${entityId}:`, err);
    return null;
  }
}

// =============================================================================
// CLIENT RECIPIENT RESOLUTION
// =============================================================================

async function resolveClientRecipients(
  supabase: any,
  tenantId: string,
  accountId: string,
  accountName: string
): Promise<{ emails: string[]; source: string }> {
  const normalizedAccountName = (accountName || '').trim().toLowerCase();

  if (!normalizedAccountName) {
    console.log(`[resolveClientRecipients] NO_CLIENT_RECIPIENTS: account_name is empty for account ${accountId}`);
    return { emails: [], source: 'none' };
  }

  // Step 1: Query client_contacts by tenant + is_active, filter by normalized account_name
  try {
    const { data: contacts, error } = await supabase
      .from('client_contacts')
      .select('email, account_name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    if (!error && contacts && contacts.length > 0) {
      // Case-insensitive trim match on account_name (exact match, no fuzzy/ILIKE)
      const matched = contacts
        .filter((c: any) => (c.account_name || '').trim().toLowerCase() === normalizedAccountName)
        .map((c: any) => c.email)
        .filter(Boolean);

      const cleaned = cleanEmails(matched);
      if (cleaned.length > 0) {
        return { emails: cleaned, source: 'client_contacts (account_name match)' };
      }
    }
  } catch (err) {
    console.warn('[resolveClientRecipients] client_contacts lookup failed:', err);
  }

  // Step 2: Fallback to accounts.alerts_contact_email
  try {
    const { data: account } = await supabase
      .from('accounts')
      .select('alerts_contact_email')
      .eq('id', accountId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (account?.alerts_contact_email) {
      const cleaned = cleanEmails(parseCommaEmails(account.alerts_contact_email));
      if (cleaned.length > 0) {
        return { emails: cleaned, source: 'accounts.alerts_contact_email' };
      }
    }
  } catch (err) {
    console.warn('[resolveClientRecipients] accounts fallback failed:', err);
  }

  console.log(`[resolveClientRecipients] NO_CLIENT_RECIPIENTS: no client recipients found for account="${accountName}" (${accountId})`);
  return { emails: [], source: 'none' };
}

// =============================================================================
// ENTITY DATA & TEMPLATES (unchanged logic, extracted for clarity)
// =============================================================================

async function getAccountContactEmail(supabase: any, accountId: string): Promise<string | null> {
  const { data } = await supabase
    .from('accounts')
    .select('primary_contact_email, alerts_contact_email')
    .eq('id', accountId)
    .single();
  
  return data?.alerts_contact_email || data?.primary_contact_email || null;
}

async function getTenantBranding(supabase: any, tenantId: string, fallbackOrigin?: string): Promise<{
  logoUrl: string | null;
  companyName: string | null;
  supportEmail: string | null;
  portalBaseUrl: string | null;
  primaryColor: string;
  termsUrl: string | null;
  privacyUrl: string | null;
  companyAddress: string | null;
}> {
  try {
    const { data: brandSettings } = await supabase
      .from('communication_brand_settings')
      .select('brand_logo_url, brand_primary_color, brand_support_email, portal_base_url')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const { data: settings } = await supabase
      .from('tenant_company_settings')
      .select('logo_url, company_name, company_address, terms_url, privacy_url, app_base_url')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const { data: tenant } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .single();

    return {
      // Source logo from communication_brand_settings first, then fall back to tenant_company_settings
      logoUrl: brandSettings?.brand_logo_url || settings?.logo_url || null,
      companyName: settings?.company_name || tenant?.name || 'Warehouse System',
      supportEmail: brandSettings?.brand_support_email || null,
      portalBaseUrl: brandSettings?.portal_base_url || settings?.app_base_url || fallbackOrigin || null,
      primaryColor: brandSettings?.brand_primary_color || '#FD5A2A',
      termsUrl: settings?.terms_url || null,
      privacyUrl: settings?.privacy_url || null,
      companyAddress: settings?.company_address || null,
    };
  } catch {
    return { logoUrl: null, companyName: 'Warehouse System', supportEmail: null, portalBaseUrl: fallbackOrigin || null, primaryColor: '#FD5A2A', termsUrl: null, privacyUrl: null, companyAddress: null };
  }
}

// Replace {{variable}}, [[variable]], and {variable} syntax
// Single-brace {variable} is matched ONLY when not preceded by another { (avoids clobbering {{)
function replaceTemplateVariables(html: string, variables: Record<string, string>): string {
  const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let result = html;
  for (const [key, value] of Object.entries(variables)) {
    const safeKey = escapeRegex(key);
    const safeValue = value || '';
    // Double braces first
    result = result.replace(new RegExp(`\\{\\{${safeKey}\\}\\}`, 'g'), safeValue);
    // Square brackets
    result = result.replace(new RegExp(`\\[\\[${safeKey}\\]\\]`, 'g'), safeValue);
    // Single braces (negative lookbehind for { and lookahead for })
    result = result.replace(new RegExp(`(?<!\\{)\\{${safeKey}\\}(?!\\})`, 'g'), safeValue);
  }
  return result;
}

async function generateItemsTableHtml(supabase: any, itemIds: string[]): Promise<string> {
  if (!itemIds || itemIds.length === 0) return '<p style="color:#6b7280;font-size:14px;text-align:center;">No items</p>';
  
  const { data: items } = await supabase
    .from('items')
    .select('item_code, description, vendor, current_location')
    .in('id', itemIds);
  
  if (!items || items.length === 0) return '<p style="color:#6b7280;font-size:14px;text-align:center;">No items found</p>';
  
  const rows = items.map((item: any, index: number) => `
    <tr style="background-color:${index % 2 === 0 ? '#ffffff' : '#f9fafb'};">
      <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;font-weight:500;color:#111111;">${item.item_code || 'N/A'}</td>
      <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;color:#374151;">${item.description || 'N/A'}</td>
      <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${item.vendor || 'N/A'}</td>
      <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${item.current_location || 'N/A'}</td>
    </tr>
  `).join('');
  
  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
      <thead>
        <tr style="background-color:#111111;">
          <th style="padding:14px 16px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;letter-spacing:0.3px;">Item ID</th>
          <th style="padding:14px 16px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;letter-spacing:0.3px;">Description</th>
          <th style="padding:14px 16px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;letter-spacing:0.3px;">Vendor</th>
          <th style="padding:14px 16px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;letter-spacing:0.3px;">Location</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

async function generateItemsListText(supabase: any, itemIds: string[]): Promise<string> {
  if (!itemIds || itemIds.length === 0) return 'No items';
  
  const { data: items } = await supabase
    .from('items')
    .select('item_code, description')
    .in('id', itemIds);
  
  if (!items || items.length === 0) return 'No items found';
  
  return items.map((item: any) => `• ${item.item_code}: ${item.description || 'N/A'}`).join('\n');
}

async function generateItemsListHtml(supabase: any, itemIds: string[]): Promise<string> {
  if (!itemIds || itemIds.length === 0) {
    return '<p style="color:#6b7280;font-size:14px;text-align:center;">No items</p>';
  }

  const { data: items } = await supabase
    .from('items')
    .select('item_code, description, vendor, current_location')
    .in('id', itemIds);

  if (!items || items.length === 0) {
    return '<p style="color:#6b7280;font-size:14px;text-align:center;">No items found</p>';
  }

  const cards = items.map((item: any) => {
    const code = escapeHtml(item.item_code || 'N/A');
    const description = escapeHtml(item.description || 'N/A');
    const vendor = escapeHtml(item.vendor || 'N/A');
    const location = escapeHtml(item.current_location || 'N/A');
    return `
      <div style="padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;margin-bottom:8px;">
        <div style="font-size:13px;font-weight:700;color:#111827;">${code}</div>
        <div style="font-size:13px;color:#374151;margin-top:2px;">${description}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:2px;">Vendor: ${vendor}</div>
        <div style="font-size:12px;color:#6b7280;">Location: ${location}</div>
      </div>
    `;
  }).join('');

  return `<div style="margin:12px 0;">${cards}</div>`;
}

interface ShipmentLineTemplateRow {
  item_id?: string | null;
  expected_quantity?: number | null;
  actual_quantity?: number | null;
  expected_description?: string | null;
  expected_vendor?: string | null;
  expected_sidemark?: string | null;
}

function generateShipmentLineTableHtml(rows: ShipmentLineTemplateRow[]): string {
  if (!rows || rows.length === 0) {
    return '<p style="color:#6b7280;font-size:14px;text-align:center;">No items</p>';
  }

  const bodyRows = rows.map((row, index) => {
    const description = escapeHtml(row.expected_description || 'Shipment line item');
    const vendor = escapeHtml(row.expected_vendor || 'N/A');
    const sidemark = escapeHtml(row.expected_sidemark || 'N/A');
    const qty = String(row.actual_quantity ?? row.expected_quantity ?? 0);

    return `
      <tr style="background-color:${index % 2 === 0 ? '#ffffff' : '#f9fafb'};">
        <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;font-weight:500;color:#111111;">${description}</td>
        <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;color:#374151;">${vendor}</td>
        <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${sidemark}</td>
        <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;color:#6b7280;text-align:right;">${qty}</td>
      </tr>
    `;
  }).join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
      <thead>
        <tr style="background-color:#111111;">
          <th style="padding:14px 16px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;letter-spacing:0.3px;">Description</th>
          <th style="padding:14px 16px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;letter-spacing:0.3px;">Vendor</th>
          <th style="padding:14px 16px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;letter-spacing:0.3px;">Sidemark</th>
          <th style="padding:14px 16px;text-align:right;font-weight:600;color:#ffffff;font-size:13px;letter-spacing:0.3px;">Qty</th>
        </tr>
      </thead>
      <tbody>
        ${bodyRows}
      </tbody>
    </table>
  `;
}

function generateShipmentLineListText(rows: ShipmentLineTemplateRow[]): string {
  if (!rows || rows.length === 0) return 'No items';
  return rows
    .map((row) => {
      const description = row.expected_description || 'Shipment line item';
      const vendor = row.expected_vendor || 'N/A';
      const sidemark = row.expected_sidemark || 'N/A';
      const qty = row.actual_quantity ?? row.expected_quantity ?? 0;
      return `• ${description} — Vendor: ${vendor}; Sidemark: ${sidemark}; Qty: ${qty}`;
    })
    .join('\n');
}

// ── INSPECTION FINDINGS TABLE ──
async function generateInspectionFindingsTableHtml(supabase: any, itemIds: string[]): Promise<string> {
  if (!itemIds || itemIds.length === 0) return '<p style="color:#6b7280;font-size:14px;">No inspection details available.</p>';

  const { data: items } = await supabase
    .from('items')
    .select('item_code, description, inspection_status, inspection_photos')
    .in('id', itemIds);

  if (!items || items.length === 0) return '<p style="color:#6b7280;font-size:14px;">No inspection details available.</p>';

  const rows = items.map((item: any, index: number) => {
    const photosCount = Array.isArray(item.inspection_photos) ? item.inspection_photos.length : 0;
    return `
    <tr style="background-color:${index % 2 === 0 ? '#ffffff' : '#f9fafb'};">
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:500;color:#111827;">${item.item_code || 'N/A'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#374151;">${item.description || 'N/A'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${item.inspection_status || 'Pending'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#6b7280;text-align:center;">${photosCount}</td>
    </tr>`;
  }).join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0;border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
      <thead>
        <tr style="background-color:#111827;">
          <th style="padding:10px 14px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;">Item</th>
          <th style="padding:10px 14px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;">Description</th>
          <th style="padding:10px 14px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;">Condition</th>
          <th style="padding:10px 14px;text-align:center;font-weight:600;color:#ffffff;font-size:13px;">Photos</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── TASK SERVICES TABLE ──
async function generateTaskServicesTableHtml(supabase: any, taskId: string): Promise<string> {
  if (!taskId) return '<p style="color:#6b7280;font-size:14px;">No services details available.</p>';

  const { data: lines } = await supabase
    .from('task_addon_lines')
    .select('description, quantity, unit_rate, total_amount')
    .eq('task_id', taskId);

  if (!lines || lines.length === 0) return '<p style="color:#6b7280;font-size:14px;">No services details available.</p>';

  const rows = lines.map((line: any, index: number) => `
    <tr style="background-color:${index % 2 === 0 ? '#ffffff' : '#f9fafb'};">
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#111827;">${line.description || 'Service'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#374151;text-align:center;">${line.quantity ?? 1}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#374151;text-align:right;">$${Number(line.unit_rate || 0).toFixed(2)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;text-align:right;">$${Number(line.total_amount || 0).toFixed(2)}</td>
    </tr>`).join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0;border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
      <thead>
        <tr style="background-color:#111827;">
          <th style="padding:10px 14px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;">Service</th>
          <th style="padding:10px 14px;text-align:center;font-weight:600;color:#ffffff;font-size:13px;">Qty</th>
          <th style="padding:10px 14px;text-align:right;font-weight:600;color:#ffffff;font-size:13px;">Rate</th>
          <th style="padding:10px 14px;text-align:right;font-weight:600;color:#ffffff;font-size:13px;">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── REPAIR ACTIONS TABLE ──
async function generateRepairActionsTableHtml(supabase: any, entityId: string, entityType: string): Promise<string> {
  // entityId could be a repair_quote id or an item id
  let quoteId = entityId;

  if (entityType === 'item') {
    // Find the most recent repair quote for this item
    const { data: quote } = await supabase
      .from('repair_quotes')
      .select('id')
      .eq('item_id', entityId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (quote) quoteId = quote.id;
    else return '<p style="color:#6b7280;font-size:14px;">No repair details available.</p>';
  }

  const { data: items } = await supabase
    .from('repair_quote_items')
    .select('item_code, item_description, damage_description, allocated_customer_amount, notes_public')
    .eq('repair_quote_id', quoteId);

  if (!items || items.length === 0) {
    // Fallback: show quote-level data
    const { data: quote } = await supabase
      .from('repair_quotes')
      .select('tech_notes, customer_total, tech_labor_hours, tech_materials_cost')
      .eq('id', quoteId)
      .maybeSingle();

    if (!quote) return '<p style="color:#6b7280;font-size:14px;">No repair details available.</p>';

    return `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0;border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <thead>
          <tr style="background-color:#111827;">
            <th style="padding:10px 14px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;">Description</th>
            <th style="padding:10px 14px;text-align:right;font-weight:600;color:#ffffff;font-size:13px;">Labor Hrs</th>
            <th style="padding:10px 14px;text-align:right;font-weight:600;color:#ffffff;font-size:13px;">Materials</th>
            <th style="padding:10px 14px;text-align:right;font-weight:600;color:#ffffff;font-size:13px;">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#111827;">${quote.tech_notes || 'Repair work'}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#374151;text-align:right;">${quote.tech_labor_hours ?? '—'}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#374151;text-align:right;">${quote.tech_materials_cost != null ? '$' + Number(quote.tech_materials_cost).toFixed(2) : '—'}</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;text-align:right;">${quote.customer_total != null ? '$' + Number(quote.customer_total).toFixed(2) : '—'}</td>
          </tr>
        </tbody>
      </table>`;
  }

  const rows = items.map((item: any, index: number) => `
    <tr style="background-color:${index % 2 === 0 ? '#ffffff' : '#f9fafb'};">
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#111827;">${item.damage_description || item.item_description || 'Repair'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#374151;">${item.item_code || 'N/A'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#374151;">${item.notes_public || '—'}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#111827;font-weight:600;text-align:right;">${item.allocated_customer_amount != null ? '$' + Number(item.allocated_customer_amount).toFixed(2) : '—'}</td>
    </tr>`).join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0;border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
      <thead>
        <tr style="background-color:#111827;">
          <th style="padding:10px 14px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;">Action</th>
          <th style="padding:10px 14px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;">Item</th>
          <th style="padding:10px 14px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;">Notes</th>
          <th style="padding:10px 14px;text-align:right;font-weight:600;color:#ffffff;font-size:13px;">Estimate</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

type UnifiedTemplateNoteType = 'internal' | 'public' | 'exception';
type UnifiedTemplateNoteEntity =
  | 'shipment'
  | 'task'
  | 'item'
  | 'claim'
  | 'quote'
  | 'stocktake'
  | 'repair_quote';

interface UnifiedTemplateNoteRow {
  id: string;
  note: string;
  note_type: UnifiedTemplateNoteType;
  parent_note_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  source_entity_type: string;
  source_entity_id: string;
  source_entity_number: string | null;
  replies?: UnifiedTemplateNoteRow[];
}

const NOTE_TOKEN_ENTITIES: UnifiedTemplateNoteEntity[] = [
  'shipment',
  'task',
  'item',
  'claim',
  'quote',
  'stocktake',
  'repair_quote',
];

const NOTE_ENTITY_LABELS: Record<string, string> = {
  shipment: 'Shipment',
  task: 'Task',
  item: 'Item',
  claim: 'Claim',
  quote: 'Quote',
  stocktake: 'Stocktake',
  repair_quote: 'Repair Quote',
};

function buildPortalRouteForNoteSource(
  portalBaseUrl: string,
  sourceEntityType: string,
  sourceEntityId: string,
  sourceEntityNumber?: string | null
): string {
  if (!portalBaseUrl || !sourceEntityType || !sourceEntityId) return '';

  if (sourceEntityType === 'item') return `${portalBaseUrl}/inventory/${sourceEntityId}`;
  if (sourceEntityType === 'task') return `${portalBaseUrl}/tasks/${sourceEntityId}`;
  if (sourceEntityType === 'claim') return `${portalBaseUrl}/claims/${sourceEntityId}`;
  if (sourceEntityType === 'quote') return `${portalBaseUrl}/quotes/${sourceEntityId}`;
  if (sourceEntityType === 'stocktake') return `${portalBaseUrl}/stocktakes/${sourceEntityId}`;
  if (sourceEntityType === 'repair_quote') return `${portalBaseUrl}/repair-quotes/${sourceEntityId}`;
  if (sourceEntityType === 'shipment') {
    const prefix = (sourceEntityNumber || '').toUpperCase().split('-')[0] || '';
    if (prefix === 'MAN') return `${portalBaseUrl}/incoming/manifest/${sourceEntityId}`;
    if (prefix === 'EXP') return `${portalBaseUrl}/incoming/expected/${sourceEntityId}`;
    if (prefix === 'INT') return `${portalBaseUrl}/incoming/dock-intake/${sourceEntityId}`;
    return `${portalBaseUrl}/shipments/${sourceEntityId}`;
  }

  return '';
}

function sortTemplateReplies(note: UnifiedTemplateNoteRow): void {
  if (!note.replies || note.replies.length === 0) return;
  note.replies.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  for (const reply of note.replies) sortTemplateReplies(reply);
}

function templateThreadLatest(note: UnifiedTemplateNoteRow): number {
  let latest = new Date(note.updated_at || note.created_at).getTime();
  for (const reply of note.replies || []) {
    latest = Math.max(latest, templateThreadLatest(reply));
  }
  return latest;
}

function buildTemplateThreads(rows: UnifiedTemplateNoteRow[]): UnifiedTemplateNoteRow[] {
  const byId = new Map<string, UnifiedTemplateNoteRow>();
  for (const row of rows) {
    byId.set(row.id, { ...row, replies: [] });
  }

  const roots: UnifiedTemplateNoteRow[] = [];
  for (const row of byId.values()) {
    if (row.parent_note_id && byId.has(row.parent_note_id)) {
      byId.get(row.parent_note_id)?.replies?.push(row);
    } else {
      roots.push(row);
    }
  }

  for (const root of roots) sortTemplateReplies(root);
  roots.sort((a, b) => templateThreadLatest(b) - templateThreadLatest(a));
  return roots;
}

function renderTemplateThreadHtml(
  note: UnifiedTemplateNoteRow,
  depth: number,
  authorById: Map<string, string>,
  portalBaseUrl: string
): string {
  const authorName = note.created_by ? authorById.get(note.created_by) || 'System' : 'System';
  const createdAt = formatDateTimeValue(note.created_at) || '';
  const safeBody = escapeHtml(note.note || '').replace(/\n/g, '<br/>');
  const sourceLabel = NOTE_ENTITY_LABELS[note.source_entity_type] || note.source_entity_type;
  const sourceNumber = note.source_entity_number || note.source_entity_id;
  const sourceHref = buildPortalRouteForNoteSource(
    portalBaseUrl,
    note.source_entity_type,
    note.source_entity_id,
    note.source_entity_number
  );
  const sourceTag = sourceHref
    ? `<a href="${escapeHtml(sourceHref)}" style="color:#2563eb;text-decoration:underline;">${escapeHtml(
        `${sourceLabel} ${sourceNumber}`
      )}</a>`
    : `<span style="color:#475569;">${escapeHtml(`${sourceLabel} ${sourceNumber}`)}</span>`;

  const marginLeft = depth > 0 ? depth * 16 : 0;
  const background = depth > 0 ? '#f9fafb' : '#ffffff';

  const replyHtml = (note.replies || [])
    .map((reply) => renderTemplateThreadHtml(reply, depth + 1, authorById, portalBaseUrl))
    .join('');

  return `
    <div style="margin:0 0 10px ${marginLeft}px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;background:${background};">
      <div style="font-size:12px;color:#64748b;margin-bottom:4px;">
        <strong style="color:#111827;">${escapeHtml(authorName || 'System')}</strong>
        ${createdAt ? ` · ${escapeHtml(createdAt)}` : ''}
      </div>
      <div style="font-size:13px;color:#334155;line-height:1.55;white-space:normal;">${safeBody || '&nbsp;'}</div>
      <div style="font-size:11px;color:#64748b;margin-top:6px;">Source: ${sourceTag}</div>
      ${replyHtml}
    </div>
  `;
}

function buildDefaultUnifiedNoteTokens(): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const entity of NOTE_TOKEN_ENTITIES) {
    tokens[`${entity}.internal_notes`] = '';
    tokens[`${entity}.public_notes`] = '';
    tokens[`${entity}.exception_notes`] = '';
  }
  return tokens;
}

async function buildUnifiedNoteTokens(
  supabase: any,
  tenantId: string,
  portalBaseUrl: string,
  entityType: string,
  entityId: string
): Promise<Record<string, string>> {
  const tokens = buildDefaultUnifiedNoteTokens();
  if (!NOTE_TOKEN_ENTITIES.includes(entityType as UnifiedTemplateNoteEntity)) {
    return tokens;
  }

  try {
    const { data: linkRows, error: linkError } = await supabase
      .from('note_entity_links')
      .select('note_id')
      .eq('tenant_id', tenantId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId);

    if (linkError) throw linkError;
    const noteIds = [...new Set((linkRows || []).map((row: any) => row.note_id).filter(Boolean))];
    if (noteIds.length === 0) return tokens;

    const { data: noteRows, error: notesError } = await supabase
      .from('notes')
      .select(
        'id, note, note_type, parent_note_id, created_at, updated_at, created_by, source_entity_type, source_entity_id, source_entity_number, deleted_at'
      )
      .eq('tenant_id', tenantId)
      .in('id', noteIds);

    if (notesError) throw notesError;

    const visibleNotes = ((noteRows || []) as Array<any>)
      .filter((row) => !row.deleted_at)
      .map((row) => ({
        id: String(row.id),
        note: String(row.note || ''),
        note_type: (row.note_type || 'internal') as UnifiedTemplateNoteType,
        parent_note_id: row.parent_note_id ? String(row.parent_note_id) : null,
        created_at: String(row.created_at || ''),
        updated_at: String(row.updated_at || row.created_at || ''),
        created_by: row.created_by ? String(row.created_by) : null,
        source_entity_type: String(row.source_entity_type || entityType),
        source_entity_id: String(row.source_entity_id || entityId),
        source_entity_number: row.source_entity_number ? String(row.source_entity_number) : null,
      })) as UnifiedTemplateNoteRow[];

    if (visibleNotes.length === 0) return tokens;

    const creatorIds = [...new Set(visibleNotes.map((n) => n.created_by).filter(Boolean))];
    const authorById = new Map<string, string>();
    if (creatorIds.length > 0) {
      const { data: authors } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .in('id', creatorIds);
      for (const author of authors || []) {
        const fullName = `${author.first_name || ''} ${author.last_name || ''}`.trim();
        authorById.set(author.id, fullName || author.email || 'User');
      }
    }

    const noteTypes: UnifiedTemplateNoteType[] = ['internal', 'public', 'exception'];
    for (const noteType of noteTypes) {
      const typedNotes = visibleNotes.filter((note) => note.note_type === noteType);
      const roots = buildTemplateThreads(typedNotes);
      const rendered = roots
        .map((root) => renderTemplateThreadHtml(root, 0, authorById, portalBaseUrl))
        .join('');
      tokens[`${entityType}.${noteType}_notes`] = rendered;
    }
  } catch (err) {
    console.warn('[send-alerts] failed to build unified note tokens:', err);
  }

  return tokens;
}

async function buildTemplateVariables(
  supabase: any,
  alertType: string,
  entityType: string,
  entityId: string,
  tenantId: string,
  queueRecipients: string[] | null = null,
  fallbackOrigin?: string
): Promise<{ variables: Record<string, string>; itemIds: string[]; shipmentLineRows: ShipmentLineTemplateRow[] }> {
  const branding = await getTenantBranding(supabase, tenantId, fallbackOrigin);

  // Fetch office_alert_emails for template tokens
  const officeAlertEmailsList = await getOfficeAlertEmails(supabase, tenantId);
  const officeAlertEmailsStr = officeAlertEmailsList.join(', ');
  const officeAlertEmailPrimary = officeAlertEmailsList.length > 0 ? officeAlertEmailsList[0] : '';

  const portalBase = branding.portalBaseUrl || '';

  const variables: Record<string, string> = {
    // ── Branding tokens ──
    tenant_name: branding.companyName || 'Warehouse System',
    brand_logo_url: branding.logoUrl || '',
    brand_primary_color: branding.primaryColor || '#FD5A2A',
    brand_support_email: branding.supportEmail || 'support@example.com',
    brand_terms_url: branding.termsUrl || '',
    brand_privacy_url: branding.privacyUrl || '',
    tenant_company_address: branding.companyAddress || '',
    portal_base_url: portalBase,
    // Aliases used by some v4 templates
    tenant_terms_url: branding.termsUrl || '',
    tenant_privacy_url: branding.privacyUrl || '',
    // ── Office tokens ──
    office_alert_emails: officeAlertEmailsStr,
    office_alert_email_primary: officeAlertEmailPrimary,
    // ── Account tokens ──
    account_name: '',
    account_contact_name: '',
    account_contact_email: '',
    account_contact_phone: '',
    account_contact_recipients_raw: queueRecipients && queueRecipients.length > 0 ? queueRecipients.join(', ') : '',
    account_billing_contact_email: '',
    account_user_email: '',
    // ── Shipment tokens ──
    shipment_number: '',
    shipment_vendor: '',
    shipment_status: '',
    scheduled_date: '',
    delivery_window: '',
    delay_reason: '',
    delivered_at: '',
    shipment_expected_date: '',
    shipment_received_date: '',
    // ── Portal deep-link tokens (defaults; overridden per entity below) ──
    shipment_link: '',
    release_link: '',
    task_link: '',
    item_photos_link: '',
    // ── Shipment exception aggregate tokens (optional) ──
    exceptions_count: '0',
    exceptions_list_text: '',
    exceptions_section_html: '',
    // ── Item tokens ──
    item_id: '',
    item_code: '',
    item_vendor: '',
    item_description: '',
    item_received_date: '',
    item_location: '',
    item_sidemark: '',
    // ── Task tokens ──
    task_number: '',
    task_title: '',
    task_type: '',
    task_status: '',
    task_due_date: '',
    task_days_overdue: '',
    assigned_to_name: '',
    completed_by_name: '',
    // ── Inspection tokens ──
    inspection_number: '',
    inspection_issues_count: '',
    inspection_result: '',
    // ── Release tokens ──
    release_number: '',
    release_type: '',
    release_completed_at: '',
    released_at: '',
    pickup_hours: '',
    amount_due: '',
    payment_status: '',
    // ── Repair / billing / claim tokens ──
    repair_type: '',
    repair_completed_at: '',
    repair_estimate_amount: '',
    service_name: '',
    service_code: '',
    service_amount: '',
    billing_description: '',
    claim_reference: '',
    claim_status: '',
    claim_amount: '',
    offer_amount: '',
    invoice_number: '',
    user_name: '',
    created_by_name: '',
    // ── Item flag tokens (item.flag_added / item.flag_added.{SERVICE_CODE}) ──
    flag_service_name: '',
    flag_service_code: '',
    flag_added_by_name: '',
    flag_added_at: '',
    portal_invoice_url: '',
    portal_claim_url: '',
    portal_release_url: '',
    portal_quote_url: '',
    portal_account_url: '',
    portal_settings_url: portalBase ? `${portalBase}/settings/organization/contact` : '',
    portal_inspection_url: '',
    portal_repair_url: '',
    // ── Aggregate tokens ──
    items_count: '0',
    items_table_html: '',
    items_list_text: '',
    items_list_html: '',
    inspection_findings_table_html: '',
    task_services_table_html: '',
    repair_actions_table_html: '',
    // ── General ──
    created_at: new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }),
    // Recipient-role token aliases (useful when role tokens appear in template body)
    admin_role: 'admin',
    manager_role: 'manager',
    warehouse_role: 'warehouse',
    client_user_role: 'client_user',
    technician_role: 'technician',
    billing_manager_role: 'billing_manager',
    // ── Split workflow (optional) ──
    split_grouped_qty: '',
    split_keep_qty: '',
    split_leftover_qty: '',
    split_requested_by_name: '',
    split_requested_by_email: '',
    split_request_notes: '',
    origin_job_type: '',
    origin_job_number: '',
    origin_job_link: '',
    split_child_codes_list_text: '',
    // ── Unable / partial context ──
    task_unable_reason: '',
    shipment_unable_reason: '',
    release_items_count: '0',
  };
  Object.assign(variables, buildDefaultUnifiedNoteTokens());

  let itemIds: string[] = [];
  let shipmentLineRows: ShipmentLineTemplateRow[] = [];

  try {
    if (entityType === 'shipment') {
      const { data: shipment } = await supabase
        .from('shipments')
        .select(`
          *,
          account:accounts(
            account_name,
            primary_contact_name,
            primary_contact_email,
            primary_contact_phone,
            billing_contact_email,
            alerts_contact_email
          )
        `)
        .eq('id', entityId)
        .single();

      if (shipment) {
        variables.shipment_number = shipment.shipment_number || entityId;
        variables.shipment_status = shipment.status || 'Unknown';
        variables.shipment_vendor = shipment.vendor || shipment.vendor_name || shipment.carrier || 'N/A';
        variables.scheduled_date = formatDateValue(shipment.scheduled_date);
        variables.shipment_expected_date = formatDateValue(shipment.expected_arrival_date || shipment.scheduled_date);
        variables.shipment_received_date = formatDateTimeValue(shipment.received_at);
        variables.delivery_window = shipment.delivery_window || '';
        variables.delay_reason = shipment.delay_reason || '';
        variables.delivered_at = formatDateTimeValue(shipment.delivered_at);
        variables.account_name = shipment.account?.account_name || 'N/A';
        variables.account_contact_name = shipment.account?.primary_contact_name || 'Customer';
        variables.account_contact_email = shipment.account?.primary_contact_email || '';
        variables.account_contact_phone = shipment.account?.primary_contact_phone || '';
        variables.account_billing_contact_email = shipment.account?.billing_contact_email || '';
        variables.account_user_email = shipment.account?.primary_contact_email || '';
        if (!variables.account_contact_recipients_raw) {
          variables.account_contact_recipients_raw =
            shipment.account?.alerts_contact_email ||
            [variables.account_contact_email, variables.account_contact_phone].filter(Boolean).join(', ');
        }
        variables.shipment_unable_reason =
          shipment.notes ||
          shipment.receiving_notes ||
          shipment.shipment_exception_type ||
          'No reason provided';
        variables.payment_status = shipment.payment_status || variables.payment_status || '';
        variables.amount_due = formatCurrencyValue(shipment.payment_amount) || variables.amount_due || '';
        variables.shipment_link = portalBase ? `${portalBase}/shipments/${entityId}` : '';
        if (shipment.account_id) {
          variables.portal_account_url = portalBase ? `${portalBase}/accounts/${shipment.account_id}` : '';
        }

        // Split workflow tokens (manual review or split-required metadata on the shipment)
        try {
          const meta = shipment.metadata && typeof shipment.metadata === 'object' ? shipment.metadata : null;
          const split = meta && typeof (meta as any).split_workflow === 'object' ? (meta as any).split_workflow : null;
          if (split) {
            variables.origin_job_type = 'Shipment';
            variables.origin_job_number = shipment.shipment_number || entityId;
            variables.origin_job_link = variables.shipment_link || '';

            if (split.grouped_qty != null) variables.split_grouped_qty = String(split.grouped_qty);
            if (split.keep_qty != null) variables.split_keep_qty = String(split.keep_qty);
            if (split.leftover_qty != null) variables.split_leftover_qty = String(split.leftover_qty);
            if (split.requested_by_name) variables.split_requested_by_name = String(split.requested_by_name);
            if (split.requested_by_email) variables.split_requested_by_email = String(split.requested_by_email);
            if (split.request_notes) variables.split_request_notes = String(split.request_notes);

            if (split.parent_item_code) variables.item_code = String(split.parent_item_code);
            if (split.parent_item_location) variables.item_location = String(split.parent_item_location);
          }
        } catch {
          // optional
        }

        // Backward-compatible token aliases for will-call communication templates.
        // Will-call is modeled as an OUTBOUND SHIPMENT in Stride WMS, but the templates
        // use legacy [[release_*]] variables. Populate those from shipment fields.
        if (alertType === 'will_call_ready' || alertType === 'will_call_released') {
          variables.release_number = variables.shipment_number;
          variables.release_link = variables.shipment_link;
          variables.portal_release_url = variables.shipment_link;
          variables.release_type = shipment.release_type || 'Will Call';

          const releasedAtRaw = shipment.completed_at || shipment.shipped_at || shipment.signature_timestamp || null;
          const releasedAt = formatDateTimeValue(releasedAtRaw);
          variables.release_completed_at = releasedAt;
          variables.released_at = releasedAt;

          // Populate from shipment context when available.
          variables.pickup_hours = variables.pickup_hours || '';
          variables.amount_due = variables.amount_due || formatCurrencyValue(shipment.payment_amount) || '';
          variables.payment_status = variables.payment_status || shipment.payment_status || '';
        }

        const { data: shipmentItemRowsData } = await supabase
          .from('shipment_items')
          .select('item_id, actual_quantity, expected_quantity, expected_description, expected_vendor, expected_sidemark')
          .eq('shipment_id', entityId)
          .is('deleted_at', null);

        shipmentLineRows = Array.isArray(shipmentItemRowsData) ? shipmentItemRowsData : [];

        const linkedShipmentItemIds = shipmentLineRows
          .map((row: any) => row.item_id)
          .filter(Boolean) as string[];

        const { data: inboundShipmentItems } = await supabase
          .from('items')
          .select('id')
          .eq('receiving_shipment_id', entityId);

        itemIds = [...new Set([
          ...linkedShipmentItemIds,
          ...((inboundShipmentItems || []).map((item: any) => item.id)),
        ])];

        if (itemIds.length > 0) {
          variables.items_count = String(itemIds.length);
        } else if (shipmentLineRows.length > 0) {
          const totalPieces = shipmentLineRows.reduce((sum: number, row: any) => {
            const qty = Number(row.actual_quantity ?? row.expected_quantity ?? 0);
            return sum + (Number.isFinite(qty) ? qty : 0);
          }, 0);
          variables.items_count = String(totalPieces);
        } else {
          variables.items_count = '0';
        }
        variables.release_items_count = variables.items_count || '0';

        // Shipment exceptions (open) — optional section for Shipment Received templates
        try {
          const { data: exRows, error: exErr } = await supabase
            .from('shipment_exceptions')
            .select('code, note')
            .eq('tenant_id', tenantId)
            .eq('shipment_id', entityId)
            .eq('status', 'open');

          if (exErr) throw exErr;

          const exceptions = Array.isArray(exRows) ? exRows : [];
          variables.exceptions_count = String(exceptions.length);

          if (exceptions.length > 0) {
            const formatted = exceptions.map((ex: any) => {
              const code = String(ex.code || '').trim();
              const label = SHIPMENT_EXCEPTION_LABELS[code] || code.replace(/_/g, ' ');
              const note = String(ex.note || '').trim();
              return { code, label, note };
            });

            variables.exceptions_list_text = formatted
              .map((e) => `- ${e.label}${e.note ? `: ${e.note}` : ''}`)
              .join('\n');

            const listItems = formatted
              .map((e) => {
                const safeLabel = escapeHtml(e.label);
                const safeNote = escapeHtml(e.note);
                return `
                  <li style="margin:0 0 10px;">
                    <strong style="color:#92400e;">${safeLabel}</strong>
                    ${safeNote ? `<div style="margin-top:2px;color:#475569;white-space:pre-wrap;">${safeNote}</div>` : ''}
                  </li>
                `;
              })
              .join('');

            variables.exceptions_section_html = `
              <div style="margin-top:24px;padding:16px;border:1px solid #fde68a;background:#fffbeb;border-radius:12px;">
                <p style="margin:0 0 10px;font-size:12px;font-weight:700;color:#92400e;letter-spacing:0.3px;text-transform:uppercase;">
                  Exceptions
                </p>
                <ul style="margin:0;padding-left:18px;color:#92400e;font-size:14px;">
                  ${listItems}
                </ul>
              </div>
            `;
          } else {
            variables.exceptions_list_text = '';
            variables.exceptions_section_html = '';
          }
        } catch (exBuildErr) {
          // Exceptions are optional; don't block alert delivery if this fails.
          console.warn('[send-alerts] failed to build shipment exception tokens:', exBuildErr);
          variables.exceptions_count = variables.exceptions_count || '0';
          variables.exceptions_list_text = variables.exceptions_list_text || '';
          variables.exceptions_section_html = variables.exceptions_section_html || '';
        }
      }
    } else if (entityType === 'item') {
      const { data: item } = await supabase
        .from('items')
        .select(`
          *,
          account:accounts(
            account_name,
            primary_contact_name,
            primary_contact_email,
            primary_contact_phone,
            billing_contact_email,
            alerts_contact_email
          )
        `)
        .eq('id', entityId)
        .single();

      if (item) {
        variables.item_code = item.item_code || entityId;
        variables.item_id = item.item_code || entityId;
        variables.item_description = item.description || 'N/A';
        variables.item_location = item.current_location || 'Unknown';
        variables.item_sidemark = item.sidemark || '';
        variables.item_vendor = item.vendor || '';
        variables.item_received_date = formatDateTimeValue(item.received_date || item.received_at);
        variables.account_name = item.account?.account_name || item.client_account || 'N/A';
        variables.account_contact_name = item.account?.primary_contact_name || 'Customer';
        variables.account_contact_email = item.account?.primary_contact_email || variables.account_contact_email || '';
        variables.account_contact_phone = item.account?.primary_contact_phone || variables.account_contact_phone || '';
        variables.account_billing_contact_email = item.account?.billing_contact_email || variables.account_billing_contact_email || '';
        variables.account_user_email = item.account?.primary_contact_email || variables.account_user_email || '';
        if (!variables.account_contact_recipients_raw) {
          variables.account_contact_recipients_raw =
            item.account?.alerts_contact_email ||
            [variables.account_contact_email, variables.account_contact_phone].filter(Boolean).join(', ');
        }
        variables.item_photos_link = portalBase ? `${portalBase}/inventory/${entityId}` : '';
        variables.items_count = '1';
        itemIds = [entityId];

        // Item flag tokens (service flags): available for item.flag_added and per-flag triggers.
        // Per-flag triggers use: item.flag_added.{SERVICE_CODE}
        if (alertType === 'item.flag_added' || alertType.startsWith('item.flag_added.')) {
          const explicitCode = alertType.startsWith('item.flag_added.')
            ? alertType.slice('item.flag_added.'.length).trim()
            : '';

          try {
            let query = supabase
              .from('item_flags')
              .select('service_code, created_at, created_by')
              .eq('tenant_id', tenantId)
              .eq('item_id', entityId);

            if (explicitCode) {
              query = query.eq('service_code', explicitCode);
            }

            const { data: flagRow } = await query
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            const serviceCode = explicitCode || flagRow?.service_code || '';
            variables.flag_service_code = serviceCode;

            if (flagRow?.created_at) {
              variables.flag_added_at = new Date(flagRow.created_at).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              });
            }

            if (flagRow?.created_by) {
              const { data: actor } = await supabase
                .from('users')
                .select('first_name, last_name, email')
                .eq('id', flagRow.created_by)
                .maybeSingle();

              const fullName = `${actor?.first_name || ''} ${actor?.last_name || ''}`.trim();
              variables.flag_added_by_name = fullName || actor?.email || flagRow.created_by;
            }
          } catch (flagErr) {
            console.warn('[send-alerts] failed to resolve item flag tokens:', flagErr);
          }

          try {
            if (variables.flag_service_code) {
              const { data: svc } = await supabase
                .from('service_events')
                .select('service_name')
                .eq('tenant_id', tenantId)
                .eq('service_code', variables.flag_service_code)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

              variables.flag_service_name = svc?.service_name || variables.flag_service_code;
            }
          } catch (svcErr) {
            console.warn('[send-alerts] failed to resolve flag service name:', svcErr);
            variables.flag_service_name = variables.flag_service_name || variables.flag_service_code || '';
          }
        }

        // Repair-specific tokens (for repair_started, repair_completed, repair_requires_approval)
        if (alertType.startsWith('repair')) {
          variables.repair_type = item.repair_type || '';
          variables.repair_completed_at = item.repair_completed_at
            ? new Date(item.repair_completed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
            : '';
          // Fetch repair quote for estimate amount
          const { data: repairQuote } = await supabase
            .from('repair_quotes')
            .select('id, customer_total, status')
            .eq('item_id', entityId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (repairQuote) {
            variables.repair_estimate_amount = repairQuote.customer_total != null
              ? `$${Number(repairQuote.customer_total).toFixed(2)}`
              : '';
            variables.portal_repair_url = portalBase ? `${portalBase}/repairs/${repairQuote.id}` : '';
          }
        }
      }
    } else if (entityType === 'task') {
      const { data: task } = await supabase
        .from('tasks')
        .select(`
          *,
          account:accounts(
            account_name,
            primary_contact_name,
            primary_contact_email,
            primary_contact_phone,
            billing_contact_email,
            alerts_contact_email
          ),
          assigned_user:users!tasks_assigned_to_fkey(first_name, last_name, email),
          completed_by_user:users!tasks_completed_by_fkey(first_name, last_name)
        `)
        .eq('id', entityId)
        .single();

      if (task) {
        variables.task_type = task.task_type || 'Task';
        variables.task_title = task.title || 'Untitled Task';
        variables.task_number = task.task_number || entityId;
        variables.task_status = task.status || 'Unknown';
        variables.task_due_date = task.due_date
          ? new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : 'No due date';
        variables.account_name = task.account?.account_name || 'N/A';
        variables.account_contact_name = task.account?.primary_contact_name || 'Customer';
        variables.account_contact_email = task.account?.primary_contact_email || variables.account_contact_email || '';
        variables.account_contact_phone = task.account?.primary_contact_phone || variables.account_contact_phone || '';
        variables.account_billing_contact_email = task.account?.billing_contact_email || variables.account_billing_contact_email || '';
        variables.account_user_email = task.account?.primary_contact_email || variables.account_user_email || '';
        if (!variables.account_contact_recipients_raw) {
          variables.account_contact_recipients_raw =
            task.account?.alerts_contact_email ||
            [variables.account_contact_email, variables.account_contact_phone].filter(Boolean).join(', ');
        }
        variables.task_link = portalBase ? `${portalBase}/tasks/${entityId}` : '';
        variables.task_unable_reason = task.unable_to_complete_note || 'No reason provided';

        // Split workflow tokens (stored on split tasks)
        try {
          const meta = task.metadata && typeof task.metadata === 'object' ? task.metadata : null;
          const split = meta && typeof (meta as any).split_workflow === 'object' ? (meta as any).split_workflow : null;
          if (split) {
            if (split.grouped_qty != null) variables.split_grouped_qty = String(split.grouped_qty);
            if (split.keep_qty != null) variables.split_keep_qty = String(split.keep_qty);
            if (split.leftover_qty != null) variables.split_leftover_qty = String(split.leftover_qty);
            if (split.requested_by_name) variables.split_requested_by_name = String(split.requested_by_name);
            if (split.requested_by_email) variables.split_requested_by_email = String(split.requested_by_email);
            if (split.request_notes) variables.split_request_notes = String(split.request_notes);

            // Origin job routing (best-effort; fall back to current task link)
            const originType = split.origin_entity_type ? String(split.origin_entity_type) : '';
            const originId = split.origin_entity_id ? String(split.origin_entity_id) : '';
            const originNumber = split.origin_entity_number ? String(split.origin_entity_number) : '';
            variables.origin_job_type =
              originType === 'shipment' ? 'Shipment'
              : originType === 'task' ? 'Task'
              : originType ? originType
              : '';
            variables.origin_job_number = originNumber || originId || '';
            if (portalBase && originType === 'shipment' && originId) {
              variables.origin_job_link = `${portalBase}/shipments/${originId}`;
            } else if (portalBase && originType === 'task' && originId) {
              variables.origin_job_link = `${portalBase}/tasks/${originId}`;
            } else {
              variables.origin_job_link = variables.task_link || '';
            }

            if (split.parent_item_code) variables.item_code = String(split.parent_item_code);

            // For split.completed, include the new child codes list (if stored in metadata)
            if (Array.isArray(split.child_item_codes) && split.child_item_codes.length > 0) {
              variables.split_child_codes_list_text = split.child_item_codes.map((c: any) => String(c)).join('\n');
            }

            // Parent item location token (best-effort)
            if (split.parent_item_id) {
              const { data: parentItem } = await supabase
                .from('items')
                .select('item_code, current_location')
                .eq('id', split.parent_item_id)
                .eq('tenant_id', tenantId)
                .maybeSingle();
              if (parentItem?.item_code) variables.item_code = parentItem.item_code;
              if (parentItem?.current_location) variables.item_location = parentItem.current_location;
            }
          }
        } catch {
          // optional
        }

        if (task.assigned_user) {
          variables.assigned_to_name = `${task.assigned_user.first_name || ''} ${task.assigned_user.last_name || ''}`.trim() || 'Unassigned';
        }

        if (task.completed_by_user) {
          variables.completed_by_name = `${task.completed_by_user.first_name || ''} ${task.completed_by_user.last_name || ''}`.trim() || 'Someone';
          variables.created_by_name = variables.completed_by_name;
        } else {
          variables.completed_by_name = 'Someone';
          variables.created_by_name = 'Someone';
        }

        // task_days_overdue: works for both legacy task.overdue and v4 task_overdue
        if ((alertType === 'task.overdue' || alertType === 'task_overdue') && task.due_date) {
          const dueDate = new Date(task.due_date);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          dueDate.setHours(0, 0, 0, 0);
          const diffTime = today.getTime() - dueDate.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          variables.task_days_overdue = String(Math.max(0, diffDays));
        }

        // Inspection tokens (inspection is a task type)
        if (alertType.startsWith('inspection')) {
          variables.inspection_number = task.task_number || task.title || entityId;
          variables.portal_inspection_url = portalBase ? `${portalBase}/tasks/${entityId}` : '';
          // Count items with issues
          const { data: taskItemsInsp } = await supabase
            .from('task_items')
            .select('item_id')
            .eq('task_id', entityId);
          if (taskItemsInsp) {
            const inspItemIds = taskItemsInsp.map((ti: any) => ti.item_id);
            const { data: issueItems } = await supabase
              .from('items')
              .select('id, inspection_status')
              .in('id', inspItemIds)
              .neq('inspection_status', 'good');
            variables.inspection_issues_count = String(issueItems?.length || 0);
            variables.inspection_result = (issueItems?.length || 0) > 0 ? 'Issues found' : 'All clear';
          }
          // Shipment number for inspection context
          if (task.shipment_id) {
            const { data: shipment } = await supabase
              .from('shipments')
              .select('shipment_number')
              .eq('id', task.shipment_id)
              .maybeSingle();
            if (shipment) variables.shipment_number = shipment.shipment_number;
          }
        }

        if (task.account_id) {
          variables.portal_account_url = portalBase ? `${portalBase}/accounts/${task.account_id}` : '';
        }

        const { data: taskItems } = await supabase
          .from('task_items')
          .select('item_id')
          .eq('task_id', entityId);

        if (taskItems) {
          itemIds = taskItems.map((ti: any) => ti.item_id);
          variables.items_count = String(itemIds.length);
        } else {
          variables.items_count = '0';
        }
      }
    } else if (entityType === 'invoice') {
      const { data: invoice } = await supabase
        .from('invoices')
        .select(`
          *,
          account:accounts(
            account_name,
            primary_contact_name,
            primary_contact_email,
            primary_contact_phone,
            billing_contact_email,
            alerts_contact_email
          )
        `)
        .eq('id', entityId)
        .single();

      if (invoice) {
        variables.invoice_number = invoice.invoice_number || entityId;
        variables.amount_due = formatCurrencyValue(invoice.total_amount) || '$0.00';
        variables.account_name = invoice.account?.account_name || 'N/A';
        variables.account_contact_name = invoice.account?.primary_contact_name || 'Customer';
        variables.account_contact_email = invoice.account?.primary_contact_email || '';
        variables.account_contact_phone = invoice.account?.primary_contact_phone || '';
        variables.account_billing_contact_email = invoice.account?.billing_contact_email || '';
        variables.account_user_email = invoice.account?.primary_contact_email || '';
        if (!variables.account_contact_recipients_raw) {
          variables.account_contact_recipients_raw =
            invoice.account?.alerts_contact_email ||
            [variables.account_contact_email, variables.account_contact_phone].filter(Boolean).join(', ');
        }
        variables.payment_status = invoice.payment_status || invoice.status || variables.payment_status || '';
        variables.portal_invoice_url = portalBase ? `${portalBase}/invoices/${entityId}` : '';
        variables.items_count = '0';
      }
    } else if (entityType === 'billing_event') {
      const { data: billingEvent } = await supabase
        .from('billing_events')
        .select(`
          *,
          account:accounts(
            account_name,
            primary_contact_name,
            primary_contact_email,
            primary_contact_phone,
            billing_contact_email,
            alerts_contact_email
          ),
          item:items(item_code, description),
          created_by_user:users!billing_events_created_by_fkey(first_name, last_name)
        `)
        .eq('id', entityId)
        .single();

      if (billingEvent) {
        variables.service_name = billingEvent.charge_type || 'Service';
        variables.service_code = billingEvent.charge_type || '';
        variables.service_amount = formatCurrencyValue(billingEvent.total_amount) || '$0.00';
        variables.billing_description = billingEvent.description || '';
        variables.account_name = billingEvent.account?.account_name || 'N/A';
        variables.account_contact_name = billingEvent.account?.primary_contact_name || 'Customer';
        variables.account_contact_email = billingEvent.account?.primary_contact_email || variables.account_contact_email || '';
        variables.account_contact_phone = billingEvent.account?.primary_contact_phone || variables.account_contact_phone || '';
        variables.account_billing_contact_email = billingEvent.account?.billing_contact_email || variables.account_billing_contact_email || '';
        variables.account_user_email = billingEvent.account?.primary_contact_email || variables.account_user_email || '';
        if (!variables.account_contact_recipients_raw) {
          variables.account_contact_recipients_raw =
            billingEvent.account?.alerts_contact_email ||
            [variables.account_contact_email, variables.account_contact_phone].filter(Boolean).join(', ');
        }
        variables.item_code = billingEvent.item?.item_code || 'N/A';
        variables.item_id = billingEvent.item?.item_code || 'N/A';
        variables.item_description = billingEvent.item?.description || 'N/A';
        variables.items_count = '1';

        if (billingEvent.created_by_user) {
          const firstName = billingEvent.created_by_user.first_name || '';
          const lastName = billingEvent.created_by_user.last_name || '';
          variables.user_name = `${firstName} ${lastName}`.trim() || 'System';
          variables.created_by_name = variables.user_name;
        } else {
          variables.user_name = 'System';
          variables.created_by_name = 'System';
        }

        if (billingEvent.item_id) {
          itemIds = [billingEvent.item_id];
        }
      }
    } else if (entityType === 'release') {
      const { data: release } = await supabase
        .from('releases')
        .select(`
          *,
          account:accounts(
            account_name,
            primary_contact_name,
            primary_contact_email,
            primary_contact_phone,
            billing_contact_email,
            alerts_contact_email
          )
        `)
        .eq('id', entityId)
        .single();

      if (release) {
        variables.release_number = release.release_number || entityId;
        variables.release_type = release.release_type || 'Will Call';
        variables.release_completed_at = formatDateTimeValue(release.completed_at);
        variables.released_at = variables.release_completed_at;
        variables.pickup_hours = release.pickup_hours || '';
        variables.amount_due = formatCurrencyValue(release.payment_amount || release.amount_due) || variables.amount_due || '';
        variables.payment_status = release.payment_status || variables.payment_status || '';
        variables.account_name = release.account?.account_name || 'N/A';
        variables.account_contact_name = release.account?.primary_contact_name || 'Customer';
        variables.account_contact_email = release.account?.primary_contact_email || variables.account_contact_email || '';
        variables.account_contact_phone = release.account?.primary_contact_phone || variables.account_contact_phone || '';
        variables.account_billing_contact_email = release.account?.billing_contact_email || variables.account_billing_contact_email || '';
        variables.account_user_email = release.account?.primary_contact_email || variables.account_user_email || '';
        if (!variables.account_contact_recipients_raw) {
          variables.account_contact_recipients_raw =
            release.account?.alerts_contact_email ||
            [variables.account_contact_email, variables.account_contact_phone].filter(Boolean).join(', ');
        }
        variables.portal_release_url = portalBase ? `${portalBase}/releases/${entityId}` : '';
        variables.release_link = variables.portal_release_url;

        const { data: releaseItems } = await supabase
          .from('release_items')
          .select('item_id')
          .eq('release_id', entityId);

        if (releaseItems) {
          itemIds = releaseItems.map((ri: any) => ri.item_id);
          variables.items_count = String(itemIds.length);
          variables.release_items_count = String(itemIds.length);
        } else {
          variables.items_count = '0';
          variables.release_items_count = '0';
        }
      }
    } else if (entityType === 'claim') {
      const { data: claim } = await supabase
        .from('claims')
        .select(`
          *,
          account:accounts(
            account_name,
            primary_contact_name,
            primary_contact_email,
            primary_contact_phone,
            billing_contact_email,
            alerts_contact_email
          )
        `)
        .eq('id', entityId)
        .single();

      if (claim) {
        variables.claim_reference = claim.claim_number || entityId;
        variables.claim_status = claim.status || 'Submitted';
        variables.claim_amount =
          formatCurrencyValue(
            claim.claimed_amount ??
            claim.claim_value_requested ??
            claim.total_requested_amount ??
            claim.approved_amount
          ) || '$0.00';
        variables.offer_amount =
          formatCurrencyValue(claim.counter_offer_amount ?? claim.approved_amount ?? claim.total_approved_amount) || '';
        variables.portal_claim_url = portalBase ? `${portalBase}/claims/${entityId}` : '';
        variables.account_name = claim.account?.account_name || 'N/A';
        variables.account_contact_name = claim.account?.primary_contact_name || 'Customer';
        variables.account_contact_email = claim.account?.primary_contact_email || variables.account_contact_email || '';
        variables.account_contact_phone = claim.account?.primary_contact_phone || variables.account_contact_phone || '';
        variables.account_billing_contact_email = claim.account?.billing_contact_email || variables.account_billing_contact_email || '';
        variables.account_user_email = claim.account?.primary_contact_email || variables.account_user_email || '';
        if (!variables.account_contact_recipients_raw) {
          variables.account_contact_recipients_raw =
            claim.account?.alerts_contact_email ||
            [variables.account_contact_email, variables.account_contact_phone].filter(Boolean).join(', ');
        }
        if (claim.account_id) {
          variables.portal_account_url = portalBase ? `${portalBase}/accounts/${claim.account_id}` : '';
        }
        if (claim.item_id) {
          itemIds = [claim.item_id];
          variables.items_count = '1';
        } else {
          variables.items_count = '0';
        }
      }
    } else if (entityType === 'repair_quote') {
      const { data: quote } = await supabase
        .from('repair_quotes')
        .select(`
          *,
          item:items(item_code, description, client_account),
          account:accounts(
            account_name,
            primary_contact_name,
            primary_contact_email,
            primary_contact_phone,
            billing_contact_email,
            alerts_contact_email
          )
        `)
        .eq('id', entityId)
        .single();

      if (quote) {
        variables.item_code = quote.item?.item_code || '';
        variables.item_description = quote.item?.description || '';
        variables.account_name = quote.account?.account_name || quote.item?.client_account || 'N/A';
        variables.account_contact_name = quote.account?.primary_contact_name || variables.account_contact_name || 'Customer';
        variables.account_contact_email = quote.account?.primary_contact_email || variables.account_contact_email || '';
        variables.account_contact_phone = quote.account?.primary_contact_phone || variables.account_contact_phone || '';
        variables.account_billing_contact_email = quote.account?.billing_contact_email || variables.account_billing_contact_email || '';
        variables.account_user_email = quote.account?.primary_contact_email || variables.account_user_email || '';
        if (!variables.account_contact_recipients_raw) {
          variables.account_contact_recipients_raw =
            quote.account?.alerts_contact_email ||
            [variables.account_contact_email, variables.account_contact_phone].filter(Boolean).join(', ');
        }
        variables.repair_estimate_amount = formatCurrencyValue(quote.customer_total);
        variables.repair_type = quote.repair_type || '';
        variables.repair_completed_at = formatDateTimeValue(quote.completed_at);
        variables.portal_repair_url = portalBase ? `${portalBase}/repairs/${entityId}` : '';
        variables.portal_quote_url = variables.portal_repair_url;
        variables.item_photos_link = portalBase && quote.item_id ? `${portalBase}/inventory/${quote.item_id}` : '';
        if (quote.account_id) {
          variables.portal_account_url = portalBase ? `${portalBase}/accounts/${quote.account_id}` : '';
        }
        if (quote.item_id) itemIds = [quote.item_id];

        // Fetch all repair_quote_items for proper item count and details
        try {
          const { data: quoteItems } = await supabase
            .from('repair_quote_items')
            .select('item_id, item_code, item_description, damage_description, allocated_customer_amount')
            .eq('repair_quote_id', entityId);

          if (quoteItems && quoteItems.length > 0) {
            // Collect all unique item IDs from quote items
            const quoteItemIds = quoteItems
              .map((qi: any) => qi.item_id)
              .filter(Boolean);
            if (quoteItemIds.length > 0) {
              itemIds = [...new Set(quoteItemIds)] as string[];
            }
            variables.items_count = String(quoteItems.length);
            // Use first item code if multiple
            if (quoteItems.length === 1) {
              variables.item_code = quoteItems[0].item_code || variables.item_code;
              variables.item_description = quoteItems[0].item_description || variables.item_description;
            }
          } else {
            variables.items_count = quote.item_id ? '1' : '0';
          }
        } catch (err) {
          console.warn('[buildTemplateVariables] Failed to fetch repair_quote_items:', err);
          variables.items_count = quote.item_id ? '1' : '0';
        }

        // Fetch magic link review URL from repair_quote_tokens
        try {
          const { data: tokenRow } = await supabase
            .from('repair_quote_tokens')
            .select('token, expires_at')
            .eq('repair_quote_id', entityId)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (tokenRow?.token && portalBase) {
            variables.portal_quote_review_url = `${portalBase}/quote/review?token=${tokenRow.token}`;
          }
        } catch (err) {
          console.warn('[buildTemplateVariables] Failed to fetch repair_quote_tokens:', err);
        }
      }
    }

    const unifiedNoteTokens = await buildUnifiedNoteTokens(
      supabase,
      tenantId,
      portalBase,
      entityType,
      entityId
    );
    Object.assign(variables, unifiedNoteTokens);
  } catch (error) {
    console.error('Error building template variables:', error);
  }

  return { variables, itemIds, shipmentLineRows };
}

async function getTemplateForAlert(
  supabase: any,
  alertType: string,
  tenantId: string,
  channel: 'email' | 'sms' = 'email'
): Promise<{
  subjectTemplate: string;
  bodyTemplate: string;
  bodyFormat: string | null;
  editorJson: Record<string, unknown> | null;
} | null> {
  try {
    const candidates = getAlertTriggerCandidates(alertType);
    const { data: alerts } = await supabase
      .from('communication_alerts')
      .select('id, trigger_event')
      .eq('tenant_id', tenantId)
      .in('trigger_event', candidates)
      .eq('is_enabled', true)
      .limit(candidates.length);

    const alert = pickPreferredTriggerMatch(alerts, candidates, 'trigger_event');
    if (alert) {
      const { data: template } = await supabase
        .from('communication_templates')
        .select('subject_template, body_template, body_format, editor_json')
        .eq('alert_id', alert.id)
        .eq('channel', channel)
        .maybeSingle();

      if (template) {
        return {
          subjectTemplate: template.subject_template || '',
          bodyTemplate: template.body_template || '',
          bodyFormat: template.body_format || null,
          editorJson: template.editor_json || null,
        };
      }
    }

    const { data: platformTemplates } = await supabase
      .from('platform_alert_template_library')
      .select('trigger_event, subject_template, body_template, body_format, editor_json')
      .in('trigger_event', candidates)
      .eq('channel', channel)
      .eq('is_active', true)
      .limit(candidates.length);

    const platformTemplate = pickPreferredTriggerMatch(platformTemplates, candidates, 'trigger_event');
    if (platformTemplate) {
      return {
        subjectTemplate: String(platformTemplate.subject_template || ''),
        bodyTemplate: String(platformTemplate.body_template || ''),
        bodyFormat: (platformTemplate.body_format as string | null) || null,
        editorJson: (platformTemplate.editor_json as Record<string, unknown> | null) || null,
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching template:', error);
    return null;
  }
}

// Legacy email content generation
async function generateEmailContent(
  alertType: string, 
  entityType: string,
  entityId: string,
  supabase: any
): Promise<{ subject: string; html: string; text: string }> {
  let subject = '';
  let html = '';
  let text = '';

  switch (alertType) {
    case 'damage_photo': {
      const { data: item } = await supabase
        .from('items')
        .select('item_code, description, client_account')
        .eq('id', entityId)
        .single();

      subject = `⚠️ Damage Photo Flagged - ${item?.item_code || 'Item'}`;
      text = `A photo has been flagged as needing attention for item ${item?.item_code || entityId}.`;
      html = `
        <h2 style="color: #dc2626;">⚠️ Damage Photo Flagged</h2>
        <p>A photo has been flagged as needing attention.</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px; font-weight: bold;">Item Code:</td><td style="padding: 8px;">${item?.item_code || entityId}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">Description:</td><td style="padding: 8px;">${item?.description || 'N/A'}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">Client:</td><td style="padding: 8px;">${item?.client_account || 'N/A'}</td></tr>
        </table>
        <p>Please review this item in the system.</p>
      `;
      break;
    }

    case 'unable_to_complete': {
      const { data: task } = await supabase
        .from('tasks')
        .select('title, task_type, unable_to_complete_note, assigned_user:users!tasks_assigned_to_fkey(first_name, last_name)')
        .eq('id', entityId)
        .single();

      subject = `❌ Task Unable to Complete - ${task?.title || 'Task'}`;
      const assignedTo = task?.assigned_user 
        ? `${task.assigned_user.first_name} ${task.assigned_user.last_name}`
        : 'Unassigned';
      text = `A task has been marked as unable to complete.\n\nTask: ${task?.title}\nType: ${task?.task_type}\nAssigned To: ${assignedTo}\n\nReason: ${task?.unable_to_complete_note || 'No reason provided'}`;
      html = `
        <h2 style="color: #dc2626;">❌ Task Unable to Complete</h2>
        <p>A task has been marked as unable to complete and requires review.</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px; font-weight: bold;">Task:</td><td style="padding: 8px;">${task?.title || entityId}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">Type:</td><td style="padding: 8px;">${task?.task_type || 'N/A'}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">Assigned To:</td><td style="padding: 8px;">${assignedTo}</td></tr>
        </table>
        <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 12px; margin: 20px 0;">
          <strong>Reason:</strong><br/>
          ${task?.unable_to_complete_note || 'No reason provided'}
        </div>
        <p>Please review and take appropriate action.</p>
      `;
      break;
    }

    case 'repair_quote_approved': {
      const { data: item } = await supabase
        .from('items')
        .select('item_code, description, client_account')
        .eq('id', entityId)
        .single();

      subject = `✅ Repair Quote Approved - ${item?.item_code || 'Item'}`;
      text = `A repair quote has been approved for item ${item?.item_code}.`;
      html = `
        <h2 style="color: #16a34a;">✅ Repair Quote Approved</h2>
        <p>A repair quote has been approved for the following item:</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px; font-weight: bold;">Item Code:</td><td style="padding: 8px;">${item?.item_code || entityId}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">Description:</td><td style="padding: 8px;">${item?.description || 'N/A'}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">Client:</td><td style="padding: 8px;">${item?.client_account || 'N/A'}</td></tr>
        </table>
        <p>A repair task has been automatically created and added to the queue.</p>
      `;
      break;
    }

    case 'repair_quote_pending': {
      const { data: item } = await supabase
        .from('items')
        .select('item_code, description, client_account')
        .eq('id', entityId)
        .single();

      const { data: quote } = await supabase
        .from('repair_quotes')
        .select('flat_rate, notes')
        .eq('item_id', entityId)
        .eq('approval_status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      subject = `🔧 New Repair Quote Pending - ${item?.item_code || 'Item'}`;
      text = `A new repair quote is pending approval.\n\nItem: ${item?.item_code}\nAmount: $${quote?.flat_rate?.toFixed(2) || '0.00'}`;
      html = `
        <h2 style="color: #f59e0b;">🔧 Repair Quote Pending Approval</h2>
        <p>A new repair quote requires your approval:</p>
        <table style="border-collapse: collapse; margin: 20px 0;">
          <tr><td style="padding: 8px; font-weight: bold;">Item Code:</td><td style="padding: 8px;">${item?.item_code || entityId}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">Description:</td><td style="padding: 8px;">${item?.description || 'N/A'}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">Client:</td><td style="padding: 8px;">${item?.client_account || 'N/A'}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">Quote Amount:</td><td style="padding: 8px; font-size: 1.2em; color: #16a34a;"><strong>$${quote?.flat_rate?.toFixed(2) || '0.00'}</strong></td></tr>
        </table>
        ${quote?.notes ? `<p><strong>Notes:</strong> ${quote.notes}</p>` : ''}
        <p>Please log in to review and approve or decline this quote.</p>
      `;
      break;
    }

    default:
      subject = `Alert: ${alertType}`;
      text = `An alert of type ${alertType} was triggered for ${entityType} ${entityId}.`;
      html = `<p>An alert of type <strong>${alertType}</strong> was triggered for ${entityType} ${entityId}.</p>`;
  }

  return { subject, html, text };
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const platformDefaults = await resolvePlatformEmailDefaults(supabase);
    const platformWrapperHtml = await resolvePlatformEmailWrapperTemplate(supabase);

    // Parse optional JSON body
    let bodyFilter: { 
      tenant_id?: string; 
      alert_queue_id?: string; 
      limit?: number;
      test_send?: boolean;
      test_email?: string;
      origin?: string;
    } = {};
    try {
      const bodyText = await req.text();
      if (bodyText) {
        bodyFilter = JSON.parse(bodyText);
      }
    } catch {
      // No body or invalid JSON
    }

    // =========================================================================
    // TEST SEND PATH
    // =========================================================================
    if (bodyFilter.test_send === true) {
      const testEmail = bodyFilter.test_email;
      if (!testEmail || !EMAIL_REGEX.test(testEmail)) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: 'Valid test_email is required for test_send' 
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      try {
        // Determine from address
        let fromEmail = platformDefaults.fromEmail;
        let fromName = platformDefaults.fromName;
        let replyTo: string | null = platformDefaults.replyTo;

        if (bodyFilter.tenant_id) {
          const { data: brandSettings } = await supabase
            .from('communication_brand_settings')
            .select('from_email, from_name, brand_support_email, custom_email_domain, email_domain_verified, use_default_email')
            .eq('tenant_id', bodyFilter.tenant_id)
            .maybeSingle();

          // Only use custom sender if tenant explicitly chose it and it is verified.
          const wantsCustom = brandSettings?.use_default_email === false;
          const isVerified = brandSettings?.email_domain_verified === true;
          if (wantsCustom && isVerified) {
            fromEmail = String(
              brandSettings?.from_email ||
              brandSettings?.custom_email_domain ||
              platformDefaults.fromEmail
            );
          }
          if (brandSettings?.from_name) {
            fromName = brandSettings.from_name;
          }
          const routingReplyTo = await resolveTenantReplyToRoutingAddress(supabase, bodyFilter.tenant_id);
          const supportEmail = (brandSettings?.brand_support_email || "").trim();
          if (routingReplyTo) {
            replyTo = routingReplyTo;
          } else if (isValidEmail(supportEmail)) {
            replyTo = supportEmail;
          }

          // Also test recipient resolution
          const recipientResult = await resolveRecipients(
            supabase, bodyFilter.tenant_id, 'test', null
          );
          console.log(`[test_send] Recipient resolution for tenant ${bodyFilter.tenant_id}:`, recipientResult);
        }

        const sendResult = await sendPlatformEmail(supabase, {
          fromEmail,
          fromName,
          to: [testEmail],
          subject: '✅ Stride WMS - Email Test Successful',
          replyTo,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h1 style="color: #16a34a;">✅ Email Test Successful</h1>
              <p>This is a test email from Stride WMS to verify your email configuration is working correctly.</p>
              <table style="border-collapse: collapse; margin: 20px 0; width: 100%;">
                <tr>
                  <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #e5e7eb;">From:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${fromName} &lt;${fromEmail}&gt;</td>
                </tr>
                <tr>
                  <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #e5e7eb;">To:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${testEmail}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #e5e7eb;">Sent At:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${new Date().toISOString()}</td>
                </tr>
              </table>
              <p style="color: #6b7280; font-size: 14px;">If you received this email, your email alert system is configured correctly.</p>
            </div>
          `,
          text: `Email Test Successful\n\nThis is a test email from Stride WMS.\nFrom: ${fromName} <${fromEmail}>\nTo: ${testEmail}\nSent: ${new Date().toISOString()}`,
        });

        return new Response(JSON.stringify({ 
          success: true, 
          message: `Test email sent to ${testEmail}`,
          from: `${fromName} <${fromEmail}>`,
          provider: sendResult.provider,
          provider_message_id: sendResult.id,
          fallback_used: sendResult.fallbackUsed,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (testErr: any) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: testErr.message || 'Unknown test error',
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // =========================================================================
    // NORMAL ALERT PROCESSING
    // =========================================================================

    const queryLimit = bodyFilter.limit || 50;

    let query = supabase
      .from('alert_queue')
      .select('*')
      .eq('status', 'pending');

    if (bodyFilter.tenant_id) {
      query = query.eq('tenant_id', bodyFilter.tenant_id);
    }
    if (bodyFilter.alert_queue_id) {
      query = query.eq('id', bodyFilter.alert_queue_id);
    }

    const { data: pendingAlerts, error: fetchError } = await query.limit(queryLimit);

    if (fetchError) throw fetchError;

    if (!pendingAlerts || pendingAlerts.length === 0) {
      return new Response(JSON.stringify({ message: "No pending alerts", processed: 0, sent: 0, failed: 0, skipped: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const inboundReplyPlatformConfig = await resolvePlatformInboundReplyConfig(supabase);

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const inAppRoleEligibilityCache = new Map<string, Map<string, boolean>>();

    for (const alert of pendingAlerts) {
      try {
        // Check communication_alerts enable/disable for this alert type
        const { data: commAlert } = await supabase
          .from('communication_alerts')
          .select('is_enabled, channels')
          .eq('tenant_id', alert.tenant_id)
          .eq('trigger_event', alert.alert_type)
          .maybeSingle();

        // If disabled or email channel is off, skip
        if (commAlert) {
          const emailEnabled = commAlert.channels?.email === true;
          if (!commAlert.is_enabled || !emailEnabled) {
            console.log(`Alert ${alert.id} skipped: "${alert.alert_type}" disabled for tenant ${alert.tenant_id}`);
            await supabase
              .from('alert_queue')
              .update({ status: 'skipped', error_message: 'Alert disabled' })
              .eq('id', alert.id);
            skipped++;
            continue;
          }
        }

        // Build template variables from entity data
        const callerOrigin = bodyFilter.origin || req.headers.get("origin") || undefined;
        const { variables, itemIds, shipmentLineRows } = await buildTemplateVariables(
          supabase,
          alert.alert_type,
          alert.entity_type,
          alert.entity_id,
          alert.tenant_id,
          alert.recipient_emails || null,
          callerOrigin
        );

        // Generate items table HTML
        if (itemIds.length > 0) {
          const itemsTableHtml = await generateItemsTableHtml(supabase, itemIds);
          const itemsListText = await generateItemsListText(supabase, itemIds);
          const itemsListHtml = await generateItemsListHtml(supabase, itemIds);
          variables.items_table_html = itemsTableHtml;
          variables.items_list_text = itemsListText;
          variables.items_list_html = itemsListHtml;
        } else if (alert.entity_type === 'shipment' && shipmentLineRows.length > 0) {
          const shipmentLineTableHtml = generateShipmentLineTableHtml(shipmentLineRows);
          variables.items_table_html = shipmentLineTableHtml;
          variables.items_list_text = generateShipmentLineListText(shipmentLineRows);
          variables.items_list_html = shipmentLineTableHtml;
        }

        // Generate inspection findings table (for inspection triggers)
        if (alert.alert_type.startsWith('inspection') || alert.alert_type.includes('inspection')) {
          variables.inspection_findings_table_html = await generateInspectionFindingsTableHtml(supabase, itemIds);
        }

        // Generate task services table (for task triggers)
        if (alert.alert_type.startsWith('task') || alert.alert_type.includes('task') || alert.entity_type === 'task') {
          variables.task_services_table_html = await generateTaskServicesTableHtml(supabase, alert.entity_id);
        }

        // Generate repair actions table (for repair triggers)
        if (alert.alert_type.startsWith('repair') || alert.alert_type.includes('repair')) {
          variables.repair_actions_table_html = await generateRepairActionsTableHtml(supabase, alert.entity_id, alert.entity_type);
        }

        // =====================================================================
        // AUDIENCE-BASED ROUTING SWITCH (Phase 4)
        // =====================================================================
        const audience = await getCatalogAudience(supabase, alert.alert_type);

        // Resolve internal recipients (existing 4-tier precedence)
        let internalRecipients: string[] = [];
        let internalSource = 'none';
        if (audience === 'internal' || audience === 'both') {
          const internalResult = await resolveRecipients(
            supabase,
            alert.tenant_id,
            alert.alert_type,
            alert.recipient_emails
          );
          internalRecipients = internalResult.emails;
          internalSource = internalResult.source;
        }

        // Resolve client recipients (only for client/both audience)
        let clientRecipients: string[] = [];
        let clientSource = 'none';
        if (audience === 'client' || audience === 'both') {
          // If alert_queue provided explicit recipients, prefer them.
          // This is required for workflows that target a specific requester
          // (e.g., client portal user who submitted the request).
          const explicitClientRecipients = cleanEmails(alert.recipient_emails || []);
          if (explicitClientRecipients.length > 0) {
            clientRecipients = explicitClientRecipients;
            clientSource = 'alert_queue.recipient_emails';
          } else {
            const accountCtx = await getAccountContext(
              supabase,
              alert.entity_type,
              alert.entity_id,
              alert.tenant_id
            );

            if (accountCtx) {
              const clientResult = await resolveClientRecipients(
                supabase,
                alert.tenant_id,
                accountCtx.accountId,
                accountCtx.accountName
              );
              clientRecipients = clientResult.emails;
              clientSource = clientResult.source;
            } else {
              // NO_ACCOUNT_CONTEXT already logged by getAccountContext
              if (audience === 'client') {
                // Client-only trigger with no account context → skip
                console.log(`[send-alerts] Alert ${alert.id}: audience=client but NO_ACCOUNT_CONTEXT, skipping client routing`);
              }
            }
          }
        }

        // Merge and deduplicate all recipients
        const allRecipientEmails = cleanEmails([...internalRecipients, ...clientRecipients]);

        if (allRecipientEmails.length === 0) {
          const noRecipMsg = audience === 'client'
            ? 'No client recipients found. Configure alerts_contact_email on the account or set up alert_recipients.'
            : 'No recipients found. Configure office_alert_emails in Organization Settings or assign admin/manager roles.';
          console.error(`[send-alerts] No recipients for alert ${alert.id} (type: ${alert.alert_type}, audience: ${audience}, tenant: ${alert.tenant_id})`);
          await supabase
            .from('alert_queue')
            .update({ status: 'failed', error_message: noRecipMsg })
            .eq('id', alert.id);
          failed++;
          continue;
        }

        // Log routing details
        const routingDetails = [];
        if (internalRecipients.length > 0) routingDetails.push(`internal=${internalRecipients.length} via ${internalSource}`);
        if (clientRecipients.length > 0) routingDetails.push(`client=${clientRecipients.length} via ${clientSource}`);
        console.log(`[send-alerts] Alert ${alert.id} (audience=${audience}): ${allRecipientEmails.length} total recipients [${routingDetails.join(', ')}]`);

        // Try to get custom template first
        const customTemplate = await getTemplateForAlert(supabase, alert.alert_type, alert.tenant_id, 'email');

        let subject = alert.subject;
        let html = alert.body_html;
        let text = alert.body_text;

        if (customTemplate && customTemplate.bodyTemplate) {
          subject = customTemplate.subjectTemplate || subject;
          const renderedTemplate = renderBrandedEmail({
            subject: subject || alert.alert_type,
            bodyTemplate: customTemplate.bodyTemplate,
            bodyFormat: customTemplate.bodyFormat,
            editorJson: customTemplate.editorJson,
            accentColor: variables.brand_primary_color,
            wrapperHtmlTemplate: platformWrapperHtml,
          });
          html = renderedTemplate.html;
          text = renderedTemplate.text;
        } else {
          if (!html || !text) {
            const content = await generateEmailContent(
              alert.alert_type,
              alert.entity_type,
              alert.entity_id,
              supabase
            );
            subject = subject || content.subject;
            html = html || content.html;
            text = text || content.text;
          }

          const fallbackBody = html || text || '';
          const renderedFallback = renderBrandedEmail({
            subject: subject || alert.alert_type,
            bodyTemplate: fallbackBody,
            bodyFormat: html ? 'html' : 'text',
            accentColor: variables.brand_primary_color,
            wrapperHtmlTemplate: platformWrapperHtml,
          });
          html = renderedFallback.html;
          text = text || renderedFallback.text;
        }

        // Apply variable substitution to all content
        subject = replaceTemplateVariables(subject || '', variables);
        html = replaceTemplateVariables(html || '', variables);
        text = replaceTemplateVariables(text || '', variables);

        // Get custom email domain settings
        const { data: brandSettings } = await supabase
          .from('communication_brand_settings')
          .select('custom_email_domain, from_name, from_email, brand_support_email, email_domain_verified, use_default_email')
          .eq('tenant_id', alert.tenant_id)
          .maybeSingle();

        let fromEmail = platformDefaults.fromEmail;
        let fromName = brandSettings?.from_name || variables.tenant_name || platformDefaults.fromName;
        const routingReplyTo = await resolveTenantReplyToRoutingAddress(supabase, alert.tenant_id, inboundReplyPlatformConfig);
        const supportEmail = (brandSettings?.brand_support_email || "").trim();
        let replyTo: string | null =
          routingReplyTo || (isValidEmail(supportEmail) ? supportEmail : platformDefaults.replyTo);

        // Only use custom sender if tenant explicitly chose it and it is verified.
        const wantsCustom = brandSettings?.use_default_email === false;
        const isVerified = brandSettings?.email_domain_verified === true;
        if (wantsCustom && isVerified) {
          fromEmail = String(
            brandSettings?.from_email ||
            brandSettings?.custom_email_domain ||
            platformDefaults.fromEmail
          );
        }

        // Send email to merged recipient list using configured provider routing.
        const sendResult = await sendPlatformEmail(supabase, {
          fromEmail,
          fromName,
          to: allRecipientEmails,
          subject,
          html,
          text,
          replyTo,
        });

        // =====================================================================
        // IN-APP NOTIFICATION DISPATCH (role token + tenant eligibility filtered)
        // =====================================================================
        {
          try {
            // Check if in_app channel is enabled for this alert type
            const { data: alertConfig } = await supabase
              .from('communication_alerts')
              .select('id, channels')
              .eq('tenant_id', alert.tenant_id)
              .eq('trigger_event', alert.alert_type)
              .eq('is_enabled', true)
              .maybeSingle();

            const inAppEnabled = alertConfig?.channels?.in_app === true;

            if (inAppEnabled) {
              // Get the in-app template for recipients and body
              const { data: inAppTemplate } = await supabase
                .from('communication_templates')
                .select('subject_template, body_template, in_app_recipients')
                .eq('alert_id', alertConfig.id)
                .eq('channel', 'in_app')
                .maybeSingle();

              if (inAppTemplate?.in_app_recipients) {
                // Parse role tokens from recipients string: "[[manager_role]], [[client_user_role]]"
                const roleTokens = (inAppTemplate.in_app_recipients || '')
                  .match(/\[\[(\w+_role)\]\]/g) || [];
                const requestedRoleNames = [...new Set(
                  roleTokens.map((t: string) =>
                    t.replace(/\[\[|\]\]/g, '').replace(/_role$/, '').toLowerCase()
                  )
                )];

                if (requestedRoleNames.length > 0) {
                  let eligibilityMap = inAppRoleEligibilityCache.get(alert.tenant_id);
                  if (!eligibilityMap) {
                    const { data: eligibilityRows, error: eligibilityErr } = await supabase
                      .from('tenant_in_app_role_eligibility')
                      .select('role_name, is_eligible')
                      .eq('tenant_id', alert.tenant_id);

                    if (eligibilityErr) {
                      console.error(`[send-alerts] Failed to load in-app role eligibility for tenant ${alert.tenant_id}:`, eligibilityErr);
                    }

                    eligibilityMap = new Map<string, boolean>();
                    (eligibilityRows || []).forEach((row: any) => {
                      const roleName = String(row.role_name || '').toLowerCase();
                      if (!roleName) return;
                      eligibilityMap!.set(roleName, row.is_eligible !== false);
                    });
                    inAppRoleEligibilityCache.set(alert.tenant_id, eligibilityMap);
                  }

                  const eligibleRoleNames = (requestedRoleNames as string[]).filter((name: string) => eligibilityMap!.get(name) !== false);

                  if (eligibleRoleNames.length === 0) {
                    console.log(
                      `[send-alerts] No eligible in-app roles for alert ${alert.id}; requested roles: ${requestedRoleNames.join(', ')}`
                    );
                  } else {
                    // Resolve role names to user IDs
                    const { data: roles } = await supabase
                      .from('roles')
                      .select('id, name')
                      .eq('tenant_id', alert.tenant_id)
                      .is('deleted_at', null);

                    if (roles && roles.length > 0) {
                      const roleIds = roles
                        .filter((r: any) => eligibleRoleNames.includes(String(r.name || '').toLowerCase()))
                        .map((r: any) => r.id);

                      if (roleIds.length > 0) {
                        const { data: userRoles } = await supabase
                          .from('user_roles')
                          .select('user_id')
                          .in('role_id', roleIds)
                          .is('deleted_at', null);

                        if (userRoles && userRoles.length > 0) {
                          const userIds = [...new Set(userRoles.map((ur: any) => ur.user_id))];

                          // Verify users belong to this tenant
                          const { data: tenantUsers } = await supabase
                            .from('users')
                            .select('id')
                            .in('id', userIds)
                            .eq('tenant_id', alert.tenant_id)
                            .is('deleted_at', null);

                          if (tenantUsers && tenantUsers.length > 0) {
                            // Optional per-user preference filter:
                            // user_preferences.preference_key = 'in_app_alerts'
                            // preference_value.enabled=false => suppress in-app delivery
                            const tenantUserIds = tenantUsers.map((u: any) => u.id);
                            const { data: prefRows } = await supabase
                              .from('user_preferences')
                              .select('user_id, preference_value')
                              .eq('preference_key', 'in_app_alerts')
                              .in('user_id', tenantUserIds);

                            const optedOutUsers = new Set<string>();
                            (prefRows || []).forEach((row: any) => {
                              const pref = (row.preference_value || {}) as Record<string, unknown>;
                              const isEnabled =
                                pref.enabled !== false &&
                                pref.in_app_alerts_enabled !== false;
                              if (!isEnabled) {
                                optedOutUsers.add(String(row.user_id));
                              }
                            });

                            const deliveryUsers = tenantUsers.filter((u: any) => !optedOutUsers.has(String(u.id)));
                            if (deliveryUsers.length === 0) {
                              console.log(
                                `[send-alerts] In-app delivery skipped for alert ${alert.id}: all target users opted out`
                              );
                            } else {
                              // Build notification content with variable substitution
                              const notifTitle = replaceTemplateVariables(
                                inAppTemplate.subject_template || alert.alert_type,
                                variables
                              );
                              const notifBody = replaceTemplateVariables(
                                inAppTemplate.body_template || subject,
                                variables
                              );

                              // Determine category and action URL from alert type
                              const category = alert.alert_type.split('.')[0].split('_')[0] || 'system';
                              const ctaLink = variables.shipment_link || variables.task_link ||
                                variables.release_link || variables.portal_invoice_url ||
                                variables.portal_claim_url || variables.portal_repair_url ||
                                variables.portal_inspection_url || variables.item_photos_link || null;

                              // Determine priority
                              let priority = 'normal';
                              if (alert.alert_type.includes('damaged') || alert.alert_type.includes('overdue') ||
                                  alert.alert_type.includes('requires_attention') || alert.alert_type.includes('delayed')) {
                                priority = 'high';
                              }

                              // Insert in-app notifications for each user
                              const notifications = deliveryUsers.map((u: any) => ({
                                tenant_id: alert.tenant_id,
                                user_id: u.id,
                                title: notifTitle,
                                body: notifBody,
                                icon: 'notifications',
                                category,
                                related_entity_type: alert.entity_type,
                                related_entity_id: alert.entity_id,
                                action_url: ctaLink,
                                is_read: false,
                                priority,
                                alert_queue_id: alert.id,
                              }));

                              const { error: notifError } = await supabase
                                .from('in_app_notifications')
                                .insert(notifications);

                              if (notifError) {
                                console.error(`[send-alerts] Failed to create in-app notifications for alert ${alert.id}:`, notifError);
                              } else {
                                console.log(
                                  `[send-alerts] Created ${notifications.length} in-app notifications for alert ${alert.id} ` +
                                  `(requested roles: ${requestedRoleNames.join(', ')}, eligible roles: ${eligibleRoleNames.join(', ')})`
                                );
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch (inAppError) {
            // In-app notification failure should not block email delivery
            console.error(`[send-alerts] In-app notification error for alert ${alert.id}:`, inAppError);
          }
        }

        // Mark as sent
        const sentAtIso = new Date().toISOString();
        let { error: markSentError } = await supabase
          .from('alert_queue')
          .update({
            status: 'sent',
            sent_at: sentAtIso,
            provider: sendResult.provider,
            provider_message_id: sendResult.id,
            fallback_used: sendResult.fallbackUsed,
            error_message: null,
          })
          .eq('id', alert.id);
        if (
          markSentError &&
          /provider|provider_message_id|fallback_used|column/i.test(String(markSentError.message || ""))
        ) {
          const fallbackSent = await supabase
            .from('alert_queue')
            .update({
              status: 'sent',
              sent_at: sentAtIso,
              error_message: null,
            })
            .eq('id', alert.id);
          markSentError = fallbackSent.error;
        }
        if (markSentError) {
          console.error(`[send-alerts] Failed to mark alert as sent (${alert.id}):`, markSentError);
        }

        sent++;
        console.log(`Alert ${alert.id} sent successfully to ${allRecipientEmails.length} recipients (audience=${audience})`);
      } catch (alertError) {
        console.error(`Error processing alert ${alert.id}:`, alertError);

        let { error: markFailedError } = await supabase
          .from('alert_queue')
          .update({
            status: 'failed',
            error_message: alertError instanceof Error ? alertError.message : 'Unknown error',
            provider: null,
            provider_message_id: null,
            fallback_used: false,
          })
          .eq('id', alert.id);
        if (
          markFailedError &&
          /provider|provider_message_id|fallback_used|column/i.test(String(markFailedError.message || ""))
        ) {
          const fallbackFailed = await supabase
            .from('alert_queue')
            .update({
              status: 'failed',
              error_message: alertError instanceof Error ? alertError.message : 'Unknown error',
            })
            .eq('id', alert.id);
          markFailedError = fallbackFailed.error;
        }
        if (markFailedError) {
          console.error(`[send-alerts] Failed to mark alert as failed (${alert.id}):`, markFailedError);
        }

        failed++;
      }
    }

    return new Response(
      JSON.stringify({
        message: `Processed ${pendingAlerts.length} alerts`,
        processed: pendingAlerts.length,
        sent,
        failed,
        skipped,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in send-alerts function:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};

serve(handler);
