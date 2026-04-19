import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useCalendarEvents, type CalendarEvent } from '../../hooks/useCalendarEvents';
import { useExpectedShipments, type ExpectedShipment } from '../../hooks/useExpectedShipments';
import { useClients } from '../../hooks/useClients';
import { CalendarMonthView } from './CalendarMonthView';
import { CalendarWeekView } from './CalendarWeekView';
import { AddExpectedModal } from './AddExpectedModal';
import { EVENT_COLORS } from './CalendarEventPill';

type ViewMode = 'month' | 'week';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function toKey(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function startOfWeek(d: Date): Date {
  const result = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  result.setDate(result.getDate() - result.getDay());
  return result;
}

export function ExpectedCalendar() {
  const [view, setView] = useState<ViewMode>('month');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ExpectedShipment | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const { events, loading } = useCalendarEvents();
  const { items: expectedItems, add: addExpected, update: updateExpected, remove: removeExpected, error: expectedError } = useExpectedShipments();
  const { apiClients } = useClients();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleEventClick = (ev: CalendarEvent) => {
    // Task / repair / will call / received shipment → deep link. HashRouter
    // requires the full `#/` prefix; window.open + '_blank' keeps the
    // calendar in place and opens the detail panel in a new tab.
    const deepLinkable: Record<string, string> = {
      task:      'tasks',
      repair:    'repairs',
      willcall:  'will-calls',
    };

    // Expected shipments (our locally-authored entries) have sourceId that
    // matches a row in useExpectedShipments — those open an in-place edit
    // modal. Any OTHER `shipment` event (e.g. a received shipment whose
    // sourceId looks like SHP-xxxx) falls through to the /shipments deep
    // link. The expected-shipment lookup is the source-of-truth check.
    if (ev.type === 'shipment' && ev.sourceId) {
      const entry = expectedItems.find(e => e.id === ev.sourceId);
      if (entry) { setEditingEvent(entry); return; }
      // No local expected row matched — treat as a received shipment.
      const sheetId = ev.clientSheetId
        || apiClients.find(c => c.name === ev.client)?.spreadsheetId;
      const params = new URLSearchParams();
      params.set('open', ev.sourceId);
      if (sheetId) params.set('client', sheetId);
      const url = `${window.location.origin}${window.location.pathname}#/shipments?${params.toString()}`;
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }

    const page = deepLinkable[ev.type];
    if (!page || !ev.sourceId) return;
    const sheetId = ev.clientSheetId
      || apiClients.find(c => c.name === ev.client)?.spreadsheetId;
    const params = new URLSearchParams();
    params.set('open', ev.sourceId);
    if (sheetId) params.set('client', sheetId);
    const url = `${window.location.origin}${window.location.pathname}#/${page}?${params.toString()}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const today = new Date();
  const weekStart = useMemo(() => startOfWeek(anchor), [anchor]);

  // Stat calculations — aggregate across every event type (tasks, repairs,
  // will calls, expected shipments). Mirrors the "Dashboard Calendar" ask
  // where these four cards are the at-a-glance summary of workload.
  const stats = useMemo(() => {
    const todayKey = toKey(today);
    const weekStartKey = toKey(startOfWeek(today));
    const weekEnd = new Date(startOfWeek(today));
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekEndKey = toKey(weekEnd);

    const inRange = (d: string, start: string, end: string) => d >= start && d <= end;

    const dueToday      = events.filter(e => e.date === todayKey).length;
    const thisWeek      = events.filter(e => inRange(e.date, weekStartKey, weekEndKey)).length;
    const highPriority  = events.filter(e => e.priority === 'High' && inRange(e.date, weekStartKey, weekEndKey)).length;
    // Overdue = task/repair whose date (dueDate) is strictly before today AND
    // the event's status is still open/in-progress.
    const isOpenStatus = (s: string | undefined) =>
      !s || s === 'Open' || s === 'In Progress' || s === 'Pending Quote' || s === 'Quote Sent' || s === 'Approved';
    const overdue = events.filter(e =>
      (e.type === 'task' || e.type === 'repair') &&
      e.date < todayKey &&
      isOpenStatus(e.details.status)
    ).length;

    return { dueToday, thisWeek, highPriority, overdue };
  }, [events, today]);

  const goPrev = () => {
    if (view === 'month') {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1));
    } else {
      const d = new Date(anchor);
      d.setDate(d.getDate() - 7);
      setAnchor(d);
    }
  };

  const goNext = () => {
    if (view === 'month') {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1));
    } else {
      const d = new Date(anchor);
      d.setDate(d.getDate() + 7);
      setAnchor(d);
    }
  };

  const goToday = () => setAnchor(new Date());

  const title = view === 'month'
    ? `${MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`
    : (() => {
        const end = new Date(weekStart);
        end.setDate(end.getDate() + 6);
        const sameMonth = weekStart.getMonth() === end.getMonth();
        if (sameMonth) return `${MONTH_NAMES[weekStart.getMonth()]} ${weekStart.getDate()}–${end.getDate()}, ${weekStart.getFullYear()}`;
        return `${MONTH_NAMES[weekStart.getMonth()]} ${weekStart.getDate()} – ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
      })();

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <StatCard label="Due Today" value={stats.dueToday} />
        <StatCard label="This Week" value={stats.thisWeek} />
        <StatCard label="High Priority" value={stats.highPriority} />
        <StatCard label="Overdue" value={stats.overdue} accent />
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex', gap: 18, alignItems: 'center',
        background: '#fff', borderRadius: 12, padding: '10px 16px',
        border: '1px solid rgba(0,0,0,0.04)', marginBottom: 14, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', color: '#999' }}>Legend</span>
        {(['task', 'repair', 'willcall', 'shipment'] as const).map(type => {
          const c = EVENT_COLORS[type];
          return (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: c.bg, borderLeft: `3px solid ${c.border}` }} />
              <span style={{ fontSize: 12, color: '#1C1C1C' }}>{c.label}</span>
            </div>
          );
        })}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={goPrev} style={iconBtn} aria-label="Previous">
            <ChevronLeft size={16} />
          </button>
          <div style={{ fontSize: 18, fontWeight: 500, color: '#1C1C1C', minWidth: 200, textAlign: 'center' }}>
            {title}
          </div>
          <button onClick={goNext} style={iconBtn} aria-label="Next">
            <ChevronRight size={16} />
          </button>
          <button onClick={goToday} style={pillGhost}>Today</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'flex', background: '#fff', border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 100, padding: 2,
          }}>
            <button
              onClick={() => setView('month')}
              style={{
                ...toggleBtn,
                background: view === 'month' ? '#1C1C1C' : 'transparent',
                color: view === 'month' ? '#fff' : '#666',
              }}
            >Month</button>
            <button
              onClick={() => setView('week')}
              style={{
                ...toggleBtn,
                background: view === 'week' ? '#1C1C1C' : 'transparent',
                color: view === 'week' ? '#fff' : '#666',
              }}
            >Week</button>
          </div>
          <button onClick={() => setShowAdd(true)} style={pillPrimary}>
            <Plus size={14} style={{ marginRight: 4 }} /> Add Shipment
          </button>
        </div>
      </div>

      {/* Calendar body */}
      {loading && events.length === 0 ? (
        <div style={{ padding: 60, textAlign: 'center', color: '#999', fontSize: 13 }}>
          Loading calendar...
        </div>
      ) : view === 'month' ? (
        <CalendarMonthView year={anchor.getFullYear()} month={anchor.getMonth()} events={events} onEventClick={handleEventClick} />
      ) : (
        <CalendarWeekView weekStart={weekStart} events={events} onEventClick={handleEventClick} />
      )}

      {showAdd && (
        <AddExpectedModal
          onClose={() => setShowAdd(false)}
          onSave={async (entry) => {
            const created = await addExpected(entry);
            if (created) { setToast('Expected shipment added'); return true; }
            return false;
          }}
        />
      )}

      {editingEvent && (
        <AddExpectedModal
          key={editingEvent.id}
          editingEvent={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSave={async (entry) => {
            const ok = await updateExpected(editingEvent.id, entry);
            if (ok) { setToast('Expected shipment updated'); return true; }
            return false;
          }}
          onDelete={async (id) => {
            const ok = await removeExpected(id);
            if (ok) { setToast('Expected shipment deleted'); return true; }
            return false;
          }}
        />
      )}

      {expectedError && !toast && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          background: '#B45A5A', color: '#fff', padding: '10px 20px', borderRadius: 100,
          fontSize: 12, fontWeight: 500, boxShadow: '0 8px 32px rgba(0,0,0,0.3)', zIndex: 10001,
          maxWidth: 520,
        }}>
          {expectedError}
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
          background: '#1C1C1C', color: '#fff', padding: '10px 20px', borderRadius: 100,
          fontSize: 12, fontWeight: 500, letterSpacing: '0.02em',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)', zIndex: 10001,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div style={{
      background: '#1C1C1C', color: '#fff',
      borderRadius: 20, padding: '20px 24px',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.5)',
      }}>{label}</div>
      <div style={{
        fontSize: 32, fontWeight: 300, marginTop: 6,
        color: accent ? '#E8692A' : '#fff',
      }}>{value}</div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 100,
  cursor: 'pointer', color: '#1C1C1C',
};

const toggleBtn: React.CSSProperties = {
  padding: '6px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '2px',
  textTransform: 'uppercase', border: 'none', borderRadius: 100,
  cursor: 'pointer', transition: 'all 0.2s',
};

const pillGhost: React.CSSProperties = {
  padding: '8px 16px', fontSize: 11, fontWeight: 600, letterSpacing: '2px',
  textTransform: 'uppercase', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 100,
  background: '#fff', color: '#1C1C1C', cursor: 'pointer',
};

const pillPrimary: React.CSSProperties = {
  display: 'flex', alignItems: 'center',
  padding: '8px 18px', fontSize: 11, fontWeight: 600, letterSpacing: '2px',
  textTransform: 'uppercase', border: 'none', borderRadius: 100,
  background: '#E8692A', color: '#fff', cursor: 'pointer',
};
