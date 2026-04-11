import { useState, useEffect, useRef } from 'react';
import { Info } from 'lucide-react';
import { theme } from '../../styles/theme';

/**
 * Click-to-open help tooltip. Shows an (i) icon next to a field label.
 * Tap/click to open, tap outside or tap icon again to close. Works on mobile
 * (tap) and desktop (click). Not hover-based.
 */
interface Props {
  text: string;
  /** Optional icon size override (default 14) */
  size?: number;
  /** Optional icon color override */
  color?: string;
}

export function InfoTooltip({ text, size = 14, color }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [open]);

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }}
        aria-label="Help"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', padding: 0, marginLeft: 4,
          cursor: 'pointer', color: color || theme.colors.textMuted,
          width: size + 4, height: size + 4, borderRadius: '50%',
        }}
      >
        <Info size={size} />
      </button>
      {open && (
        <span
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0,
            zIndex: 2000, background: '#1A1A1A', color: '#fff',
            padding: '10px 12px', borderRadius: 8,
            fontSize: 11, fontWeight: 400, lineHeight: 1.5,
            width: 260, maxWidth: 'calc(100vw - 32px)', whiteSpace: 'normal',
            boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
            fontFamily: theme.typography.fontFamily, textTransform: 'none', letterSpacing: 0,
          }}
        >
          {text}
          <span style={{
            position: 'absolute', bottom: '100%', left: 6,
            width: 0, height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderBottom: '5px solid #1A1A1A',
          }} />
        </span>
      )}
    </span>
  );
}
