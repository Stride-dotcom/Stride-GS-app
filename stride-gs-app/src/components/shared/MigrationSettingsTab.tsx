/**
 * MigrationSettingsTab — Settings → Migration tab.
 *
 * Admin-only surface for the GAS→Supabase migration's per-function
 * feature flags. Lets the operator:
 *   - See every flag's current state (active_backend, shadow, parity,
 *     tenant_scope, mismatch counts).
 *   - Toggle active_backend per row (gas ↔ supabase).
 *   - Toggle parity_enabled per row.
 *   - Edit tenant_scope per row (comma-separated client_sheet_ids;
 *     empty/blank = fleet-wide / NULL).
 *   - Fire the master switch (MIG-003 emergency global revert): one
 *     batched UPDATE flips every active_backend back to 'gas' and
 *     clears every tenant_scope. Behind a confirmation dialog.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md, decisions
 * MIG-003 (master switch is emergency revert only) and MIG-010
 * (per-tenant scope semantics).
 *
 * State source: public.feature_flags. Reads are realtime-subscribed
 * via FeatureFlagContext (P1.5); writes are direct supabase-js
 * UPDATE/PATCH calls. RLS enforces admin-only writes.
 *
 * Mismatch counts are read directly off feature_flags.mismatch_count_7d
 * which today stays at 0. The replay harness (P1.7) will populate
 * mismatch_count_7d as it lands shadow runs in parity_results.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, RotateCcw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAllFeatureFlags, useFeatureFlagLoading } from '../../contexts/FeatureFlagContext';
import type { Backend, FeatureFlagRow } from '../../contexts/FeatureFlagContext';
import { ConfirmDialog } from './ConfirmDialog';
import { theme } from '../../styles/theme';

// ─── Phase grouping (stays in sync with MIGRATION_STATUS.md inventory) ───────

const PHASE_FOR_KEY: Record<string, string> = {
  updateItem: 'P2', updateTask: 'P2', updateRepair: 'P2', updateShipment: 'P2',
  startTask: 'P3', startRepair: 'P3', createTask: 'P3', createWillCall: 'P3',
  releaseItems: 'P3', sendShipmentEmail: 'P3', sendWillCallEmails: 'P3', sendRepairEmails: 'P3',
  completeTask: 'P4a', completeRepair: 'P4a', processWcRelease: 'P4a',
  commitStorageCharges: 'P4a', createInvoice: 'P4a', voidInvoice: 'P4a', reissueInvoice: 'P4a',
  transferItems: 'P5', receiveShipment: 'P5', onboardClient: 'P5',
  qboCreateInvoice: 'P6', createStaxInvoices: 'P6', runStaxCharges: 'P6',
};

const PHASE_ORDER = ['P2', 'P3', 'P4a', 'P4b', 'P5', 'P6', 'P7'];

const card: React.CSSProperties = {
  background: '#fff',
  border: `1px solid ${theme.colors.border}`,
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
};

const sectionTitle: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 12 };

const phaseHeader: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: theme.colors.textMuted,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  padding: '12px 0 6px',
  borderBottom: `1px solid ${theme.colors.border}`,
  marginTop: 16,
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: theme.colors.textMuted,
  borderBottom: `1px solid ${theme.colors.border}`,
};

const tdStyle: React.CSSProperties = {
  padding: '10px',
  borderBottom: `1px solid ${theme.colors.borderLight}`,
  verticalAlign: 'top',
};

function backendChipStyle(b: Backend): React.CSSProperties {
  const isSb = b === 'supabase';
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 999,
    background: isSb ? '#E0F2FE' : '#F5F5F5',
    color: isSb ? '#075985' : '#525252',
    border: `1px solid ${isSb ? '#7DD3FC' : '#E5E5E5'}`,
    cursor: 'pointer',
    userSelect: 'none',
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MigrationSettingsTab() {
  const flags = useAllFeatureFlags();
  const loading = useFeatureFlagLoading();
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [masterRevertOpen, setMasterRevertOpen] = useState(false);
  const [masterRevertProcessing, setMasterRevertProcessing] = useState(false);

  // Inline editor state for tenant_scope. Map of function_key → comma-string.
  // Only populated for rows the user actively edits (drives the input value);
  // rows without a key fall through to rendering flag.tenant_scope directly.
  const [scopeDrafts, setScopeDrafts] = useState<Record<string, string>>({});

  // Group by phase for visual organization. Functions without a phase
  // mapping (shouldn't happen, but safe) bucket under "Other".
  const grouped = useMemo(() => {
    const out: Record<string, FeatureFlagRow[]> = {};
    for (const f of flags) {
      const phase = PHASE_FOR_KEY[f.function_key] || 'Other';
      if (!out[phase]) out[phase] = [];
      out[phase].push(f);
    }
    return out;
  }, [flags]);

  // Active vs total counts for the header summary.
  const summary = useMemo(() => {
    const total = flags.length;
    const supabasePrimary = flags.filter(f => f.active_backend === 'supabase' && f.tenant_scope === null).length;
    const canary = flags.filter(f => f.tenant_scope !== null).length;
    const parity = flags.filter(f => f.parity_enabled).length;
    const mismatches = flags.reduce((sum, f) => sum + (f.mismatch_count_7d || 0), 0);
    return { total, supabasePrimary, canary, parity, mismatches };
  }, [flags]);

  async function patchFlag(key: string, patch: Partial<Pick<FeatureFlagRow, 'active_backend' | 'shadow_backend' | 'parity_enabled' | 'tenant_scope' | 'notes'>>): Promise<boolean> {
    setSavingKey(key);
    setError(null);
    const { error: err } = await supabase
      .from('feature_flags')
      .update(patch)
      .eq('function_key', key);
    setSavingKey(null);
    if (err) {
      setError(`Failed to update ${key}: ${err.message}`);
      return false;
    }
    return true;
  }

  async function toggleActiveBackend(flag: FeatureFlagRow) {
    const next: Backend = flag.active_backend === 'gas' ? 'supabase' : 'gas';
    await patchFlag(flag.function_key, { active_backend: next });
  }

  async function toggleParityEnabled(flag: FeatureFlagRow) {
    const next = !flag.parity_enabled;
    // When enabling parity, set shadow_backend to the OPPOSITE of
    // active_backend so something actually shadows. When disabling,
    // clear shadow_backend so the dashboard doesn't claim a stale
    // pairing.
    const patch: Partial<FeatureFlagRow> = { parity_enabled: next };
    if (next && !flag.shadow_backend) {
      patch.shadow_backend = flag.active_backend === 'gas' ? 'supabase' : 'gas';
    } else if (!next) {
      patch.shadow_backend = null;
    }
    await patchFlag(flag.function_key, patch);
  }

  function startScopeEdit(flag: FeatureFlagRow) {
    const text = flag.tenant_scope ? flag.tenant_scope.join(', ') : '';
    setScopeDrafts(s => ({ ...s, [flag.function_key]: text }));
  }

  function updateScopeDraft(key: string, text: string) {
    setScopeDrafts(s => ({ ...s, [key]: text }));
  }

  async function commitScopeEdit(flag: FeatureFlagRow) {
    const draft = scopeDrafts[flag.function_key];
    if (draft === undefined) return;
    const ids = Array.from(new Set(
      draft
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    ));
    const next = ids.length > 0 ? ids : null;
    const ok = await patchFlag(flag.function_key, { tenant_scope: next });
    if (ok) {
      // Clear the draft so the row goes back to displaying the canonical row value.
      setScopeDrafts(s => {
        const { [flag.function_key]: _drop, ...rest } = s;
        return rest;
      });
    }
  }

  function cancelScopeEdit(key: string) {
    setScopeDrafts(s => {
      const { [key]: _drop, ...rest } = s;
      return rest;
    });
  }

  async function runMasterRevert() {
    setMasterRevertProcessing(true);
    setError(null);
    // MIG-003 emergency global revert. Sets:
    //   active_backend = 'gas'
    //   tenant_scope   = NULL   (REQUIRED by MIG-010 semantics — leaving
    //                            a non-null tenant_scope alongside
    //                            active_backend='gas' would route
    //                            non-listed tenants to the OPPOSITE
    //                            backend (=supabase), the exact thing
    //                            the operator is trying to back out of.)
    // Intentionally NOT cleared:
    //   parity_enabled  — keep parity logging running during the
    //                     incident; it's the diagnostic surface that
    //                     told us to revert in the first place.
    //   shadow_backend  — same reason.
    //
    // Predicate: .gte('function_key','') matches every non-null
    // function_key (which is the PK, so every row). PostgREST emits a
    // single UPDATE statement, atomic at the SQL level. A future cleanup
    // could expose this as a SECURITY DEFINER RPC for stronger atomicity
    // semantics + audit logging — tracked as a P1.6 follow-up.
    const { error: err } = await supabase
      .from('feature_flags')
      .update({ active_backend: 'gas', tenant_scope: null })
      .gte('function_key', '');
    setMasterRevertProcessing(false);
    if (err) {
      setError(`Master revert failed: ${err.message}`);
      return;
    }
    setMasterRevertOpen(false);
  }

  if (loading) {
    return (
      <div style={{ ...card, color: theme.colors.textMuted, fontSize: 13 }}>
        Loading migration flags…
      </div>
    );
  }

  return (
    <>
      {/* Header card with summary + master switch */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={sectionTitle}>GAS → Supabase Migration</div>
            <div style={{ fontSize: 12, color: theme.colors.textMuted, lineHeight: 1.5 }}>
              Per-function feature flags driving the migration cutover. See <code>stride-gs-app/MIGRATION_STATUS.md</code> for project state, MIG-001 through MIG-010 for decisions. Per-tenant scope semantics (MIG-010): scope null = fleet-wide; scope set = listed tenants get <code>active_backend</code>, others get the opposite.
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 24, fontSize: 12 }}>
              <Stat label="Total" value={summary.total} />
              <Stat label="On Supabase (fleet-wide)" value={summary.supabasePrimary} />
              <Stat label="Canary scoped" value={summary.canary} />
              <Stat label="Parity enabled" value={summary.parity} />
              <Stat label="Mismatches (7d)" value={summary.mismatches} highlight={summary.mismatches > 0} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMasterRevertOpen(true)}
            title="MIG-003 emergency revert: flips every active_backend back to gas + clears every tenant_scope. Parity flags stay on so diagnostic data keeps flowing during the incident."
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              fontSize: 12,
              fontWeight: 600,
              border: '1px solid #DC2626',
              borderRadius: 8,
              background: '#fff',
              color: '#DC2626',
              cursor: 'pointer',
            }}
          >
            <RotateCcw size={14} />
            Emergency Revert (Master Switch)
          </button>
        </div>
        {error && (
          <div style={{ marginTop: 12, padding: 10, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 12, color: '#991B1B' }}>
            <AlertTriangle size={12} style={{ display: 'inline', marginRight: 6 }} />
            {error}
          </div>
        )}
      </div>

      {/* One section per phase with a flag table inside */}
      <div style={card}>
        <div style={sectionTitle}>Function Flags</div>
        {PHASE_ORDER.map(phase => {
          const rows = grouped[phase] || [];
          if (rows.length === 0) return null;
          return (
            <div key={phase}>
              <div style={phaseHeader}>{phase} — {rows.length} function{rows.length === 1 ? '' : 's'}</div>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={thStyle}>Function</th>
                    <th style={thStyle}>Active</th>
                    <th style={thStyle}>Parity</th>
                    <th style={thStyle}>Tenant scope</th>
                    <th style={thStyle}>Match rate</th>
                    <th style={thStyle}>Mismatches (7d)</th>
                    <th style={thStyle}>Last check</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(f => {
                    const draft = scopeDrafts[f.function_key];
                    const inScopeEdit = draft !== undefined;
                    const isSaving = savingKey === f.function_key;
                    const hasMismatches = f.mismatch_count_7d > 0;
                    return (
                      <tr key={f.function_key}>
                        <td style={tdStyle}>
                          <div style={{ fontFamily: 'Consolas, Menlo, monospace', fontWeight: 600 }}>{f.function_key}</div>
                          {f.notes && <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 2 }}>{f.notes}</div>}
                        </td>
                        <td style={tdStyle}>
                          <button
                            type="button"
                            onClick={() => toggleActiveBackend(f)}
                            disabled={isSaving}
                            style={backendChipStyle(f.active_backend)}
                            title={`Click to flip to ${f.active_backend === 'gas' ? 'supabase' : 'gas'}`}
                          >
                            {f.active_backend}
                            <ArrowRight size={10} />
                          </button>
                        </td>
                        <td style={tdStyle}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: isSaving ? 'wait' : 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={f.parity_enabled}
                              disabled={isSaving}
                              onChange={() => toggleParityEnabled(f)}
                            />
                            {f.parity_enabled ? <span>shadow={f.shadow_backend || '?'}</span> : <span style={{ color: theme.colors.textMuted }}>off</span>}
                          </label>
                        </td>
                        <td style={tdStyle}>
                          {!inScopeEdit ? (
                            <button
                              type="button"
                              onClick={() => startScopeEdit(f)}
                              style={{
                                fontSize: 12,
                                padding: '4px 8px',
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: 6,
                                background: '#fff',
                                cursor: 'pointer',
                                textAlign: 'left',
                                minWidth: 200,
                              }}
                            >
                              {f.tenant_scope === null
                                ? <span style={{ color: theme.colors.textMuted }}>fleet-wide</span>
                                : <span style={{ fontFamily: 'Consolas, Menlo, monospace' }}>{f.tenant_scope.join(', ')}</span>
                              }
                            </button>
                          ) : (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                              <textarea
                                value={draft}
                                onChange={e => updateScopeDraft(f.function_key, e.target.value)}
                                rows={2}
                                placeholder="comma-separated tenant_ids; blank = fleet-wide"
                                style={{
                                  fontSize: 11,
                                  fontFamily: 'Consolas, Menlo, monospace',
                                  padding: '4px 8px',
                                  border: `1px solid ${theme.colors.border}`,
                                  borderRadius: 6,
                                  width: 250,
                                  resize: 'vertical',
                                }}
                              />
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <button
                                  type="button"
                                  onClick={() => commitScopeEdit(f)}
                                  disabled={isSaving}
                                  style={{ fontSize: 11, padding: '3px 6px', border: '1px solid #16A34A', borderRadius: 4, background: '#16A34A', color: '#fff', cursor: isSaving ? 'wait' : 'pointer' }}
                                  title="Save scope"
                                >
                                  <Check size={10} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => cancelScopeEdit(f.function_key)}
                                  style={{ fontSize: 11, padding: '3px 6px', border: `1px solid ${theme.colors.border}`, borderRadius: 4, background: '#fff', cursor: 'pointer' }}
                                  title="Cancel"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                        <td style={tdStyle}>
                          {f.total_checks > 0 && f.match_rate !== null ? (
                            <div title={`${f.total_checks - f.mismatch_count} matches / ${f.total_checks} checks (lifetime)`}>
                              <div style={{
                                fontWeight: 700,
                                color: f.match_rate >= 99.5 ? '#16A34A'
                                     : f.match_rate >= 95   ? '#CA8A04'
                                     : '#DC2626',
                              }}>{f.match_rate.toFixed(2)}%</div>
                              <div style={{ fontSize: 11, color: theme.colors.textMuted }}>
                                {f.total_checks.toLocaleString()} check{f.total_checks === 1 ? '' : 's'}
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: theme.colors.textMuted, fontSize: 12 }}>—</span>
                          )}
                        </td>
                        <td style={{ ...tdStyle, fontWeight: hasMismatches ? 700 : 400, color: hasMismatches ? '#DC2626' : theme.colors.textMuted }}>
                          {f.mismatch_count_7d}
                        </td>
                        <td style={{ ...tdStyle, color: theme.colors.textMuted, fontSize: 11 }}>
                          {f.last_parity_check ? new Date(f.last_parity_check).toLocaleString() : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={masterRevertOpen}
        title="Emergency revert — flip everything back to GAS?"
        variant="danger"
        confirmLabel="Revert all flags"
        cancelLabel="Cancel"
        processing={masterRevertProcessing}
        onCancel={() => setMasterRevertOpen(false)}
        onConfirm={runMasterRevert}
        message={
          <div style={{ fontSize: 13, lineHeight: 1.55 }}>
            <p style={{ margin: '0 0 10px' }}>This is the <strong>MIG-003 master switch</strong>: an emergency global revert. It will, in one atomic UPDATE:</p>
            <ul style={{ margin: '0 0 10px 18px', padding: 0 }}>
              <li>Flip every <code>active_backend</code> back to <code>gas</code>.</li>
              <li>Clear every <code>tenant_scope</code> back to NULL (required — see MIG-010, otherwise non-listed tenants would route to <code>supabase</code>).</li>
            </ul>
            <p style={{ margin: '0 0 10px' }}><code>parity_enabled</code> + <code>shadow_backend</code> stay as-is — keep parity diagnostics running during the incident.</p>
            <p style={{ margin: '0 0 10px' }}>Use only when a fleet-wide regression has appeared post-cutover. For a single-function or single-tenant revert, edit that flag's row instead.</p>
            <p style={{ margin: 0, color: '#991B1B' }}><strong>Currently affected:</strong> {summary.supabasePrimary} fleet-wide on supabase, {summary.canary} canary-scoped. After revert: 0 / 0.</p>
          </div>
        }
      />
    </>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: highlight ? '#DC2626' : theme.colors.text }}>{value}</div>
    </div>
  );
}
