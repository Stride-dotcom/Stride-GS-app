/**
 * PhotoShareDialog — modal that finalizes a public photo-share link.
 *
 * Two states:
 *   1. Confirm: shows "Share N photo(s) from <entityLabel>" + Create button.
 *      Snapshots the entity context via buildEntityContext + inserts the
 *      photo_shares row.
 *   2. Done: shows the public URL with a Copy button + Open-in-new-tab.
 *
 * Permanent links by design — no expiry picker. Admin can revoke later via
 * a future shares list UI; for now revocation is a Supabase row toggle.
 */
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Link as LinkIcon, Copy, Check, ExternalLink, Loader2 } from 'lucide-react';
import { theme } from '../../styles/theme';
import type { EntityType } from '../../hooks/usePhotos';
import {
  usePhotoShares,
  buildEntityContext,
  buildPublicShareUrl,
  type PhotoShare,
} from '../../hooks/usePhotoShares';

interface Props {
  entityType: EntityType;
  entityId: string;
  tenantId: string;
  photoIds: string[];
  onClose: () => void;
}

export function PhotoShareDialog({ entityType, entityId, tenantId, photoIds, onClose }: Props) {
  const { creating, error, createShare } = usePhotoShares();
  const [share, setShare] = useState<PhotoShare | null>(null);
  const [copied, setCopied] = useState(false);
  // Kick off context lookup as soon as the dialog opens so the Create button
  // doesn't have to wait. Lookup is best-effort; fallback context is used
  // if the entity row isn't in the cache.
  const [contextReady, setContextReady] = useState(false);
  const [pendingContext, setPendingContext] = useState<Awaited<ReturnType<typeof buildEntityContext>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    buildEntityContext(entityType, entityId).then(ctx => {
      if (!cancelled) {
        setPendingContext(ctx);
        setContextReady(true);
      }
    });
    return () => { cancelled = true; };
  }, [entityType, entityId]);

  const handleCreate = useCallback(async () => {
    if (!pendingContext) return;
    const result = await createShare({
      entityType,
      entityId,
      tenantId,
      photoIds,
      entityContext: pendingContext,
    });
    if (result) setShare(result);
  }, [createShare, entityType, entityId, tenantId, photoIds, pendingContext]);

  const handleCopy = useCallback(async () => {
    if (!share) return;
    const url = buildPublicShareUrl(share.shareId);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked — leave the URL visible so the user can copy manually.
    }
  }, [share]);

  const url = share ? buildPublicShareUrl(share.shareId) : '';

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 2700,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16, width: '100%', maxWidth: 520,
          boxShadow: '0 20px 48px rgba(0,0,0,0.25)',
          padding: 22,
          fontFamily: 'inherit',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `${theme.v2.colors.accent}1A`,
            color: theme.v2.colors.accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <LinkIcon size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: theme.v2.colors.text }}>
              {share ? 'Share link ready' : 'Create share link'}
            </div>
            <div style={{ fontSize: 12, color: theme.v2.colors.textMuted }}>
              {share
                ? 'Anyone with this link can view the gallery — no login required.'
                : `${photoIds.length} photo${photoIds.length === 1 ? '' : 's'} selected. Permanent link, no expiration.`}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: theme.v2.colors.textMuted, padding: 6, display: 'flex',
              borderRadius: 8,
            }}
          ><X size={18} /></button>
        </div>

        {error && (
          <div role="alert" style={{
            background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C',
            borderRadius: 10, padding: '8px 12px', fontSize: 12, marginBottom: 12,
          }}>{error}</div>
        )}

        {/* Body */}
        {!share ? (
          <>
            <div style={{
              background: theme.v2.colors.bgCard,
              borderRadius: 10, padding: '12px 14px', fontSize: 12,
              color: theme.v2.colors.textSecondary, marginBottom: 14,
            }}>
              <div style={{ fontWeight: 600, color: theme.v2.colors.text, marginBottom: 4 }}>
                {pendingContext?.label || entityId}
              </div>
              {pendingContext?.title && (
                <div style={{ marginBottom: 2 }}>{pendingContext.title}</div>
              )}
              {pendingContext?.subtitle && (
                <div style={{ color: theme.v2.colors.textMuted }}>{pendingContext.subtitle}</div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={onClose}
                style={btnSecondary}
              >Cancel</button>
              <button
                onClick={handleCreate}
                disabled={creating || !contextReady || photoIds.length === 0}
                style={{
                  ...btnPrimary,
                  opacity: (creating || !contextReady || photoIds.length === 0) ? 0.6 : 1,
                  cursor: (creating || !contextReady || photoIds.length === 0) ? 'default' : 'pointer',
                }}
              >
                {creating
                  ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Creating…</>
                  : 'Create link'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{
              border: `1px solid ${theme.v2.colors.border}`, borderRadius: 10,
              padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8,
              marginBottom: 14, background: theme.v2.colors.bgCard,
            }}>
              <input
                value={url}
                readOnly
                onFocus={e => e.currentTarget.select()}
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  fontSize: 12, color: theme.v2.colors.text, fontFamily: 'inherit',
                }}
              />
              <button
                onClick={handleCopy}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: copied ? '#D1FAE5' : '#fff',
                  border: `1px solid ${copied ? '#10B981' : theme.v2.colors.border}`,
                  borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
                  fontSize: 12, fontWeight: 600,
                  color: copied ? '#065F46' : theme.v2.colors.textSecondary,
                  fontFamily: 'inherit',
                }}
              >
                {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              ><ExternalLink size={13} /> Open</a>
              <button onClick={onClose} style={btnPrimary}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

const btnPrimary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: theme.v2.colors.accent, color: '#fff',
  border: 'none', borderRadius: 10, padding: '8px 16px',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};

const btnSecondary: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: '#fff', color: theme.v2.colors.textSecondary,
  border: `1px solid ${theme.v2.colors.border}`, borderRadius: 10, padding: '8px 14px',
  fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
