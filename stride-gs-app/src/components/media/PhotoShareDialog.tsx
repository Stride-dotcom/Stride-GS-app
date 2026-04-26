/**
 * PhotoShareDialog — modal that creates a public photo share link from the
 * currently selected photos and shows the resulting URL with copy-to-clipboard.
 *
 * Rendered from PhotoGallery when the user has selected one or more photos
 * and clicked the "Create link" button. The actual record creation goes
 * through usePhotoShares.createPhotoShare; this component is just the UI
 * shell for picking a title and copying the resulting URL.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Link as LinkIcon, Loader2, X } from 'lucide-react';
import { theme } from '../../styles/theme';
import {
  usePhotoShares,
  type CreatePhotoShareInput,
  type PhotoShare,
} from '../../hooks/usePhotoShares';

interface Props {
  /** Inputs needed to create the share. The dialog calls createPhotoShare
   *  with this on mount (or on retry). */
  input: CreatePhotoShareInput;
  /** Number of photos in the share — shown for confirmation. */
  photoCount: number;
  onClose: () => void;
}

function buildShareUrl(shareId: string): string {
  // HashRouter — the public route lives at #/shared/photos/:shareId.
  // origin handles localhost/preview/prod automatically.
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://www.mystridehub.com';
  return `${origin}/#/shared/photos/${shareId}`;
}

export function PhotoShareDialog({ input, photoCount, onClose }: Props) {
  const { createPhotoShare } = usePhotoShares();
  const [status, setStatus] = useState<'creating' | 'ready' | 'error'>('creating');
  const [share, setShare] = useState<PhotoShare | null>(null);
  const [copied, setCopied] = useState(false);
  const ranRef = useRef(false);

  const run = useCallback(async () => {
    setStatus('creating');
    const created = await createPhotoShare(input);
    if (!created) {
      setStatus('error');
      return;
    }
    setShare(created);
    setStatus('ready');
  }, [createPhotoShare, input]);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    void run();
  }, [run]);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const url = share ? buildShareUrl(share.shareId) : '';

  const handleCopy = useCallback(async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Older browsers / iOS in-app: fall back to a hidden input + execCommand.
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); } catch { /* noop */ }
      ta.remove();
      window.setTimeout(() => setCopied(false), 1800);
    }
  }, [url]);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,0.45)',
        zIndex: 2700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 16,
          padding: 22,
          width: '100%', maxWidth: 460,
          boxShadow: '0 24px 64px rgba(0,0,0,0.28)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: `${theme.v2.colors.accent}1A`,
            color: theme.v2.colors.accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <LinkIcon size={16} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Share photos</div>
            <div style={{ fontSize: 12, color: theme.v2.colors.textMuted }}>
              {photoCount} photo{photoCount === 1 ? '' : 's'} · permanent public link
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: theme.v2.colors.textMuted, padding: 4, display: 'flex',
            }}
          ><X size={18} /></button>
        </div>

        {status === 'creating' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 14px', background: theme.v2.colors.bgCard,
            borderRadius: 10, color: theme.v2.colors.textSecondary, fontSize: 13,
          }}>
            <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
            Creating share link…
          </div>
        )}

        {status === 'error' && (
          <div>
            <div style={{
              padding: '10px 12px', borderRadius: 10,
              background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C',
              fontSize: 12, marginBottom: 12,
            }}>
              Couldn't create the share link. Please try again.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={onClose}
                style={btnSecondary}
              >Cancel</button>
              <button
                onClick={() => void run()}
                style={btnPrimary}
              >Retry</button>
            </div>
          </div>
        )}

        {status === 'ready' && (
          <div>
            <label style={{
              display: 'block', fontSize: 11, fontWeight: 600,
              letterSpacing: 1.5, textTransform: 'uppercase',
              color: theme.v2.colors.textMuted, marginBottom: 6,
            }}>
              Public link
            </label>
            <div style={{
              display: 'flex', alignItems: 'stretch', gap: 8,
              border: `1px solid ${theme.v2.colors.border}`,
              borderRadius: 10, background: theme.v2.colors.bgCard,
              padding: '4px 4px 4px 12px',
            }}>
              <input
                readOnly
                value={url}
                onFocus={e => e.currentTarget.select()}
                style={{
                  flex: 1, border: 'none', outline: 'none',
                  background: 'transparent', fontSize: 13,
                  fontFamily: 'inherit',
                  color: theme.v2.colors.text,
                  minWidth: 0,
                }}
              />
              <button
                onClick={handleCopy}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px',
                  border: 'none', borderRadius: 8,
                  background: copied ? '#059669' : theme.v2.colors.accent,
                  color: '#fff', fontWeight: 600, fontSize: 12,
                  cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'background 0.15s ease',
                }}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p style={{
              margin: '12px 0 0', fontSize: 11.5,
              color: theme.v2.colors.textMuted, lineHeight: 1.55,
            }}>
              Anyone with this link can view the photos. The link is permanent —
              an admin can revoke it later if needed.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={onClose} style={btnPrimary}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

const btnPrimary: React.CSSProperties = {
  padding: '9px 18px',
  border: 'none', borderRadius: 8,
  background: theme.v2.colors.bgDark,
  color: '#fff',
  fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
};

const btnSecondary: React.CSSProperties = {
  padding: '9px 18px',
  border: `1px solid ${theme.v2.colors.border}`,
  borderRadius: 8,
  background: '#fff',
  color: theme.v2.colors.textSecondary,
  fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
};
