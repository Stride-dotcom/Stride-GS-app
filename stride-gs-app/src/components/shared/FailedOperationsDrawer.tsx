/**
 * FailedOperationsDrawer — Phase 1 failure visibility panel.
 *
 * Slide-in panel showing all unresolved write failures for the current user.
 * Each failure shows: entity, action, client/item context, error, timestamp.
 * Actions: Retry (re-sends original API call) | Dismiss (marks resolved).
 *
 * Props-driven — the hook (useFailedOperations) lives in AppLayout so that
 * the badge count, drawer state, and Supabase subscription are all owned in
 * one place. No duplicate subscriptions.
 */

import { useState, useCallback } from 'react';
import { X, RefreshCw, CheckCircle, AlertCircle, Loader, ChevronRight } from 'lucide-react';
import { theme } from '../../styles/theme';
import { ACTION_LABELS, ENTITY_LABELS, type SyncEvent } from '../../hooks/useFailedOperations';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    );
  } catch {
    return iso;
  }
}

function actionLabel(actionType: string): string {
  return ACTION_LABELS[actionType] ?? actionType.replace(/_/g, ' ');
}

function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType;
}

/** Extract human-readable context from the stored payload */
function summarizePayload(event: SyncEvent): string {
  const p = event.payload ?? {};
  const parts: string[] = [];
  if (p.clientName) parts.push(String(p.clientName));
  if (p.description) parts.push(String(p.description));
  else if (p.itemId) parts.push(`Item ${p.itemId}`);
  if (p.result) parts.push(`Result: ${p.result}`);
  if (p.sidemark) parts.push(String(p.sidemark));
  return parts.join(' · ') || '—';
}

// ─── Single failure row ───────────────────────────────────────────────────────

interface FailureRowProps {
  event: SyncEvent;
  onRetry: (event: SyncEvent) => Promise<{ ok: boolean; error: string | null }>;
  onDismiss: (id: string) => Promise<void>;
}

function FailureRow({ event, onRetry, onDismiss }: FailureRowProps) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retryOk, setRetryOk] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    setRetryError(null);
    setRetryOk(false);
    const result = await onRetry(event);
    setRetrying(false);
    if (result.ok) {
      setRetryOk(true);
    } else {
      setRetryError(result.error);
    }
  }, [event, onRetry]);

  const handleDismiss = useCallback(async () => {
    setDismissing(true);
    await onDismiss(event.id);
  }, [event.id, onDismiss]);

  const isTimeout = event.error_message?.includes('timed out');

  return (
    <div
      style={{
        border: `1px solid ${theme.colors.border}`,
        borderLeft: `3px solid ${theme.colors.statusRed}`,
        borderRadius: '6px',
        background: theme.colors.bgCard,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      {/* Header: entity badge + action + timestamp */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <span
          style={{
            fontSize: '10px',
            fontWeight: 600,
            color: theme.colors.primary,
            background: theme.colors.orangeLight,
            padding: '2px 6px',
            borderRadius: '4px',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            fontFamily: theme.typography.fontFamily,
          }}
        >
          {entityLabel(event.entity_type).toUpperCase()}
        </span>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: theme.typography.sizes.sm,
              fontWeight: 600,
              color: theme.colors.text,
              fontFamily: theme.typography.fontFamily,
            }}
          >
            {actionLabel(event.action_type)}{' '}
            <span style={{ color: theme.colors.textSecondary, fontWeight: 400 }}>
              {event.entity_id}
            </span>
          </div>
        </div>
        <span
          style={{
            fontSize: '11px',
            color: theme.colors.textMuted,
            whiteSpace: 'nowrap',
            flexShrink: 0,
            fontFamily: theme.typography.fontFamily,
          }}
        >
          {fmtDate(event.created_at)}
        </span>
      </div>

      {/* Payload summary */}
      <div
        style={{
          fontSize: '12px',
          color: theme.colors.textSecondary,
          fontFamily: theme.typography.fontFamily,
        }}
      >
        {summarizePayload(event)}
      </div>

      {/* Error message */}
      <div
        style={{
          fontSize: '12px',
          color: isTimeout ? theme.colors.statusAmber : theme.colors.statusRed,
          background: isTimeout ? theme.colors.statusAmberBg : theme.colors.statusRedBg,
          padding: '6px 8px',
          borderRadius: '4px',
          display: 'flex',
          gap: '6px',
          alignItems: 'flex-start',
          fontFamily: theme.typography.fontFamily,
        }}
      >
        <AlertCircle size={12} style={{ flexShrink: 0, marginTop: '2px' }} />
        <span>{event.error_message ?? 'Unknown error'}</span>
      </div>

      {/* Retry success feedback */}
      {retryOk && (
        <div
          style={{
            fontSize: '12px',
            color: theme.colors.statusGreen,
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
            fontFamily: theme.typography.fontFamily,
          }}
        >
          <CheckCircle size={12} />
          Retry succeeded
        </div>
      )}

      {/* Retry error feedback */}
      {retryError && (
        <div
          style={{
            fontSize: '12px',
            color: theme.colors.statusRed,
            background: theme.colors.statusRedBg,
            padding: '5px 8px',
            borderRadius: '4px',
            fontFamily: theme.typography.fontFamily,
          }}
        >
          Retry failed: {retryError}
        </div>
      )}

      {/* Actions row */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '2px', alignItems: 'center' }}>
        <button
          onClick={handleRetry}
          disabled={retrying || dismissing}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            padding: '5px 12px',
            fontSize: '12px',
            fontWeight: 600,
            fontFamily: theme.typography.fontFamily,
            background: retrying ? theme.colors.bgMuted : theme.colors.primary,
            color: retrying ? theme.colors.textSecondary : '#fff',
            border: 'none',
            borderRadius: '5px',
            cursor: retrying || dismissing ? 'default' : 'pointer',
          }}
        >
          {retrying ? (
            <><Loader size={11} style={{ animation: 'spin 1s linear infinite' }} /> Retrying…</>
          ) : (
            <><RefreshCw size={11} /> Retry</>
          )}
        </button>

        <button
          onClick={handleDismiss}
          disabled={retrying || dismissing}
          style={{
            padding: '5px 12px',
            fontSize: '12px',
            fontWeight: 500,
            fontFamily: theme.typography.fontFamily,
            background: 'transparent',
            color: theme.colors.textSecondary,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: '5px',
            cursor: retrying || dismissing ? 'default' : 'pointer',
          }}
        >
          {dismissing ? 'Dismissing…' : 'Dismiss'}
        </button>

        {/* Show requester for admin/staff viewing others' failures */}
        {event.requested_by && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '11px',
              color: theme.colors.textMuted,
              fontFamily: theme.typography.fontFamily,
            }}
          >
            {event.requested_by}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

export interface FailedOperationsDrawerProps {
  open: boolean;
  onClose: () => void;
  failures: SyncEvent[];
  loading: boolean;
  onRefetch: () => void;
  onRetry: (event: SyncEvent) => Promise<{ ok: boolean; error: string | null }>;
  onDismiss: (id: string) => Promise<void>;
}

export function FailedOperationsDrawer({
  open,
  onClose,
  failures,
  loading,
  onRefetch,
  onRetry,
  onDismiss,
}: FailedOperationsDrawerProps) {
  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.25)',
          zIndex: 200,
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '420px',
          maxWidth: '100vw',
          background: theme.colors.bgSubtle,
          borderLeft: `1px solid ${theme.colors.border}`,
          boxShadow: '-4px 0 24px rgba(0,0,0,0.10)',
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: theme.typography.fontFamily,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '16px 18px',
            borderBottom: `1px solid ${theme.colors.border}`,
            background: theme.colors.bgCard,
            flexShrink: 0,
          }}
        >
          <AlertCircle size={18} style={{ color: theme.colors.statusRed, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: theme.typography.sizes.md,
                fontWeight: 600,
                color: theme.colors.text,
              }}
            >
              Failed Operations
            </div>
            <div style={{ fontSize: '12px', color: theme.colors.textSecondary }}>
              {failures.length === 0
                ? 'No unresolved failures'
                : `${failures.length} unresolved failure${failures.length !== 1 ? 's' : ''}`}
            </div>
          </div>
          <button
            onClick={onRefetch}
            title="Refresh list"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              color: theme.colors.textSecondary,
            }}
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={onClose}
            title="Close"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              color: theme.colors.textSecondary,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          {loading && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                color: theme.colors.textSecondary,
                fontSize: '13px',
                padding: '12px 0',
              }}
            >
              <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
              Loading…
            </div>
          )}

          {!loading && failures.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '48px 20px',
                color: theme.colors.textMuted,
                fontSize: '13px',
              }}
            >
              <CheckCircle
                size={32}
                style={{ color: theme.colors.statusGreen, marginBottom: '12px', display: 'block', margin: '0 auto 12px' }}
              />
              <div
                style={{
                  fontWeight: 600,
                  color: theme.colors.textSecondary,
                  marginBottom: '4px',
                  fontSize: '14px',
                }}
              >
                All clear
              </div>
              <div>No failed operations to review.</div>
            </div>
          )}

          {failures.map((event) => (
            <FailureRow
              key={event.id}
              event={event}
              onRetry={onRetry}
              onDismiss={onDismiss}
            />
          ))}
        </div>

        {/* Footer hint */}
        {failures.length > 0 && (
          <div
            style={{
              padding: '10px 16px',
              borderTop: `1px solid ${theme.colors.border}`,
              background: theme.colors.bgCard,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontSize: '11px',
                color: theme.colors.textMuted,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <ChevronRight size={11} />
              Timeout errors may have partially applied — check the sheet before retrying.
            </div>
          </div>
        )}
      </div>

      {/* Spinner keyframes */}
      <style>
        {`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}
      </style>
    </>
  );
}
