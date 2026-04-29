/**
 * BackfillDocsPanel — Settings → Maintenance card that copies historical
 * Drive PDFs (Receiving / Repair WO / Will Call Release) into Supabase
 * Storage + public.documents so they appear in each entity's Docs tab.
 *
 * Drives the `backfillDocsFromDrive` POST endpoint (StrideAPI v38.142.0).
 * The endpoint is resumable: each call processes ~5 minutes of work then
 * returns { done: false, cursor }. We poll until { done: true } and
 * track per-client running totals so the user sees real-time progress.
 *
 * Two modes:
 *   - Dry run: counts what would be copied without writing to Supabase.
 *   - Execute: actually uploads + inserts.
 *
 * Idempotent on the server side — re-running on a client that's already
 * fully backfilled simply bumps `skipped` and exits with done: true.
 */
import { useState, useCallback, useMemo } from 'react';
import { Database, FolderUp, CheckCircle2, AlertCircle, PlayCircle } from 'lucide-react';
import { theme } from '../../styles/theme';
import { BtnSpinner } from '../ui/BtnSpinner';
import { postBackfillDocsFromDrive } from '../../lib/api';
import type { ApiClient } from '../../lib/api';

interface ClientProgress {
  clientName: string;
  spreadsheetId: string;
  /** Running totals across all polls for this client. */
  scanned: number;
  copied: number;
  skipped: number;
  errored: number;
  /** 'idle' | 'running' | 'done' | 'error' */
  state: 'idle' | 'running' | 'done' | 'error';
  errorMessage?: string;
  /** Sample of the first few errors from the server (deduped). */
  errorSamples: Array<{ contextType: string; contextId: string; fileName: string; error: string }>;
}

interface Props {
  apiClients: ApiClient[];
  apiConfigured: boolean;
}

export function BackfillDocsPanel({ apiClients, apiConfigured }: Props) {
  const eligibleClients = useMemo(
    () => apiClients
      .filter(c => c.active && c.spreadsheetId)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [apiClients]
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [progress, setProgress] = useState<Record<string, ClientProgress>>({});
  const [globalError, setGlobalError] = useState<string>('');

  const allSelected = selected.size === eligibleClients.length && eligibleClients.length > 0;

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligibleClients.map(c => c.spreadsheetId)));
    }
  }, [allSelected, eligibleClients]);

  const toggleOne = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  /**
   * Poll the resumable endpoint for one client until done. Updates the
   * progress row after every poll so the UI reflects partial progress.
   */
  const runOneClient = useCallback(async (client: { spreadsheetId: string; name: string }, useDryRun: boolean) => {
    // Initialize row.
    setProgress(prev => ({
      ...prev,
      [client.spreadsheetId]: {
        clientName: client.name,
        spreadsheetId: client.spreadsheetId,
        scanned: 0, copied: 0, skipped: 0, errored: 0,
        state: 'running',
        errorSamples: [],
      },
    }));

    // Maximum poll iterations. The server enforces a 5-min budget per call
    // and a 400-file cap; a client with 5,000 PDFs would need ~13 calls.
    // 50 is generous headroom against runaway loops.
    const MAX_POLLS = 50;
    let attempt = 0;
    while (attempt < MAX_POLLS) {
      attempt++;
      let resp: Awaited<ReturnType<typeof postBackfillDocsFromDrive>>;
      try {
        resp = await postBackfillDocsFromDrive(client.spreadsheetId, { dryRun: useDryRun });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setProgress(prev => ({
          ...prev,
          [client.spreadsheetId]: {
            ...prev[client.spreadsheetId],
            state: 'error',
            errorMessage: msg,
          },
        }));
        return;
      }
      if (!resp.ok || !resp.data) {
        setProgress(prev => ({
          ...prev,
          [client.spreadsheetId]: {
            ...prev[client.spreadsheetId],
            state: 'error',
            errorMessage: resp.error || 'Backfill request failed',
          },
        }));
        return;
      }

      const d = resp.data;
      setProgress(prev => {
        const cur = prev[client.spreadsheetId];
        const samples = cur ? [...cur.errorSamples] : [];
        // Append new error samples up to 5 total per client so the row
        // doesn't blow up if a client has many corrupt PDFs.
        if (d.errors && samples.length < 5) {
          for (const e of d.errors) {
            if (samples.length >= 5) break;
            samples.push(e);
          }
        }
        return {
          ...prev,
          [client.spreadsheetId]: {
            ...cur,
            scanned: (cur?.scanned || 0) + (d.scanned || 0),
            copied:  (cur?.copied  || 0) + (d.copied  || 0),
            skipped: (cur?.skipped || 0) + (d.skipped || 0),
            errored: (cur?.errored || 0) + (d.errored || 0),
            state: d.done ? 'done' : 'running',
            errorSamples: samples,
          },
        };
      });

      if (d.done) return;
      // Brief breather between polls so we're not pinning a single tab
      // and so the operator's progress UI has time to repaint.
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    // Hit the poll cap without seeing done — surface as an error so the
    // operator knows to re-run / inspect logs.
    setProgress(prev => ({
      ...prev,
      [client.spreadsheetId]: {
        ...prev[client.spreadsheetId],
        state: 'error',
        errorMessage: `Hit poll cap (${MAX_POLLS}); re-run to continue from cursor.`,
      },
    }));
  }, []);

  const handleRun = useCallback(async () => {
    if (selected.size === 0) {
      setGlobalError('Select at least one client first.');
      return;
    }
    if (!apiConfigured) {
      setGlobalError('API not configured — Settings → Integrations.');
      return;
    }
    setGlobalError('');
    setRunning(true);
    // Reset state for the about-to-run set so re-runs don't show stale numbers.
    setProgress(prev => {
      const next = { ...prev };
      for (const id of selected) delete next[id];
      return next;
    });

    const targets = eligibleClients.filter(c => selected.has(c.spreadsheetId));
    // Run sequentially so we don't blow up the Stride API web app with
    // concurrent long-running calls. Operator sees each client tick over.
    for (const c of targets) {
      await runOneClient(c, dryRun);
    }

    setRunning(false);
  }, [selected, apiConfigured, eligibleClients, dryRun, runOneClient]);

  // ── Render ──────────────────────────────────────────────────────────────
  const card: React.CSSProperties = {
    background: '#fff', border: `1px solid ${theme.colors.border}`,
    borderRadius: 12, padding: 18,
  };

  const totals = useMemo(() => {
    let scanned = 0, copied = 0, skipped = 0, errored = 0, done = 0;
    for (const id of selected) {
      const p = progress[id];
      if (!p) continue;
      scanned += p.scanned; copied += p.copied; skipped += p.skipped; errored += p.errored;
      if (p.state === 'done') done++;
    }
    return { scanned, copied, skipped, errored, done };
  }, [progress, selected]);

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <FolderUp size={15} color="#1D4ED8" />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Backfill Drive PDFs to Docs Tab</div>
          </div>
          <div style={{ fontSize: 12, color: theme.colors.textSecondary, lineHeight: 1.5, marginLeft: 38 }}>
            Copies historical Receiving / Work Order / Will Call Release PDFs from each client's Drive folders into Supabase so they appear in the entity Docs tab. Idempotent — re-runs skip files already present. Use <strong>Dry run</strong> first to count what would be copied.
          </div>
          <div style={{ marginTop: 8, marginLeft: 38, padding: '8px 10px', borderRadius: 6, background: '#FFFBEB', border: '1px solid #FDE68A', fontSize: 11, color: '#92400E', lineHeight: 1.4 }}>
            <strong>⚠ Keep this tab open until done.</strong> The endpoint is resumable but the polling loop runs in your browser — closing the tab stops the loop mid-client.
          </div>
        </div>
      </div>

      {globalError && (
        <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#991B1B' }}>
          {globalError}
        </div>
      )}

      {/* Mode + Run button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: running ? 'not-allowed' : 'pointer' }}>
          <input
            type="checkbox"
            checked={dryRun}
            disabled={running}
            onChange={e => setDryRun(e.target.checked)}
            style={{ accentColor: theme.colors.orange }}
          />
          Dry run (count only — no writes)
        </label>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleRun}
          disabled={running || !apiConfigured || selected.size === 0}
          style={{
            padding: '8px 18px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8,
            background: running ? theme.colors.border : theme.colors.orange,
            color: running ? theme.colors.textMuted : '#fff',
            cursor: running || !apiConfigured || selected.size === 0 ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6,
            opacity: !apiConfigured || selected.size === 0 ? 0.5 : 1,
          }}
        >
          {running ? <BtnSpinner size={12} color="#fff" /> : <PlayCircle size={13} />}
          {running
            ? `Running… ${totals.done}/${selected.size} done`
            : dryRun ? `Dry run for ${selected.size || '0'} client(s)` : `Backfill ${selected.size || '0'} client(s)`}
        </button>
      </div>

      {/* Client list */}
      <div style={{ marginTop: 14, border: `1px solid ${theme.colors.borderLight}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '32px 1fr 80px 80px 80px 80px 90px',
          padding: '10px 14px', background: theme.colors.bgSubtle,
          fontSize: 10, fontWeight: 700, color: theme.colors.textMuted,
          textTransform: 'uppercase', letterSpacing: '1px', borderBottom: `1px solid ${theme.colors.borderLight}`,
        }}>
          <div>
            <input
              type="checkbox"
              checked={allSelected}
              disabled={running}
              onChange={toggleAll}
              style={{ accentColor: theme.colors.orange, cursor: running ? 'not-allowed' : 'pointer' }}
              aria-label="Select all"
            />
          </div>
          <div>Client</div>
          <div style={{ textAlign: 'right' }}>Scanned</div>
          <div style={{ textAlign: 'right' }}>Copied</div>
          <div style={{ textAlign: 'right' }}>Skipped</div>
          <div style={{ textAlign: 'right' }}>Errored</div>
          <div style={{ textAlign: 'right' }}>State</div>
        </div>
        {eligibleClients.length === 0 ? (
          <div style={{ padding: 18, fontSize: 12, color: theme.colors.textMuted, textAlign: 'center' }}>
            No active clients with a spreadsheet ID found.
          </div>
        ) : (
          eligibleClients.map(c => {
            const p = progress[c.spreadsheetId];
            const checked = selected.has(c.spreadsheetId);
            return (
              <div key={c.spreadsheetId}>
                <div
                  style={{
                    display: 'grid', gridTemplateColumns: '32px 1fr 80px 80px 80px 80px 90px',
                    padding: '8px 14px', alignItems: 'center',
                    fontSize: 12, borderBottom: `1px solid ${theme.colors.borderLight}`,
                    background: p?.state === 'running' ? '#FEF7ED' : '#fff',
                  }}
                >
                  <div>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={running}
                      onChange={() => toggleOne(c.spreadsheetId)}
                      style={{ accentColor: theme.colors.orange, cursor: running ? 'not-allowed' : 'pointer' }}
                      aria-label={`Select ${c.name}`}
                    />
                  </div>
                  <div style={{ fontWeight: 500, color: theme.colors.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name}
                  </div>
                  <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: theme.colors.textSecondary }}>
                    {p?.scanned ?? '—'}
                  </div>
                  <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: p?.copied ? '#15803D' : theme.colors.textSecondary, fontWeight: p?.copied ? 600 : 400 }}>
                    {p?.copied ?? '—'}
                  </div>
                  <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: theme.colors.textSecondary }}>
                    {p?.skipped ?? '—'}
                  </div>
                  <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: p?.errored ? '#DC2626' : theme.colors.textSecondary, fontWeight: p?.errored ? 600 : 400 }}>
                    {p?.errored ?? '—'}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {!p && <span style={{ color: theme.colors.textMuted }}>idle</span>}
                    {p?.state === 'running' && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#B45309' }}>
                        <BtnSpinner size={10} color="#B45309" /> running
                      </span>
                    )}
                    {p?.state === 'done' && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#15803D' }}>
                        <CheckCircle2 size={12} /> done
                      </span>
                    )}
                    {p?.state === 'error' && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#DC2626' }}>
                        <AlertCircle size={12} /> error
                      </span>
                    )}
                  </div>
                </div>
                {p?.errorMessage && (
                  <div style={{ padding: '6px 14px 8px 60px', fontSize: 11, color: '#991B1B', background: '#FEF2F2' }}>
                    {p.errorMessage}
                  </div>
                )}
                {p?.errorSamples && p.errorSamples.length > 0 && (
                  <div style={{ padding: '6px 14px 8px 60px', fontSize: 11, color: '#92400E', background: '#FFFBEB' }}>
                    First {p.errorSamples.length} file error{p.errorSamples.length === 1 ? '' : 's'}:
                    <ul style={{ margin: '4px 0 0 12px', padding: 0 }}>
                      {p.errorSamples.map((e, i) => (
                        <li key={i}>
                          <code style={{ fontSize: 10 }}>{e.contextType}/{e.contextId}/{e.fileName}</code>: {e.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Totals row */}
      {Object.keys(progress).length > 0 && (
        <div style={{
          marginTop: 12, padding: '10px 14px', borderRadius: 8,
          background: theme.colors.bgSubtle, fontSize: 12,
          display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <Database size={13} color={theme.colors.textMuted} />
          <span><strong>{totals.done}</strong>/{selected.size} clients done</span>
          <span style={{ color: theme.colors.textMuted }}>•</span>
          <span>Scanned: <strong>{totals.scanned}</strong></span>
          <span>Copied: <strong style={{ color: '#15803D' }}>{totals.copied}</strong></span>
          <span>Skipped: <strong>{totals.skipped}</strong></span>
          {totals.errored > 0 && <span>Errored: <strong style={{ color: '#DC2626' }}>{totals.errored}</strong></span>}
          {dryRun && <span style={{ marginLeft: 'auto', color: '#92400E', fontStyle: 'italic' }}>(dry run — nothing was actually written)</span>}
        </div>
      )}
    </div>
  );
}
