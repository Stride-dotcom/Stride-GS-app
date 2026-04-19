/**
 * PhotoGrid — responsive thumbnail grid. 4 columns on desktop, 2 on mobile.
 * Primary photo: amber outline. Needs-attention: red outline. Repair: purple.
 * Click hands off to the parent (usually opens the lightbox).
 */
import { AlertTriangle, Wrench, Star } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { Photo } from '../../hooks/usePhotos';

interface Props {
  photos: Photo[];
  onPhotoClick?: (photo: Photo, index: number) => void;
  /** Render compact tiles (smaller padding + radius) when embedded in a side panel. */
  compact?: boolean;
}

const PRIMARY_RING = '#D97706';      // amber
const ATTENTION_RING = '#DC2626';     // red
const REPAIR_RING = '#7C3AED';        // purple

function ringColor(p: Photo): string | null {
  if (p.needs_attention) return ATTENTION_RING;
  if (p.is_repair) return REPAIR_RING;
  if (p.is_primary) return PRIMARY_RING;
  return null;
}

export function PhotoGrid({ photos, onPhotoClick, compact }: Props) {
  const { isMobile } = useIsMobile();
  const cols = isMobile ? 2 : compact ? 3 : 4;
  const radius = compact ? 8 : 12;

  if (photos.length === 0) {
    return (
      <div style={{
        padding: '32px 16px', textAlign: 'center',
        background: theme.v2.colors.bgCard, borderRadius: radius,
        color: theme.v2.colors.textMuted, fontSize: 13,
      }}>
        No photos yet.
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: compact ? 6 : 10,
    }}>
      {photos.map((p, i) => {
        const ring = ringColor(p);
        const src = p.thumbnail_url || p.storage_url || '';
        return (
          <div
            key={p.id}
            onClick={onPhotoClick ? () => onPhotoClick(p, i) : undefined}
            style={{
              position: 'relative',
              aspectRatio: '1 / 1',
              borderRadius: radius,
              overflow: 'hidden',
              cursor: onPhotoClick ? 'pointer' : 'default',
              background: '#E5E7EB',
              boxShadow: ring ? `0 0 0 3px ${ring}, 0 2px 8px rgba(0,0,0,0.08)` : '0 2px 8px rgba(0,0,0,0.06)',
              transition: 'transform 0.12s ease, box-shadow 0.12s ease',
            }}
            onMouseEnter={e => { if (onPhotoClick) e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={e => { if (onPhotoClick) e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            {src ? (
              <img
                src={src}
                alt={p.file_name || 'Photo'}
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.v2.colors.textMuted, fontSize: 11 }}>
                No preview
              </div>
            )}
            {/* Indicator chips */}
            <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', gap: 4 }}>
              {p.is_primary && (
                <span style={chipStyle(PRIMARY_RING)} title="Primary photo"><Star size={10} /> PRIMARY</span>
              )}
              {p.needs_attention && (
                <span style={chipStyle(ATTENTION_RING)} title="Needs attention"><AlertTriangle size={10} /> FLAG</span>
              )}
              {p.is_repair && (
                <span style={chipStyle(REPAIR_RING)} title="Repair photo"><Wrench size={10} /> REPAIR</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function chipStyle(bg: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    background: bg, color: '#fff',
    fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
    padding: '2px 6px', borderRadius: 4,
    textShadow: '0 1px 1px rgba(0,0,0,0.25)',
  };
}
