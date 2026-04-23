/**
 * DriveFoldersList — Google Drive–style folder rows.
 *
 * Used in Photos/Docs tabs of entity pages (page mode) to surface legacy
 * Drive folder links. State-aware: each entry only renders when its URL
 * exists, and the whole component returns null if no folders are provided.
 */
import { ExternalLink } from 'lucide-react';
import { theme } from '../../styles/theme';

export interface DriveFolderLink {
  label: string;
  url: string;
}

export function DriveFoldersList({ folders }: { folders: DriveFolderLink[] }) {
  if (!folders.length) return null;
  return (
    <div style={{ borderTop: `1px solid ${theme.colors.border}`, paddingTop: 14, marginTop: 14 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: theme.colors.orange,
        textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8,
        textAlign: 'center',
      }}>Legacy folders</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
        {folders.map(f => (
          <a
            key={f.label + f.url}
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px',
              background: '#fff',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: 10,
              textDecoration: 'none',
              color: theme.colors.text,
              width: '100%', maxWidth: 360,
            }}
          >
            {/* Google Drive–style triangle icon */}
            <span style={{
              width: 34, height: 34, borderRadius: 8,
              background: 'linear-gradient(135deg, #4285F4 25%, #34A853 25%, #34A853 50%, #FBBC04 50%, #FBBC04 75%, #EA4335 75%)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M3 17L8 7H16L21 17H3Z" fill="white" fillOpacity="0.9" />
                <path d="M8 7L13 17H3L8 7Z" fill="white" fillOpacity="0.7" />
              </svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{f.label}</div>
              <div style={{ fontSize: 10, color: theme.colors.textMuted }}>Open in Google Drive</div>
            </div>
            <ExternalLink size={13} color={theme.colors.textMuted} />
          </a>
        ))}
      </div>
    </div>
  );
}
