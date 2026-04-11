import { AlertTriangle } from 'lucide-react';
import { theme } from '../../styles/theme';

/**
 * Phase 7A Safety Net — BatchGuard
 *
 * Checks if selected items span multiple clients.
 * Shows a warning modal if they do, blocking the batch action.
 * Used by all floating action bars before executing write operations.
 */

interface Props {
  /** Array of client names from selected rows */
  selectedClients: string[];
  /** Called when user dismisses the warning */
  onDismiss: () => void;
  /** The action name being attempted (e.g., "Create Will Call") */
  actionName: string;
}

export function BatchGuard({ selectedClients, onDismiss, actionName }: Props) {
  const uniqueClients = [...new Set(selectedClients)];
  if (uniqueClients.length <= 1) return null;

  return (
    <>
      <div onClick={onDismiss} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 300 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 420, maxWidth: '95vw', background: '#fff', borderRadius: 16,
        boxShadow: '0 8px 40px rgba(0,0,0,0.15)', zIndex: 301, padding: 28,
        fontFamily: theme.typography.fontFamily,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <AlertTriangle size={20} color="#B45309" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: theme.colors.text }}>Multiple Clients Selected</div>
            <div style={{ fontSize: 13, color: theme.colors.textSecondary, marginTop: 4, lineHeight: 1.5 }}>
              "{actionName}" requires all items to belong to the same client. Your selection includes items from {uniqueClients.length} clients:
            </div>
          </div>
        </div>
        <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 12, marginBottom: 20 }}>
          {uniqueClients.map(c => (
            <div key={c} style={{ fontSize: 13, padding: '4px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: theme.colors.orange, flexShrink: 0 }} />
              {c}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 16 }}>
          Please filter to a single client before performing this action.
        </div>
        <button onClick={onDismiss} style={{
          width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: 'none',
          borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: 'pointer',
          fontFamily: 'inherit',
        }}>Got it</button>
      </div>
    </>
  );
}

/**
 * Helper to check if a batch action should be blocked.
 * Returns the unique client names if multiple clients are selected.
 * Returns null if safe to proceed (single client or empty selection).
 */
export function checkBatchClientGuard(items: { clientName?: string; client?: string }[]): string[] | null {
  const clients = [...new Set(items.map(i => i.clientName || i.client || '').filter(Boolean))];
  if (clients.length <= 1) return null;
  return clients;
}
