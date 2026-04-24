import { useState, useMemo, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react';
import { useCalendarEvents, type CalendarEvent } from '../../hooks/useCalendarEvents';
import { useExpectedShipments, type ExpectedShipment } from '../../hooks/useExpectedShipments';
import { useClients } from '../../hooks/useClients';
import { useIsMobile } from '../../hooks/useIsMobile';
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

// Monday-start week (session 73). Shift JS getDay() (0=Sun..6=Sat) so
// Monday becomes the 0-index, then walk back that many days.
function startOfWeek(d: Date): Date {
  const result = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const mondayOffset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - mondayOffset);
  return result;
}

export function ExpectedCalendar() {
  const { isMobile } = useIsMobile();
  const [view, setView] = useState<ViewMode>('week');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [showAdd, setShowAdd] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ExpectedShipment | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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

  // Search: substring-match across every field a user might remember —
  // client, vendor, carrier, tracking, label, sourceId, pickupParty,
  // description, notes, priority. Case-insensitive. Empty query → full set.
  // Stats + month/week views all consume `filteredEvents` so the unread
  // counts change in step with what's rendered on the grid.
  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return events;
    return events.filter(e => {
      const d = e.details || {};
      const hay = [
        e.client, e.label, e.sourceId, e.type, e.date,
        d.title, d.vendor, d.carrier, d.tracking,
        d.pickupParty, d.status, d.description,
        d.repairVendor, d.priority, d.notes,
        d.pieces == null ? '' : String(d.pieces),
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [events, searchQuery]);

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

    // Stats reflect the currently-filtered event set so the cards stay in
    // sync with whatever the user is searching for.
    const dueToday      = filteredEvents.filter(e => e.date === todayKey).length;
    const thisWeek      = filteredEvents.filter(e => inRange(e.date, weekStartKey, weekEndKey)).length;
    const highPriority  = filteredEvents.filter(e => e.priority === 'High' && inRange(e.date, weekStartKey, weekEndKey)).length;
    // Overdue = task/repair whose date (dueDate) is strictly before today AND
    // the event's status is still open/in-progress.
    const isOpenStatus = (s: string | undefined) =>
      !s || s === 'Open' || s === 'In Progress' || s === 'Pending Quote' || s === 'Quote Sent' || s === 'Approved';
    const overdue = filteredEvents.filter(e =>
      (e.type === 'task' || e.type === 'repair') &&
      e.date < todayKey &&
      isOpenStatus(e.details.status)
    ).length;

    return { dueToday, thisWeek, highPriority, overdue };
  }, [filteredEvents, today]);

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
      {/* Stat cards — 4 across on desktop, 2×2 on mobile with compact padding */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: isMobile ? 8 : 12, marginBottom: isMobile ? 12 : 20 }}>
        <StatCard label="Due Today" value={stats.dueToday} isMobile={isMobile} />
        <StatCard label="This Week" value={stats.thisWeek} isMobile={isMobile} />
        <StatCard label="High Priority" value={stats.highPriority} isMobile={isMobile} />
        <StatCard label="Overdue" value={stats.overdue} accent isMobile={isMobile} />
      </div>

      {/* Legend — hidden on mobile to reclaim vertical space; the colored
          pills on each event already communicate type at a glance */}
      {!isMobile && (
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
      )}

      {/* Search — substring-match across every searchable field on every event.
          Sits above the month navigation so it's the first thing users see
          and the filter state is obvious (dropdown-style counter shows how
          many events match). */}
      <div style={{ marginBottom: isMobile ? 10 : 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 420 }}>
          <Search size={14} style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: '#999', pointerEvents: 'none',
          }} />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search calendar — client, vendor, tracking, notes…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '9px 34px 9px 34px', fontSize: 13,
              border: '1px solid rgba(0,0,0,0.08)', borderRadius: 100,
              background: '#fff', color: '#1C1C1C',
              outline: 'none', fontFamily: 'inherit',
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'rgba(0,0,0,0.06)', border: 'none', borderRadius: '50%',
                width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: '#666',
              }}
            ><X size={12} /></button>
          )}
        </div>
        {searchQuery && (
          <span style={{ fontSize: 11, color: '#666', fontWeight: 500 }}>
            {filteredEvents.length} match{filteredEvents.length === 1 ? '' : 'es'} of {events.length}
          </span>
        )}
      </div>

      {/* Controls — wrap cleanly; on mobile the month title drops below the
          nav buttons and the view toggle + Add Shipment pill sit on their own row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isMobile ? 10 : 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 10 }}>
          <button onClick={goPrev} style={iconBtn} aria-label="Previous">
            <ChevronLeft size={16} />
          </button>
          <div style={{ fontSize: isMobile ? 15 : 18, fontWeight: 500, color: '#1C1C1C', minWidth: isMobile ? 140 : 200, textAlign: 'center' }}>
            {title}
          </div>
          <button onClick={goNext} style={iconBtn} aria-label="Next">
            <ChevronRight size={16} />
          </button>
          <button onClick={goToday} style={pillGhost}>Today</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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

      {/* Calendar body — on narrow screens the grid can overflow; horizontal
          scroll preserves the 7-day columns instead of squashing them */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <div style={{ minWidth: isMobile ? 560 : undefined }}>
          {loading && events.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', color: '#999', fontSize: 13 }}>
              Loading calendar...
            </div>
          ) : view === 'month' ? (
            <CalendarMonthView year={anchor.getFullYear()} month={anchor.getMonth()} events={filteredEvents} onEventClick={handleEventClick} />
          ) : (
            <CalendarWeekView weekStart={weekStart} events={filteredEvents} onEventClick={handleEventClick} />
          )}
        </div>
      </div>

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

function StatCard({ label, value, accent, isMobile }: { label: string; value: number; accent?: boolean; isMobile?: boolean }) {
  return (
    <div style={{
      background: '#1C1C1C', color: '#fff',
      borderRadius: isMobile ? 14 : 20,
      padding: isMobile ? '10px 12px' : '20px 24px',
    }}>
      <div style={{
        fontSize: isMobile ? 9 : 10, fontWeight: 600,
        letterSpacing: isMobile ? '1px' : '2px',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.5)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{label}</div>
      <div style={{
        fontSize: isMobile ? 20 : 32, fontWeight: 300,
        marginTop: isMobile ? 4 : 6, lineHeight: 1,
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
