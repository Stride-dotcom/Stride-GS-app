export const theme = {
  colors: {
    // Brand
    primary: '#E85D2D',
    primaryLight: '#FFF1EC',
    primaryHover: '#D44E20',
    orange: '#E85D2D',
    orangeLight: '#FEF3EE',

    // Backgrounds — Rivian-inspired: warm off-whites, minimal contrast
    bgBase: '#FFFFFF',
    bgSubtle: '#F2F2F2',       // Warmer Rivian gray (was #F9FAFB)
    bgMuted: '#EBEBEB',        // Warmer muted (was #F3F4F6)
    bgSidebar: '#FAFAFA',      // Very light sidebar
    bgSidebarHover: '#F2F2F2',
    bgCard: '#FFFFFF',         // Card backgrounds

    // Text — Rivian uses very dark charcoal
    text: '#151515',           // Darker like Rivian (was #1A1A1A)
    textPrimary: '#151515',
    textSecondary: '#606060',  // Warmer gray (was #6B7280)
    textMuted: '#999999',      // Softer muted (was #9CA3AF)
    textInverse: '#FFFFFF',
    textSidebarPrimary: '#151515',
    textSidebarSecondary: '#606060',
    textSidebarMuted: '#999999',

    // Borders — Rivian uses very subtle borders, relies on spacing instead
    border: '#E8E8E8',         // Softer (was #E5E7EB)
    borderDefault: '#E8E8E8',
    borderSubtle: '#F0F0F0',   // Nearly invisible (was #F3F4F6)
    borderLight: '#F0F0F0',
    borderSidebar: '#EBEBEB',

    // Status
    statusGreen: '#10B981',
    statusGreenBg: '#ECFDF5',
    statusAmber: '#F59E0B',
    statusAmberBg: '#FFFBEB',
    statusRed: '#EF4444',
    statusRedBg: '#FEF2F2',
    statusBlue: '#3B82F6',
    statusBlueBg: '#EFF6FF',
    statusGray: '#6B7280',
    statusGrayBg: '#F3F4F6',
    statusPurple: '#8B5CF6',
    statusPurpleBg: '#F5F3FF',
  },

  spacing: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
    '2xl': '28px',        // More breathing room (was 24px)
    '3xl': '36px',        // More breathing room (was 32px)
    '4xl': '48px',        // More breathing room (was 40px)
    '5xl': '56px',
  },

  typography: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    sizes: {
      xs: '11px',
      sm: '12px',
      base: '13px',
      md: '14px',
      lg: '15px',
      xl: '16px',
      '2xl': '20px',      // Larger headings (was 18px)
      '3xl': '24px',      // Larger (was 20px)
      '4xl': '28px',      // Larger (was 24px)
    },
    weights: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    lineHeights: {
      tight: 1.25,
      normal: 1.5,
      relaxed: 1.75,
    },
  },

  radii: {
    sm: '4px',
    md: '8px',            // Slightly rounder (was 6px)
    lg: '10px',           // Rounder (was 8px)
    xl: '12px',           // Rounder (was 10px)
    '2xl': '16px',        // More round (was 12px)
    full: '9999px',
  },

  shadows: {
    sm: '0 1px 3px rgba(0, 0, 0, 0.04)',   // Softer (was 0.05)
    md: '0 2px 8px rgba(0, 0, 0, 0.06)',    // Softer (was 0.08)
    lg: '0 4px 20px rgba(0, 0, 0, 0.08)',   // Softer, wider (was 16px, 0.10)
    xl: '0 8px 32px rgba(0, 0, 0, 0.10)',   // Softer, wider (was 24px, 0.12)
  },

  // Transitions — Rivian uses 0.3s default
  transitions: {
    fast: '0.15s ease',
    default: '0.3s ease',
    slow: '0.5s ease',
  },

  sidebar: {
    width: '230px',        // Slightly wider (was 220px)
    widthCollapsed: '60px', // Slightly wider (was 56px)
  },

  topbar: {
    height: '60px',        // Slightly taller (was 56px)
  },
} as const;
