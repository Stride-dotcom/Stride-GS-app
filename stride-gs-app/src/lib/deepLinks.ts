/**
 * deepLinks — THE canonical factory for every in-app + email deep link.
 *
 * Use `buildDeepLink(...)` everywhere — NEVER hand-concatenate
 * `#/shipments/${id}` or `#/tasks/${id}` strings anywhere else.
 *
 * Why: this drift keeps breaking (the route-style `#/tasks/<id>` form
 * hits a standalone Job page that was shown to fail in Gmail because
 * Gmail's link tracker strips the `#` fragment). The reliable shape is
 * the query-param form — it lands on the list page, which has
 * deep-link handlers that auto-open the detail panel. See `## ⚠️ Deep
 * Links — How They Work (DO NOT BREAK)` in CLAUDE.md.
 *
 * Emitted shape:
 *   `#/{entityType}?open={entityId}[&client={clientSheetId}]`
 *
 * Entity types use the same slug the router expects:
 *   tasks | repairs | will-calls | shipments | inventory
 *
 * The returned value is a RELATIVE hash path (starts with `#/`). Prepend
 * `window.location.origin + window.location.pathname` when you need a
 * full URL (email templates, window.open, etc).
 */

export type DeepLinkEntity =
  | 'tasks' | 'repairs' | 'will-calls' | 'shipments' | 'inventory';

/**
 * Build a canonical deep link. The `clientSheetId` suffix is strongly
 * recommended — without it the list page has no tenant context, the
 * client picker doesn't auto-select, and the detail panel never opens
 * for parent/staff users. See CLAUDE.md "Rules for future builders"
 * under Deep Links.
 */
export function buildDeepLink(
  entityType: DeepLinkEntity,
  entityId: string,
  clientSheetId?: string | null,
): string {
  const base = `#/${entityType}`;
  const params: string[] = [`open=${encodeURIComponent(entityId)}`];
  if (clientSheetId) params.push(`client=${encodeURIComponent(clientSheetId)}`);
  return `${base}?${params.join('&')}`;
}

/**
 * Full mystridehub.com URL variant — for `window.open(..., '_blank')`
 * and email templates that need an absolute href.
 */
export function buildDeepLinkUrl(
  entityType: DeepLinkEntity,
  entityId: string,
  clientSheetId?: string | null,
): string {
  const hash = buildDeepLink(entityType, entityId, clientSheetId);
  if (typeof window === 'undefined') {
    return `https://www.mystridehub.com/${hash}`;
  }
  return `${window.location.origin}${window.location.pathname}${hash}`;
}
