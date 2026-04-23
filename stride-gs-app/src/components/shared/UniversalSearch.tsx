/* ===================================================
   UniversalSearch — v1.1.0 — 2026-04-22 10:00 AM PST
   =================================================== */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Search, Package, ClipboardList, Wrench, Truck, Users, X, Anchor } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { theme } from '../../styles/theme';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useInventory } from '../../hooks/useInventory';
import { useTasks } from '../../hooks/useTasks';
import { useRepairs } from '../../hooks/useRepairs';
import { useWillCalls } from '../../hooks/useWillCalls';
import { useShipments } from '../../hooks/useShipments';
import type { InventoryItem, Task, Repair, WillCall, Shipment } from '../../lib/types';

interface Props { open: boolean; onClose: () => void; }

type ResultType = 'inventory' | 'task' | 'repair' | 'willcall' | 'shipment' | 'client';

interface Result {
  type: ResultType;
  id: string;
  title: string;
  subtitle: string;
  path: string;
  clientSheetId?: string;
}

const TYPE_CONFIG: Record<ResultType, { icon: any; label: string; color: string; bg: string }> = {
  inventory: { icon: Package,      label: 'Item',      color: '#E85D2D', bg: '#FEF3EE' },
  task:      { icon: ClipboardList, label: 'Task',      color: '#1D4ED8', bg: '#EFF6FF' },
  repair:    { icon: Wrench,       label: 'Repair',    color: '#B45309', bg: '#FEF3C7' },
  willcall:  { icon: Truck,        label: 'Will Call', color: '#7C3AED', bg: '#EDE9FE' },
  shipment:  { icon: Anchor,       label: 'Shipment',  color: '#0891B2', bg: '#F0F9FF' },
  client:    { icon: Users,        label: 'Client',    color: '#15803D', bg: '#F0FDF4' },
};

// Display order for result groups
const ORDER: ResultType[] = ['inventory', 'task', 'repair', 'willcall', 'shipment', 'client'];
const MAX_PER_GROUP = 3;

function buildSearchIndex(
  inventoryItems: InventoryItem[],
  tasks: Task[],
  repairs: Repair[],
  willCalls: WillCall[],
  shipments: Shipment[],
): Result[] {
  const results: Result[] = [];

  inventoryItems.forEach(i => results.push({
    type: 'inventory',
    id: i.itemId,
    title: `${i.itemId} — ${i.vendor}`,
    subtitle: `${i.description} · ${i.clientName} · ${i.sidemark}`,
    path: '/inventory',
    clientSheetId: i.clientId, // clientId == clientSheetId (mapped in useInventory)
  }));

  tasks.forEach(t => results.push({
    type: 'task',
    id: t.taskId,
    title: `${t.taskId} — ${t.type}`,
    subtitle: `${t.description} · ${t.clientName}`,
    path: '/tasks',
    clientSheetId: t.clientSheetId,
  }));

  repairs.forEach(r => results.push({
    type: 'repair',
    id: r.repairId,
    title: `${r.repairId} — ${r.status}`,
    subtitle: `${r.description} · ${r.clientName}`,
    path: '/repairs',
    clientSheetId: r.clientSheetId,
  }));

  willCalls.forEach(w => results.push({
    type: 'willcall',
    id: w.wcNumber,
    title: `${w.wcNumber} — ${w.pickupParty}`,
    subtitle: `${w.clientName} · ${w.status} · ${w.itemCount} items`,
    path: '/will-calls',
    clientSheetId: w.clientSheetId,
  }));

  shipments.forEach(s => results.push({
    type: 'shipment',
    id: s.shipmentId,
    title: `${s.shipmentId} — ${s.carrier}`,
    subtitle: `${s.clientName} · ${s.trackingNumber} · ${s.itemCount} items`,
    path: '/shipments',
    clientSheetId: s.clientId, // clientId == clientSheetId (mapped in useShipments)
  }));

  // Client entries: one per unique clientName, with clientId for tenant context
  const clientMap = new Map<string, { sheetId: string; count: number }>();
  inventoryItems.forEach(i => {
    if (!clientMap.has(i.clientName)) clientMap.set(i.clientName, { sheetId: i.clientId, count: 0 });
    clientMap.get(i.clientName)!.count++;
  });
  clientMap.forEach(({ sheetId, count }, name) => {
    results.push({
      type: 'client',
      id: name,
      title: name,
      subtitle: `${count} inventory items`,
      path: '/inventory',
      clientSheetId: sheetId,
    });
  });

  return results;
}

export function UniversalSearch({ open, onClose }: Props) {
  const { isMobile } = useIsMobile();
  const [query, setQuery] = useState('');
  const [focusIdx, setFocusIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Live data — already scoped to the caller's role/tenant by each hook
  const { items: inventoryItems } = useInventory(true);
  const { tasks } = useTasks(true);
  const { repairs } = useRepairs(true);
  const { willCalls } = useWillCalls(true);
  const { shipments } = useShipments(true);

  const allResults = useMemo(
    () => buildSearchIndex(inventoryItems, tasks, repairs, willCalls, shipments),
    [inventoryItems, tasks, repairs, willCalls, shipments],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return allResults.filter(r =>
      r.title.toLowerCase().includes(q) ||
      r.subtitle.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q),
    );
  }, [query, allResults]);

  const grouped = useMemo(() => {
    const groups: Record<ResultType, Result[]> = {
      inventory: [], task: [], repair: [], willcall: [], shipment: [], client: [],
    };
    filtered.forEach(r => { if (groups[r.type].length < MAX_PER_GROUP) groups[r.type].push(r); });
    return groups;
  }, [filtered]);

  const flatResults = useMemo(() => ORDER.flatMap(type => grouped[type]), [grouped]);

  useEffect(() => {
    if (open) { setQuery(''); setFocusIdx(0); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);
  useEffect(() => { setFocusIdx(0); }, [query]);

  // Navigate to the entity's detail panel. For entity types, appends ?open=ID&client=sheetId
  // so the list page's deep-link handler auto-selects the client and opens the detail panel.
  // For client results, navigates to inventory pre-filtered to that client.
  const navToResult = useCallback((r: Result) => {
    if (r.type === 'client') {
      const q = r.clientSheetId ? `?client=${encodeURIComponent(r.clientSheetId)}` : '';
      navigate(r.path + q);
    } else {
      const clientSuffix = r.clientSheetId ? `&client=${encodeURIComponent(r.clientSheetId)}` : '';
      navigate(`${r.path}?open=${encodeURIComponent(r.id)}${clientSuffix}`);
    }
    onClose();
  }, [navigate, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx(i => Math.min(i + 1, flatResults.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && flatResults[focusIdx]) { navToResult(flatResults[focusIdx]); }
  };

  if (!open) return null;

  let resultIdx = -1;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 300, backdropFilter: 'blur(4px)' }} />
      <div style={{
        position: 'fixed',
        ...(isMobile
          ? { top: 0, left: 0, right: 0, bottom: 0, width: '100%', maxWidth: '100%', maxHeight: '100vh', borderRadius: 0 }
          : { top: '15%', left: '50%', transform: 'translateX(-50%)', width: 560, maxWidth: '95vw', maxHeight: '70vh', borderRadius: 16 }
        ),
        background: '#fff',
        boxShadow: isMobile ? 'none' : '0 12px 60px rgba(0,0,0,0.2)',
        zIndex: 301, display: 'flex', flexDirection: 'column',
        fontFamily: theme.typography.fontFamily, overflow: 'hidden',
        animation: isMobile ? undefined : 'searchIn 0.15s ease-out',
      }}>
        {/* Search Input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: `1px solid ${theme.colors.border}` }}>
          <Search size={18} color={theme.colors.textMuted} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search items, tasks, repairs, will calls, shipments, clients..."
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, fontFamily: 'inherit', color: theme.colors.text }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: theme.colors.textMuted, background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, padding: '2px 6px', borderRadius: 4 }}>ESC</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: theme.colors.textMuted }}><X size={16} /></button>
          </div>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', maxHeight: isMobile ? undefined : '60vh' }}>
          {!query.trim() && (
            <div style={{ padding: '24px 20px', textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
              Type to search across inventory, tasks, repairs, will calls, shipments, and clients
            </div>
          )}
          {query.trim() && flatResults.length === 0 && (
            <div style={{ padding: '24px 20px', textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
              No results for "{query}"
            </div>
          )}
          {ORDER.map(type => {
            const items = grouped[type];
            if (items.length === 0) return null;
            const cfg = TYPE_CONFIG[type];
            const Icon = cfg.icon;
            const totalForType = filtered.filter(r => r.type === type).length;
            return (
              <div key={type} style={{ marginBottom: 4 }}>
                <div style={{ padding: '6px 18px', fontSize: 10, fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {cfg.label}s ({totalForType})
                </div>
                {items.map(r => {
                  resultIdx++;
                  const idx = resultIdx;
                  const focused = idx === focusIdx;
                  return (
                    <div
                      key={r.id}
                      onClick={() => navToResult(r)}
                      onMouseEnter={() => setFocusIdx(idx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', cursor: 'pointer',
                        background: focused ? theme.colors.bgSubtle : 'transparent', transition: 'background 0.08s',
                      }}
                    >
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon size={16} color={cfg.color} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                        <div style={{ fontSize: 11, color: theme.colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.subtitle}</div>
                      </div>
                      {focused && <span style={{ fontSize: 10, color: theme.colors.textMuted, background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, padding: '1px 6px', borderRadius: 4 }}>Enter</span>}
                    </div>
                  );
                })}
                {totalForType > MAX_PER_GROUP && (
                  <div
                    onClick={() => { navigate(items[0].path); onClose(); }}
                    style={{ padding: '6px 18px 8px 62px', fontSize: 11, color: theme.colors.orange, cursor: 'pointer', fontWeight: 500 }}
                  >
                    View all {totalForType} {cfg.label.toLowerCase()}s →
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '8px 18px', borderTop: `1px solid ${theme.colors.borderLight}`, display: 'flex', gap: 16, fontSize: 10, color: theme.colors.textMuted }}>
          <span>↑↓ Navigate</span><span>↵ Open</span><span>ESC Close</span>
        </div>
      </div>
      <style>{`@keyframes searchIn { from { opacity: 0; transform: translateX(-50%) scale(0.97); } to { opacity: 1; transform: translateX(-50%) scale(1); } }`}</style>
    </>
  );
}
