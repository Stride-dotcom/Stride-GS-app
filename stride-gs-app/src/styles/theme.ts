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

  // ── v2 design tokens (Quote Tool prototype aesthetic) ────────────────────
  // Phase 1: used by Quote Tool only. Phase 2+ will migrate other pages.
  v2: {
    colors: {
      bgPage: '#F5F2EE',           // warm cream page background
      bgCard: '#EDE9E3',           // slightly darker cream card
      bgDark: '#1C1C1C',           // near-black (stats, totals)
      bgWhite: '#FFFFFF',          // inputs, table cells
      accent: '#E8692A',           // orange primary
      accentLight: 'rgba(232,105,42,0.12)',
      accentHover: '#D45A1E',
      text: '#1C1C1C',
      textSecondary: '#666666',
      textMuted: '#999999',
      textOnDark: '#FFFFFF',
      textOnDarkMuted: 'rgba(255,255,255,0.5)',
      border: 'rgba(0,0,0,0.08)',
      borderOnDark: 'rgba(255,255,255,0.15)',
      // Status pills
      statusDraft: { bg: 'rgba(200,160,40,0.15)', text: '#B08810' },
      statusSent: { bg: 'rgba(40,130,200,0.15)', text: '#2B7FC5' },
      statusAccepted: { bg: 'rgba(74,138,92,0.15)', text: '#4A8A5C' },
      statusDeclined: { bg: 'rgba(180,90,90,0.15)', text: '#B45A5A' },
      statusExpired: { bg: 'rgba(140,140,140,0.15)', text: '#666666' },
    },
    radius: {
      card: '20px',
      input: '10px',
      button: '100px',     // pill
      table: '12px',
      badge: '100px',
      chip: '4px',
    },
    typography: {
      label: { fontSize: '10px', fontWeight: 500, letterSpacing: '2px', textTransform: 'uppercase' as const, color: '#999999' },
      cardTitle: { fontSize: '20px', fontWeight: 400 },
      statValue: { fontSize: '28px', fontWeight: 300 },
      buttonPrimary: { fontSize: '11px', fontWeight: 600, letterSpacing: '2px', textTransform: 'uppercase' as const },
    },
    card: {
      padding: '28px 32px',
    },
    table: {
      headerFontSize: '10px',
      headerWeight: 600,
      headerLetterSpacing: '2px',
      cellPadding: '14px 16px',
      cellFontSize: '13px',
      rowBorder: 'rgba(0,0,0,0.05)',
    },
  },
} as const;
