/**
 * SharePhotosDialog — modal that creates a public photo share and shows
 * the resulting link with a copy button. Mounted by PhotoGallery when the
 * user clicks "Share Selected Photos" with one or more photos picked.
 *
 * Flow:
 *   1. Modal opens — POST photo_shares row → get share_id
 *   2. Show the link in a read-only input + Copy button
 *   3. User pastes the link to their client (no expiration)
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Copy, Check, X, ExternalLink, AlertTriangle } from 'lucide-react';
import { theme } from '../../styles/theme';
import {
  buildPhotoShareUrl,
  usePhotoShares,
  type PhotoShareHeaderContext,
} from '../../hooks/usePhotoShares';
import type { EntityType } from '../../hooks/usePhotos';

interface Props {
  entityType: EntityType;
  entityId: string;
  tenantId: string;
  photoIds: string[];
  headerContext?: PhotoShareHeaderContext;
  /** Optional human-readable title shown in the public gallery header. */
  title?: string;
  onClose: () => void;
}

export function SharePhotosDialog({
  entityType, entityId, tenantId, photoIds, headerContext, title, onClose,
}: Props) {
  const { createPhotoShare } = usePhotoShares();
  const [status, setStatus] = useState<'creating' | 'ready' | 'error'>('creating');
  const [shareUrl, setShareUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const ranRef = useRef(false);

  useEffect(() => {
    // Strict-mode guard so we only POST one share even when the effect
    // fires twice in development.
    if (ranRef.current) return;
    ranRef.current = true;
    (async () => {
      const share = await createPhotoShare({
        entityType, entityId, tenantId, photoIds, headerContext, title,
      });
      if (!share) { setStatus('error'); return; }
      setShareUrl(buildPhotoShareUrl(share.shareId));
      setStatus('ready');
    })();
    // createPhotoShare is stable from useCallback; the rest are fixed at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback: select the input so the user can copy manually
      const el = document.getElementById('share-link-input') as HTMLInputElement | null;
      el?.select();
    }
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2700,
        background: 'rgba(15,23,42,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 14,
          width: '100%', maxWidth: 480,
          padding: 20,
          boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
          fontFamily: 'inherit',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: theme.v2.colors.text }}>
            Share {photoIds.length} {photoIds.length === 1 ? 'photo' : 'photos'}
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
            padding: '14px 0', color: theme.v2.colors.textMuted, fontSize: 13,
          }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
            Generating link…
          </div>
        )}

        {status === 'error' && (
          <div role="alert" style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C',
            borderRadius: 8, padding: '10px 12px', fontSize: 13,
          }}>
            <AlertTriangle size={14} />
            Failed to create the share link. Try again — if it keeps failing, check
            the browser console for details.
          </div>
        )}

        {status === 'ready' && (
          <>
            <div style={{ fontSize: 12, color: theme.v2.colors.textMuted, marginBottom: 8, lineHeight: 1.5 }}>
              Anyone with this link can view the photos. The link is permanent —
              no login required.
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <input
                id="share-link-input"
                readOnly
                value={shareUrl}
                onFocus={e => e.currentTarget.select()}
                style={{
                  flex: 1, minWidth: 0,
                  padding: '10px 12px',
                  fontSize: 12, fontFamily: 'ui-monospace, monospace',
                  border: `1px solid ${theme.v2.colors.border}`, borderRadius: 8,
                  background: theme.v2.colors.bgCard, color: theme.v2.colors.text,
                  outline: 'none',
                }}
              />
              <button
                onClick={handleCopy}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '10px 14px',
                  background: copied ? '#16A34A' : theme.v2.colors.accent,
                  color: '#fff',
                  border: 'none', borderRadius: 8,
                  fontWeight: 600, fontSize: 12, cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'background 0.15s ease',
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 12, color: theme.v2.colors.accent,
                  textDecoration: 'none', fontWeight: 600,
                }}
              >
                Preview <ExternalLink size={12} />
              </a>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
