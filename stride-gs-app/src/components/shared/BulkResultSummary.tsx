import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, XCircle, X, ChevronDown, ChevronRight } from 'lucide-react';
import { theme } from '../../styles/theme';
import type { BatchMutationResult } from '../../lib/api';

/**
 * BulkResultSummary — final outcome modal shown after any bulk action completes.
 *
 * Replaces generic toast feedback so partial failures are never hidden. Users
 * get concrete counts (succeeded / failed / skipped) plus an expandable list
 * of per-id reasons for every row that didn't fully succeed.
 *
 * v38.9.0 / Bulk Action Toolbar work.
 */

export interface BulkResultSummaryProps {
  open: boolean;
  actionLabel: string; // e.g. "Cancel Tasks", "Send Quotes"
  result: BatchMutationResult | null;
  onClose: () => void;
}

export function BulkResultSummary({ open, actionLabel, result, onClose }: BulkResultSummaryProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (!open || !result) return null;

  const hasIssues = result.failed > 0 || result.skipped.length > 0;
  const allSucceeded = result.failed === 0 && result.skipped.length === 0 && result.succeeded > 0;
  const allSkipped = result.succeeded === 0 && result.failed === 0 && result.skipped.length > 0;

  let headerIcon: React.ReactNode;
  let headerColor: string;
  let headerBg: string;
  if (!result.success) {
    headerIcon = <XCircle size={20} color="#DC2626" />;
    headerColor = '#991B1B';
    headerBg = '#FEF2F2';
  } else if (allSucceeded) {
    headerIcon = <CheckCircle2 size={20} color="#16A34A" />;
    headerColor = '#15803D';
    headerBg = '#F0FDF4';
  } else if (allSkipped) {
    headerIcon = <AlertTriangle size={20} color="#B45309" />;
    headerColor = '#92400E';
    headerBg = '#FEF3C7';
  } else {
    headerIcon = <AlertTriangle size={20} color="#B45309" />;
    headerColor = '#92400E';
    headerBg = '#FEF3C7';
  }

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        padding: 16,
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          width: '100%',
          maxWidth: 520,
          maxHeight: '85vh',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          overflow: 'hidden',
          fontFamily: 'inherit',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: `1px solid ${theme.colors.border}`,
            background: headerBg,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {headerIcon}
            <span style={{ fontWeight: 700, fontSize: 15, color: headerColor }}>
              {actionLabel} — {result.success ? (allSucceeded ? 'Complete' : 'Finished with issues') : 'Aborted'}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: headerColor, padding: 4 }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Counts */}
        <div style={{ padding: '18px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <CountChip label="Succeeded" value={result.succeeded} color="#16A34A" bg="#F0FDF4" />
          {result.failed > 0 && <CountChip label="Failed" value={result.failed} color="#DC2626" bg="#FEF2F2" />}
          {result.skipped.length > 0 && (
            <CountChip label="Skipped" value={result.skipped.length} color="#B45309" bg="#FEF3C7" />
          )}
          <CountChip label="Total" value={result.processed} color={theme.colors.textSecondary} bg={theme.colors.bgSubtle} />
        </div>

        {result.message && !hasIssues && (
          <div style={{ padding: '0 18px 12px', fontSize: 12, color: theme.colors.textMuted }}>
            {result.message}
          </div>
        )}

        {/* Details toggle */}
        {hasIssues && (
          <div style={{ padding: '0 18px 12px', flex: 1, overflow: 'auto' }}>
            <button
              onClick={() => setDetailsOpen(o => !o)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: 12,
                fontWeight: 600,
                color: theme.colors.textSecondary,
                cursor: 'pointer',
                fontFamily: 'inherit',
                marginBottom: 8,
              }}
            >
              {detailsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Show details ({result.failed + result.skipped.length})
            </button>
            {detailsOpen && (
              <div
                style={{
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: 8,
                  overflow: 'hidden',
                  fontSize: 11,
                }}
              >
                {result.errors.map((e, i) => (
                  <div
                    key={`err-${i}`}
                    style={{
                      padding: '6px 10px',
                      borderBottom: `1px solid ${theme.colors.borderLight}`,
                      background: '#FEF2F2',
                      display: 'flex',
                      gap: 8,
                    }}
                  >
                    <XCircle size={11} color="#DC2626" style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <div style={{ fontWeight: 700, color: '#991B1B', fontFamily: 'monospace' }}>{e.id}</div>
                      <div style={{ color: '#991B1B' }}>{e.reason}</div>
                    </div>
                  </div>
                ))}
                {result.skipped.map((s, i) => (
                  <div
                    key={`skip-${i}`}
                    style={{
                      padding: '6px 10px',
                      borderBottom: `1px solid ${theme.colors.borderLight}`,
                      background: '#FEF3C7',
                      display: 'flex',
                      gap: 8,
                    }}
                  >
                    <AlertTriangle size={11} color="#B45309" style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <div style={{ fontWeight: 700, color: '#92400E', fontFamily: 'monospace' }}>{s.id}</div>
                      <div style={{ color: '#92400E' }}>{s.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!result.success && result.message && (
          <div
            style={{
              margin: '0 18px 12px',
              padding: '8px 12px',
              background: '#FEF2F2',
              border: '1px solid #FCA5A5',
              borderRadius: 8,
              fontSize: 12,
              color: '#991B1B',
            }}
          >
            {result.message}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '12px 18px',
            borderTop: `1px solid ${theme.colors.border}`,
            background: theme.colors.bgSubtle,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: '8px 20px',
              fontSize: 13,
              fontWeight: 700,
              border: 'none',
              borderRadius: 8,
              background: theme.colors.orange,
              color: '#fff',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function CountChip({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '8px 12px',
        borderRadius: 8,
        background: bg,
        minWidth: 80,
        flex: '0 0 auto',
      }}
    >
      <span style={{ fontSize: 22, fontWeight: 800, color }}>{value}</span>
      <span style={{ fontSize: 10, fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </span>
    </div>
  );
}
