/**
 * useClientTcSendHistory — when was the last refresh-intake / T&C invite
 * sent to each existing client?
 *
 * Backs the hover tooltip on the "Send T&C" / "Re-send T&C" buttons in
 * Settings → Clients so staff can see at a glance when (and whether)
 * an invite already went out, before clicking and accidentally sending
 * a duplicate.
 *
 * Source: public.email_sends. We pull every successful send for the
 * two intake-related templates and group client-side by the first
 * recipient (which is always the client's email — bcc'd "send me a
 * copy" rows go through bcc_emails, not to_emails). Recent enough
 * that a single un-paginated SELECT is fine for the foreseeable;
 * if it ever grows past a few thousand rows we can switch to a
 * server-side aggregation view.
 *
 * Refetches on entityEvents 'client' (mirrors useClientTcStatus) so
 * the tooltip flips after a fresh send without a page reload.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { entityEvents } from '../lib/entityEvents';

export interface ClientTcSendRecord {
  /** ISO timestamp of the most recent staff-initiated send (refresh
   *  invite or initial intake invite). */
  lastManualSentAt: string | null;
  /** ISO timestamp of the most recent automated reminder cron send.
   *  Separate field so the tooltip can distinguish "you nudged them"
   *  from "the system nudged them". */
  lastReminderSentAt: string | null;
  /** Total successful sends across all template_keys for this email. */
  count: number;
  /** template_key of the most recent send overall. */
  templateKey: string;
}

const MANUAL_TEMPLATES = new Set(['ACCOUNT_REFRESH_INVITATION', 'CLIENT_INTAKE_INVITE']);
const REMINDER_TEMPLATES = new Set(['INTAKE_RESIGN_REMINDER']);
const ALL_TEMPLATES = [...MANUAL_TEMPLATES, ...REMINDER_TEMPLATES];

export function useClientTcSendHistory(): {
  sendMap: Map<string, ClientTcSendRecord>;
  loading: boolean;
  refetch: () => Promise<void>;
} {
  const [sendMap, setSendMap] = useState<Map<string, ClientTcSendRecord>>(new Map());
  const [loading, setLoading] = useState(true);

  const fetchSendMap = useCallback(async () => {
    const { data } = await supabase
      .from('email_sends')
      .select('template_key, to_emails, sent_at, status')
      .in('template_key', ALL_TEMPLATES)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false });

    const m = new Map<string, ClientTcSendRecord>();
    for (const row of (data ?? []) as Array<{
      template_key: string;
      to_emails: string[] | null;
      sent_at: string | null;
      status: string;
    }>) {
      if (!row.sent_at || !row.to_emails || row.to_emails.length === 0) continue;
      // First recipient is the client; bcc copies live in bcc_emails so
      // we don't accidentally credit the staff member's address.
      const primary = row.to_emails[0]?.toLowerCase().trim();
      if (!primary) continue;
      const isReminder = REMINDER_TEMPLATES.has(row.template_key);
      const existing = m.get(primary);
      if (!existing) {
        m.set(primary, {
          lastManualSentAt: isReminder ? null : row.sent_at,
          lastReminderSentAt: isReminder ? row.sent_at : null,
          count: 1,
          templateKey: row.template_key,
        });
      } else {
        // Rows are pre-sorted desc by sent_at, so the FIRST hit per
        // (email, bucket) is the most recent for that bucket.
        if (isReminder && !existing.lastReminderSentAt) {
          existing.lastReminderSentAt = row.sent_at;
        } else if (!isReminder && !existing.lastManualSentAt) {
          existing.lastManualSentAt = row.sent_at;
        }
        existing.count += 1;
      }
    }
    setSendMap(m);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchSendMap();
  }, [fetchSendMap]);

  // The IntakesPanel emits 'client' on activation; refresh so any new
  // sends since the user opened the page show up in the tooltip.
  useEffect(() => {
    const unsub = entityEvents.subscribe((entityType) => {
      if (entityType === 'client') {
        void fetchSendMap();
      }
    });
    return unsub;
  }, [fetchSendMap]);

  return { sendMap, loading, refetch: fetchSendMap };
}

/**
 * Format a send-history record for use in a button title attribute.
 * Returns a multi-line string suitable for the native tooltip with
 * separate lines for the most recent staff send and the most recent
 * automated reminder. Returns null when no record exists at all.
 */
export function formatTcSendTitle(rec: ClientTcSendRecord | undefined): string | null {
  if (!rec) return null;
  const lines: string[] = [];
  if (rec.lastManualSentAt) lines.push(`Last sent: ${formatStamp(rec.lastManualSentAt)}`);
  if (rec.lastReminderSentAt) lines.push(`Last reminder (auto): ${formatStamp(rec.lastReminderSentAt)}`);
  if (rec.count > 1) lines.push(`${rec.count} total sends`);
  return lines.length > 0 ? lines.join('\n') : null;
}

/** MM/DD/YY HH:MM:SS in local time so the operator can mentally compare
 *  against "now" without timezone math. */
function formatStamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${yy} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
