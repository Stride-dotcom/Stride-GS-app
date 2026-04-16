/**
 * Centralized role display-name mapping.
 *
 * Internal role slugs (stored in the DB) should never be shown directly to
 * subscribers.  Use `getRoleDisplayName()` anywhere a role name is rendered in
 * the UI.
 */

const ROLE_DISPLAY_NAMES: Record<string, string> = {
  admin: 'Admin',
  admin_dev: 'Developer',
  manager: 'Manager',
  warehouse: 'Warehouse',
  client_user: 'Client',
  technician: 'Technician',
  billing_manager: 'Billing Manager',
};

/**
 * Return a human-friendly display name for the given internal role slug.
 *
 * Falls back to title-casing the slug (splitting on `_`) when a role isn't in
 * the static map (e.g. custom tenant-created roles).
 */
export function getRoleDisplayName(slug: string): string {
  const mapped = ROLE_DISPLAY_NAMES[slug];
  if (mapped) return mapped;

  // Fallback: title-case each word separated by underscores
  return slug
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
