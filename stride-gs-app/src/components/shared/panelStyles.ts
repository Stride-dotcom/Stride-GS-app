import { theme } from '../../styles/theme';

/**
 * Returns inline styles for the detail panel container and backdrop,
 * responsive to mobile viewport via a boolean flag.
 */
export function getPanelContainerStyle(width: number, isMobile: boolean): React.CSSProperties {
  if (isMobile) {
    return {
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      width: '100%', maxWidth: '100vw',
      background: '#fff',
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: theme.typography.fontFamily,
      animation: 'slideIn 0.2s ease-out',
      // Match DetailHeader.tsx top-corner radius (20px) so the outer panel
      // corner doesn't peek out behind the rounded black header.
      borderRadius: '20px 20px 0 0',
      overflow: 'hidden',
    };
  }
  return {
    position: 'fixed',
    top: 0, right: 0, bottom: 0,
    width, maxWidth: '95vw',
    background: '#fff',
    borderLeft: `1px solid ${theme.colors.border}`,
    zIndex: 100,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '-4px 0 24px rgba(0,0,0,0.08)',
    fontFamily: theme.typography.fontFamily,
    animation: 'slideIn 0.2s ease-out',
    // Match DetailHeader.tsx top-corner radius (20px) so the outer panel
    // corner doesn't peek out behind the rounded black header.
    borderRadius: '20px 20px 0 0',
    overflow: 'hidden',
  };
}

export const panelBackdropStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 90,
};
