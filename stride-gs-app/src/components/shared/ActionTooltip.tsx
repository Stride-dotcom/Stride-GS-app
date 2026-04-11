import React, { useState } from 'react';
import { theme } from '../../styles/theme';

/**
 * Phase 7A Safety Net — ActionTooltip
 *
 * Wraps any button/element. When the action is disabled,
 * shows a tooltip on hover explaining WHY it's blocked.
 *
 * Usage:
 *   <ActionTooltip reason="Item must be Active to transfer" disabled={item.status !== 'Active'}>
 *     <button disabled={item.status !== 'Active'}>Transfer</button>
 *   </ActionTooltip>
 */

interface Props {
  children: React.ReactNode;
  /** Reason the action is blocked. Only shown when disabled=true */
  reason: string;
  /** Whether the action is disabled */
  disabled: boolean;
  /** Tooltip position */
  position?: 'top' | 'bottom';
}

export function ActionTooltip({ children, reason, disabled, position = 'top' }: Props) {
  const [show, setShow] = useState(false);

  if (!disabled) return <>{children}</>;

  return (
    <div
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div style={{
          position: 'absolute',
          [position === 'top' ? 'bottom' : 'top']: 'calc(100% + 6px)',
          left: '50%', transform: 'translateX(-50%)',
          background: '#1A1A1A', color: '#fff',
          padding: '6px 12px', borderRadius: 8,
          fontSize: 11, fontWeight: 500, lineHeight: 1.4,
          whiteSpace: 'nowrap', zIndex: 100,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          pointerEvents: 'none',
          fontFamily: theme.typography.fontFamily,
        }}>
          {reason}
          <div style={{
            position: 'absolute',
            [position === 'top' ? 'top' : 'bottom']: '100%',
            left: '50%', transform: 'translateX(-50%)',
            width: 0, height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            [position === 'top' ? 'borderTop' : 'borderBottom']: '5px solid #1A1A1A',
          }} />
        </div>
      )}
    </div>
  );
}

/**
 * Status-based action eligibility rules.
 * Returns null if the action is allowed, or a reason string if blocked.
 */
export const ACTION_RULES = {
  inventory: {
    createTask: (status: string) => ['Released', 'Transferred'].includes(status) ? `Cannot create task for ${status} items` : null,
    createWillCall: (status: string) => status !== 'Active' ? `Only Active items can be added to a will call` : null,
    transfer: (status: string) => status !== 'Active' ? `Only Active items can be transferred` : null,
    updateStatus: (status: string) => ['Released', 'Transferred'].includes(status) ? `${status} items cannot change status` : null,
  },
  task: {
    markComplete: (status: string) => status !== 'Open' ? `Only Open tasks can be completed` : null,
    cancel: (status: string) => status !== 'Open' ? `Only Open tasks can be cancelled` : null,
    reassign: (status: string) => status !== 'Open' ? `Only Open tasks can be reassigned` : null,
  },
  repair: {
    sendQuote: (status: string) => status !== 'Pending Quote' ? `Quote can only be sent for Pending Quote repairs` : null,
    approve: (status: string) => status !== 'Quote Sent' ? `Only Quote Sent repairs can be approved` : null,
    decline: (status: string) => status !== 'Quote Sent' ? `Only Quote Sent repairs can be declined` : null,
    markComplete: (status: string) => !['Approved', 'In Progress'].includes(status) ? `Only Approved or In Progress repairs can be completed` : null,
    cancel: (status: string) => ['Complete', 'Cancelled', 'Declined'].includes(status) ? `${status} repairs cannot be cancelled` : null,
  },
  willCall: {
    schedule: (status: string) => status !== 'Pending' ? `Only Pending will calls can be scheduled` : null,
    release: (status: string) => !['Scheduled', 'Partial'].includes(status) ? `Only Scheduled or Partial will calls can be released` : null,
    cancel: (status: string) => ['Released', 'Cancelled'].includes(status) ? `${status} will calls cannot be cancelled` : null,
  },
};
