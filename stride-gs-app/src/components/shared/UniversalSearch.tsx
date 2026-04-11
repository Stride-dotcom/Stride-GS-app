import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Package, ClipboardList, Wrench, Truck, Users, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { theme } from '../../styles/theme';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useInventory } from '../../hooks/useInventory';
import { useTasks } from '../../hooks/useTasks';
import { useRepairs } from '../../hooks/useRepairs';
import { useWillCalls } from '../../hooks/useWillCalls';
import type { InventoryItem, Task, Repair, WillCall } from '../../lib/types';

interface Props { open: boolean; onClose: () => void; }

type ResultType = 'inventory' | 'task' | 'repair' | 'willcall' | 'client';
interface Result { type: ResultType; id: string; title: string; subtitle: string; path: string; }

const TYPE_CONFIG: Record<ResultType, { icon: any; label: string; color: string; bg: string }> = {
  inventory: { icon: Package, label: 'Item', color: '#E85D2D', bg: '#FEF3EE' },
  task: { icon: ClipboardList, label: 'Task', color: '#1D4ED8', bg: '#EFF6FF' },
  repair: { icon: Wrench, label: 'Repair', color: '#B45309', bg: '#FEF3C7' },
  willcall: { icon: Truck, label: 'Will Call', color: '#7C3AED', bg: '#EDE9FE' },
  client: { icon: Users, label: 'Client', color: '#15803D', bg: '#F0FDF4' },
};

const MAX_PER_GROUP = 3;

function buildSearchIndex(
  inventoryItems: InventoryItem[],
  tasks: Task[],
  repairs: Repair[],
  willCalls: WillCall[],
): Result[] {
  const results: Result[] = [];
  inventoryItems.forEach(i => results.push({ type: 'inventory', id: i.itemId, title: `${i.itemId} — ${i.vendor}`, subtitle: `${i.description} · ${i.clientName} · ${i.sidemark}`, path: '/inventory' }));
  tasks.forEach(t => results.push({ type: 'task', id: t.taskId, title: `${t.taskId} — ${t.type}`, subtitle: `${t.description} · ${t.clientName}`, path: '/tasks' }));
  repairs.forEach(r => results.push({ type: 'repair', id: r.repairId, title: `${r.repairId} — ${r.status}`, subtitle: `${r.description} · ${r.clientName}`, path: '/repairs' }));
  willCalls.forEach(w => results.push({ type: 'willcall', id: w.wcNumber, title: `${w.wcNumber} — ${w.pickupParty}`, subtitle: `${w.clientName} · ${w.status} · ${w.itemCount} items`, path: '/will-calls' }));
  const clients = [...new Set(inventoryItems.map(i => i.clientName))];
  clients.forEach(c => { const count = inventoryItems.filter(i => i.clientName === c).length; results.push({ type: 'client', id: c, title: c, subtitle: `${count} inventory items`, path: '/inventory' }); });
  return results;
}

export function UniversalSearch({ open, onClose }: Props) {
  const { isMobile } = useIsMobile();
  const [query, setQuery] = useState('');
  const [focusIdx, setFocusIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Live data from API hooks
  const { items: inventoryItems } = useInventory(true);
  const { tasks } = useTasks(true);
  const { repairs } = useRepairs(true);
  const { willCalls } = useWillCalls(true);

  const allResults = useMemo(
    () => buildSearchIndex(inventoryItems, tasks, repairs, willCalls),
    [inventoryItems, tasks, repairs, willCalls]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return allResults.filter(r => r.title.toLowerCase().includes(q) || r.subtitle.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
  }, [query, allResults]);

  const grouped = useMemo(() => {
    const groups: Record<ResultType, Result[]> = { inventory: [], task: [], repair: [], willcall: [], client: [] };
    filtered.forEach(r => { if (groups[r.type].length < MAX_PER_GROUP) groups[r.type].push(r); });
    return groups;
  }, [filtered]);

  const flatResults = useMemo(() => {
    const flat: Result[] = [];
    (Object.keys(grouped) as ResultType[]).forEach(type => { grouped[type].forEach(r => flat.push(r)); });
    return flat;
  }, [grouped]);

  useEffect(() => { if (open) { setQuery(''); setFocusIdx(0); setTimeout(() => inputRef.current?.focus(), 50); } }, [open]);
  useEffect(() => { setFocusIdx(0); }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx(i => Math.min(i + 1, flatResults.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && flatResults[focusIdx]) { navigate(flatResults[focusIdx].path); onClose(); }
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
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="Search items, tasks, repairs, will calls, clients..."
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, fontFamily: 'inherit', color: theme.colors.text }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: theme.colors.textMuted, background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, padding: '2px 6px', borderRadius: 4 }}>ESC</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: theme.colors.textMuted }}><X size={16} /></button>
          </div>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', maxHeight: isMobile ? undefined : '60vh' }}>
          {!query.trim() && (
            <div style={{ padding: '24px 20px', textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
              Type to search across inventory, tasks, repairs, will calls, and clients
            </div>
          )}
          {query.trim() && flatResults.length === 0 && (
            <div style={{ padding: '24px 20px', textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
              No results for "{query}"
            </div>
          )}
          {(Object.keys(grouped) as ResultType[]).map(type => {
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
                    <div key={r.id} onClick={() => { navigate(r.path); onClose(); }}
                      onMouseEnter={() => setFocusIdx(idx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', cursor: 'pointer',
                        background: focused ? theme.colors.bgSubtle : 'transparent', transition: 'background 0.08s',
                      }}>
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
                  <div onClick={() => { navigate(items[0].path); onClose(); }} style={{ padding: '6px 18px 8px 62px', fontSize: 11, color: theme.colors.orange, cursor: 'pointer', fontWeight: 500 }}>
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
