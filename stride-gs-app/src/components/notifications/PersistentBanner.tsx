/**
 * PersistentBanner — iMessage-style top-of-screen alert for new messages.
 *
 * Ported from the Stride WMS app. Subscribes to the notification emitter
 * exported by useNotifications and shows a stacked banner for each active
 * alert. Click the banner body → navigates to the related entity (or
 * Messages page). Click X → dismisses. Auto-dismiss after 10 s unless the
 * user is hovering.
 *
 * Sound + vibration are handled by useNotifications itself; this
 * component is the visual surface.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { X, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { theme } from '../../styles/theme';
import {
  subscribeNotifications,
  type NotificationEvent,
} from '../../hooks/useNotifications';

const AUTO_DISMISS_MS = 10_000;

interface BannerItem extends NotificationEvent {
  /** Local unique key separate from recipientId to survive duplicates. */
  key: string;
}

export function PersistentBanner() {
  const v2 = theme.v2;
  const navigate = useNavigate();
  const [items, setItems] = useState<BannerItem[]>([]);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const hoveringRef = useRef<Set<string>>(new Set());

  const dismiss = useCallback((key: string) => {
    setItems(prev => prev.filter(i => i.key !== key));
    const t = timersRef.current[key];
    if (t) { clearTimeout(t); delete timersRef.current[key]; }
    hoveringRef.current.delete(key);
  }, []);

  const scheduleDismiss = useCallback((key: string) => {
    if (timersRef.current[key]) clearTimeout(timersRef.current[key]);
    timersRef.current[key] = setTimeout(() => {
      if (!hoveringRef.current.has(key)) dismiss(key);
    }, AUTO_DISMISS_MS);
  }, [dismiss]);

  useEffect(() => {
    const unsub = subscribeNotifications(evt => {
      const key = `${evt.recipientId}:${Date.now()}`;
      setItems(prev => [{ ...evt, key }, ...prev].slice(0, 5));
      scheduleDismiss(key);
    });
    return () => {
      unsub();
      for (const t of Object.values(timersRef.current)) clearTimeout(t);
      timersRef.current = {};
    };
  }, [scheduleDismiss]);

  const handleClick = (item: BannerItem) => {
    dismiss(item.key);
    if (item.entityType && item.entityId) {
      const base = item.entityType === 'repair' ? '/repairs'
        : item.entityType === 'task' ? '/tasks'
        : item.entityType === 'will_call' ? '/will-calls'
        : item.entityType === 'shipment' ? '/shipments'
        : null;
      if (base) { navigate(`${base}/${encodeURIComponent(item.entityId)}`); return; }
    }
    navigate('/messages');
  };

  if (items.length === 0) return null;

  return (
    <>
      <div style={{
        position: 'fixed',
        top: 12, left: 0, right: 0,
        zIndex: 2000,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        pointerEvents: 'none', // children re-enable
        fontFamily: theme.typography.fontFamily,
      }}>
        {items.map(item => (
          <div
            key={item.key}
            onMouseEnter={() => { hoveringRef.current.add(item.key); }}
            onMouseLeave={() => { hoveringRef.current.delete(item.key); scheduleDismiss(item.key); }}
            style={{
              pointerEvents: 'auto',
              width: 'min(440px, calc(100vw - 24px))',
              background: 'rgba(30, 30, 30, 0.92)',
              color: '#fff',
              borderRadius: 18,
              boxShadow: '0 10px 32px rgba(0,0,0,0.3)',
              padding: '10px 12px 10px 14px',
              display: 'flex', alignItems: 'center', gap: 10,
              backdropFilter: 'blur(14px)',
              animation: 'stride-banner-in 0.22s ease-out',
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: '#007AFF', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <MessageSquare size={15} />
            </div>
            <button
              onClick={() => handleClick(item)}
              style={{
                flex: 1, minWidth: 0, textAlign: 'left',
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: 'inherit', fontFamily: 'inherit', padding: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{item.senderName}</span>
                {item.entityType && (
                  <span style={{
                    fontSize: 10, fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase',
                    padding: '1px 6px', borderRadius: v2.radius.badge,
                    background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.85)',
                  }}>{item.entityType}</span>
                )}
              </div>
              <div style={{
                fontSize: 13, marginTop: 2,
                color: 'rgba(255,255,255,0.85)',
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>{item.body}</div>
            </button>
            <button
              onClick={() => dismiss(item.key)}
              title="Dismiss"
              style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.9)',
                border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes stride-banner-in {
          from { transform: translateY(-20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}
