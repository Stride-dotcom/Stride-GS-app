import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
  const navigate = useNavigate();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleEventClick = (ev: CalendarEvent) => {
    if (ev.type === 'willcall' || ev.type === 'repair') {
      // Resolve clientSheetId from the event, or fall back to looking up by clientName
      const sheetId = ev.clientSheetId
        || apiClients.find(c => c.name === ev.client)?.spreadsheetId;
      if (!ev.sourceId) return;
      const params = new URLSearchParams();
      params.set('open', ev.sourceId);
      if (sheetId) params.set('client', sheetId);
      const page = ev.type === 'willcall' ? 'will-calls' : 'repairs';
      navigate(`/${page}?${params.toString()}`);
      return;
    }
    // Expected shipment → open edit modal
    if (ev.type === 'shipment' && ev.sourceId) {
      const entry = expectedItems.find(e => e.id === ev.sourceId);
      if (entry) setEditingEvent(entry);
    }
  };

  const today = new Date();
  const weekStart = useMemo(() => startOfWeek(anchor), [anchor]);

  // Stat calculations
  const stats = useMemo(() => {
    const todayKey = toKey(today);
    const weekStartKey = toKey(startOfWeek(today));
    const weekEnd = new Date(startOfWeek(today));
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekEndKey = toKey(weekEnd);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const monthStartKey = toKey(monthStart);
    const monthEndKey = toKey(monthEnd);

    const inRange = (d: string, start: string, end: string) => d >= start && d <= end;
    const future = (d: string) => d >= todayKey;

    const shipThisWeek = events.filter(e => e.type === 'shipment' && inRange(e.date, weekStartKey, weekEndKey)).length;
    const shipThisMonth = events.filter(e => e.type === 'shipment' && inRange(e.date, monthStartKey, monthEndKey)).length;
    const wcScheduled = events.filter(e => e.type === 'willcall' && future(e.date)).length;
    const repairsScheduled = events.filter(e => e.type === 'repair' && future(e.date)).length;

    return { shipThisWeek, shipThisMonth, wcScheduled, repairsScheduled };
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
        <StatCard label="Expected This Week" value={stats.shipThisWeek} />
        <StatCard label="Expected This Month" value={stats.shipThisMonth} />
        <StatCard label="Scheduled Will Calls" value={stats.wcScheduled} />
        <StatCard label="Scheduled Repairs" value={stats.repairsScheduled} accent />
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex', gap: 18, alignItems: 'center',
        background: '#fff', borderRadius: 12, padding: '10px 16px',
        border: '1px solid rgba(0,0,0,0.04)', marginBottom: 14, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase', color: '#999' }}>Legend</span>
        {(['shipment', 'willcall', 'repair'] as const).map(type => {
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
            <Plus size={14} style={{ marginRight: 4 }} /> Add Expected
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
