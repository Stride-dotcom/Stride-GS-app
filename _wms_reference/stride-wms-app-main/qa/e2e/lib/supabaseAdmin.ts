import { createClient } from '@supabase/supabase-js';
import { requireEnv } from './env.js';

let adminClient: ReturnType<typeof createClient> | null = null;

/** Get or create Supabase admin client using service role key. */
export function getSupabaseAdmin() {
  if (!adminClient) {
    adminClient = createClient(
      requireEnv('SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }
  return adminClient;
}

const ORDER_COLUMNS = ['created_at', 'updated_at', 'id'] as const;

/**
 * Fetch the most recent row ID from a table.
 * Tries ordering by created_at, updated_at, id in sequence.
 * Attempts soft-delete filters first, then retries without them.
 */
export async function getDynamicId(
  table: string,
  opts?: { tenantId?: string },
): Promise<string | null> {
  const client = getSupabaseAdmin();

  for (const column of ORDER_COLUMNS) {
    // First attempt: with soft-delete filters (best-effort)
    {
      let query = client
        .from(table)
        .select('id')
        .order(column, { ascending: false })
        .limit(1);

      if (opts?.tenantId) {
        query = query.eq('tenant_id', opts.tenantId);
      }

      // Apply soft-delete filters (best-effort)
      query = query
        .is('deleted_at', null)
        .eq('is_deleted', false);

      const response = await query;

      if (!response.error) {
        const rows = response.data as Record<string, unknown>[] | null;
        if (rows && rows.length > 0) {
          return String(rows[0].id);
        }
        // No rows with soft-delete filters, try next column
        continue;
      }
      // response.error — likely column doesn't exist; fall through to retry
    }

    // Second attempt: without soft-delete filters
    {
      let query = client
        .from(table)
        .select('id')
        .order(column, { ascending: false })
        .limit(1);

      if (opts?.tenantId) {
        query = query.eq('tenant_id', opts.tenantId);
      }

      const response = await query;

      if (!response.error) {
        const rows = response.data as Record<string, unknown>[] | null;
        if (rows && rows.length > 0) {
          return String(rows[0].id);
        }
        // No rows, try next column
        continue;
      }
      // response.error — try next column
    }
  }

  return null;
}
