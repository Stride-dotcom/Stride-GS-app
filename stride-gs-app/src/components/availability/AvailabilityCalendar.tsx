/**
 * AvailabilityCalendar — Delivery slot calendar (session 65).
 *
 * Visual month-grid where admins click dates to cycle open → limited → closed.
 * Shift+click for multi-select, bulk-apply toolbar. All users see the calendar
 * (read-only for staff/client). Inline styles with theme.ts — no Tailwind.
 *
 * Adapted from Stride WMS reference; rewritten for GS Inventory patterns.
 */
import React, { useState, useCallback, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useAvailabilityCalendar, type AvailabilityStatus } from '../../hooks/useAvailabilityCalendar';

// ── Constants ───────────────────────────────────────────────────────────
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_HEADERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const STATUS_CONFIG: Record<AvailabilityStatus, { label: string; bg: string; text: string; dot: string }> = {
  open:    { label: 'Open slots available',      bg: '#22C55E', text: '#052E16', dot: '#22C55E' },
  limited: { label: 'Limited — call to confirm', bg: '#F97316', text: '#431407', dot: '#F97316' },
  closed:  { label: 'No available slots',        bg: '#EF4444', text: '#450A0A', dot: '#EF4444' },
};

const STATUS_CYCLE: AvailabilityStatus[] = ['open', 'limited', 'closed'];

type ViewMode = '2month' | '3month' | 'year';

// ── Helpers ─────────────────────────────────────────────────────────────
function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function startDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function isPast(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr + 'T00:00:00') < today;
}

function formatLastUpdated(isoStr: string | null): string {
  if (!isoStr) return 'Never';
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function getVisibleMonths(view: ViewMode): { year: number; month: number }[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const count = view === 'year' ? 12 : view === '3month' ? 3 : 2;
  return Array.from({ length: count }, (_, i) => ({
    year: y + Math.floor((m + i) / 12),
    month: (m + i) % 12,
  }));
}

// ── Styles ──────────────────────────────────────────────────────────────
const styles = {
  monthCard: {
    border: `1px solid ${theme.colors.border}`,
    borderRadius: 10,
    padding: 14,
    background: '#fff',
  } as React.CSSProperties,
  monthTitle: {
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 8,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: theme.colors.text,
  } as React.CSSProperties,
  dayHeader: {
    fontSize: 10,
    color: theme.colors.textMuted,
    textAlign: 'center' as const,
    fontWeight: 500,
    padding: '2px 0',
  } as React.CSSProperties,
  dayCell: {
    aspectRatio: '1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    borderRadius: 4,
    border: 'none',
    fontFamily: 'inherit',
    transition: 'box-shadow 0.15s',
  } as React.CSSProperties,
  viewBtn: (active: boolean) => ({
    padding: '5px 14px',
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 6,
    border: `1px solid ${active ? theme.colors.primary : theme.colors.border}`,
    background: active ? theme.colors.primary : '#fff',
    color: active ? '#fff' : theme.colors.text,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }) as React.CSSProperties,
  bulkBtn: (bg: string, text: string) => ({
    padding: '4px 14px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 6,
    border: 'none',
    background: bg,
    color: text,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }) as React.CSSProperties,
};

// ── MonthGrid ───────────────────────────────────────────────────────────
interface MonthGridProps {
  year: number;
  month: number;
  getStatus: (dateStr: string) => AvailabilityStatus;
  isAdmin: boolean;
  selectedDates: Set<string>;
  onDayClick: (dateStr: string, shiftKey: boolean) => void;
}

function MonthGrid({ year, month, getStatus, isAdmin, selectedDates, onDayClick }: MonthGridProps) {
  const dim = daysInMonth(year, month);
  const sd = startDayOfMonth(year, month);

  return (
    <div style={styles.monthCard}>
      <div style={styles.monthTitle}>{MONTH_NAMES[month]} {year}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {DAY_HEADERS.map((d, i) => (
          <div key={i} style={styles.dayHeader}>{d}</div>
        ))}
        {Array.from({ length: sd }, (_, i) => <div key={`e-${i}`} />)}
        {Array.from({ length: dim }, (_, i) => {
          const day = i + 1;
          const dateStr = toDateStr(year, month, day);
          const past = isPast(dateStr);
          const status = past ? null : getStatus(dateStr);
          const isSelected = selectedDates.has(dateStr);
          const cfg = status ? STATUS_CONFIG[status] : null;

          return (
            <button
              key={day}
              type="button"
              disabled={past || !isAdmin}
              onClick={(e) => onDayClick(dateStr, e.shiftKey)}
              style={{
                ...styles.dayCell,
                background: past ? '#F3F4F6' : cfg ? cfg.bg : '#F3F4F6',
                color: past ? '#D1D5DB' : cfg ? cfg.text : '#9CA3AF',
                fontWeight: past ? 400 : 500,
                cursor: past || !isAdmin ? 'default' : 'pointer',
                boxShadow: isSelected ? 'inset 0 0 0 2px #3B82F6' : 'none',
              }}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────
export function AvailabilityCalendar() {
  const {
    getStatus, lastUpdated, loading, error, isAdmin,
    updateSingle, updateBatch, isUpdating,
  } = useAvailabilityCalendar();

  const [view, setView] = useState<ViewMode>('3month');
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());

  const visibleMonths = useMemo(() => getVisibleMonths(view), [view]);

  // Day click: shift+click multi-select, regular click cycles status
  const handleDayClick = useCallback(
    (dateStr: string, shiftKey: boolean) => {
      if (!isAdmin) return;
      if (shiftKey || selectedDates.size > 0) {
        setSelectedDates(prev => {
          const next = new Set(prev);
          if (next.has(dateStr)) next.delete(dateStr); else next.add(dateStr);
          return next;
        });
      } else {
        const current = getStatus(dateStr);
        const nextIdx = (STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length;
        updateSingle(dateStr, STATUS_CYCLE[nextIdx]);
      }
    },
    [isAdmin, selectedDates.size, getStatus, updateSingle]
  );

  const handleBulkApply = useCallback(
    (status: AvailabilityStatus) => {
      updateBatch(Array.from(selectedDates).map(date => ({ date, status })));
      setSelectedDates(new Set());
    },
    [selectedDates, updateBatch]
  );

  const handleViewChange = useCallback((v: ViewMode) => {
    setView(v);
    setSelectedDates(new Set());
  }, []);

  // Loading
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 0', color: theme.colors.textMuted }}>
        <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ marginLeft: 8, fontSize: 13 }}>Loading calendar...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  // Grid columns based on view
  const gridCols = view === 'year' ? 4 : view === '3month' ? 3 : 2;

  return (
    <div style={{ fontFamily: theme.typography.fontFamily }}>

      {/* Header row: title + view toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: theme.colors.text }}>Delivery Availability</span>
          {isAdmin && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: theme.colors.primary, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Admin
            </span>
          )}
          {isUpdating && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: theme.colors.textMuted }} />}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['2month', '3month', 'year'] as ViewMode[]).map(v => (
            <button key={v} onClick={() => handleViewChange(v)} style={styles.viewBtn(view === v)}>
              {v === '2month' ? '2 months' : v === '3month' ? '3 months' : 'Full year'}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 14, fontSize: 12, color: theme.colors.textMuted }}>
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: cfg.dot }} />
            <span>{cfg.label}</span>
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, marginBottom: 12, fontSize: 12, color: '#DC2626' }}>
          {error}
        </div>
      )}

      {/* Admin bulk toolbar */}
      {isAdmin && selectedDates.size > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#F3F4F6', borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
          <span style={{ color: theme.colors.textMuted }}>
            {selectedDates.size} day{selectedDates.size > 1 ? 's' : ''} selected:
          </span>
          <button onClick={() => handleBulkApply('open')} style={styles.bulkBtn('#22C55E', '#052E16')}>Open</button>
          <button onClick={() => handleBulkApply('limited')} style={styles.bulkBtn('#F97316', '#431407')}>Limited</button>
          <button onClick={() => handleBulkApply('closed')} style={styles.bulkBtn('#EF4444', '#450A0A')}>Closed</button>
          <button onClick={() => setSelectedDates(new Set())} style={{ ...styles.bulkBtn('#fff', theme.colors.text), border: `1px solid ${theme.colors.border}` }}>Clear</button>
        </div>
      )}

      {/* Admin instructions */}
      {isAdmin && selectedDates.size === 0 && (
        <div style={{ fontSize: 11, color: theme.colors.textMuted, background: '#F9FAFB', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
          Click a day to cycle status. Shift+click to multi-select, then apply a status to all selected days.
        </div>
      )}

      {/* Calendar grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
        gap: 14,
      }}>
        {visibleMonths.map(({ year, month }) => (
          <MonthGrid
            key={`${year}-${month}`}
            year={year}
            month={month}
            getStatus={getStatus}
            isAdmin={isAdmin}
            selectedDates={selectedDates}
            onDayClick={handleDayClick}
          />
        ))}
      </div>

      {/* Last updated */}
      <p style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 14 }}>
        Last updated: {formatLastUpdated(lastUpdated)}
      </p>
    </div>
  );
}
