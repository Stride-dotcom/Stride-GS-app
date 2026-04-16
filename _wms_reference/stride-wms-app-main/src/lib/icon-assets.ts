/**
 * Icon Assets - Apple-style app icons with light and dark mode support
 *
 * Each icon has a light and dark variant with rounded rectangle backgrounds
 * matching iOS/macOS app icon aesthetics.
 */

// Apple-style squircle path for icon backgrounds (rounded super-ellipse)
const SQUIRCLE_BG_LIGHT = `<rect x="0" y="0" width="48" height="48" rx="10" fill="#f3f4f6"/>`;
const SQUIRCLE_BG_DARK = `<rect x="0" y="0" width="48" height="48" rx="10" fill="#1f2937"/>`;

// Subtle inner shadow for depth
const INNER_SHADOW_LIGHT = `<rect x="1" y="1" width="46" height="46" rx="9" fill="none" stroke="#00000008" stroke-width="1"/>`;
const INNER_SHADOW_DARK = `<rect x="1" y="1" width="46" height="46" rx="9" fill="none" stroke="#ffffff08" stroke-width="1"/>`;

/**
 * Light mode icons (light grey background)
 */
export const ICON_IMAGES_LIGHT = {
  // Claim clipboard icon - brown clipboard with silver clip, "Claim" text, and pen
  claimClipboard: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_LIGHT}${INNER_SHADOW_LIGHT}<g transform="translate(8, 4)"><rect x="2" y="6" width="28" height="36" rx="3" fill="#b87333" stroke="#8b4513" stroke-width="1"/><rect x="4" y="8" width="24" height="32" rx="2" fill="#fff" stroke="#e5e5e5" stroke-width="0.5"/><rect x="10" y="3" width="12" height="8" rx="1" fill="#c0c0c0" stroke="#a0a0a0" stroke-width="1"/><circle cx="16" cy="5" r="2" fill="#a0a0a0"/><text x="16" y="18" font-family="Georgia, serif" font-size="7" font-style="italic" fill="#1a1a1a" text-anchor="middle">Claim</text><line x1="7" y1="23" x2="25" y2="23" stroke="#d0d0d0" stroke-width="1"/><line x1="7" y1="27" x2="22" y2="27" stroke="#d0d0d0" stroke-width="1"/><line x1="7" y1="31" x2="18" y2="31" stroke="#d0d0d0" stroke-width="1"/><line x1="7" y1="35" x2="14" y2="35" stroke="#d0d0d0" stroke-width="1"/><g transform="translate(18, 22) rotate(35)"><rect x="0" y="0" width="3" height="18" rx="1" fill="#1a1a1a"/><polygon points="1.5,18 0,20 3,20" fill="#c0c0c0"/><rect x="0.5" y="1" width="2" height="3" fill="#c0c0c0"/></g></g></svg>`)}`,

  // Broken furniture icon - cracked table
  brokenFurniture: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_LIGHT}${INNER_SHADOW_LIGHT}<g transform="translate(6, 10)"><rect x="2" y="8" width="32" height="5" rx="1" fill="#d4a574" stroke="#92400e" stroke-width="1.5"/><path d="M6 13 L6 28" stroke="#92400e" stroke-width="3" stroke-linecap="round"/><path d="M30 13 L30 28" stroke="#92400e" stroke-width="3" stroke-linecap="round"/><path d="M15 9 L16.5 4 L19 11 L21 5 L22 9" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="17" cy="2" r="2.5" fill="#fbbf24"/><path d="M14.5 1 L13 -1" stroke="#fbbf24" stroke-width="1.5" stroke-linecap="round"/><path d="M19.5 1 L21 -1" stroke="#fbbf24" stroke-width="1.5" stroke-linecap="round"/><path d="M17 -0.5 L17 -2.5" stroke="#fbbf24" stroke-width="1.5" stroke-linecap="round"/></g></svg>`)}`,

  // Damaged box icon - crushed cardboard box
  damagedBox: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_LIGHT}${INNER_SHADOW_LIGHT}<g transform="translate(6, 6)"><path d="M4 12 L18 4 L32 12 L32 28 L18 36 L4 28 Z" fill="#fef3c7" stroke="#b45309" stroke-width="2"/><path d="M18 4 L18 36" stroke="#b45309" stroke-width="1.5" stroke-dasharray="3 2"/><path d="M4 12 L18 20 L32 12" stroke="#b45309" stroke-width="1.5"/><path d="M8 15 L10 20 L7 24 L12 26" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M26 14 L28 19 L25 23" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 31 L17 28 L15 33" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="28" cy="8" rx="5" ry="3.5" fill="#fef3c7" stroke="#f59e0b" stroke-width="1.5"/><text x="28" y="10" font-family="system-ui, -apple-system, sans-serif" font-size="6" font-weight="700" fill="#f59e0b" text-anchor="middle">!</text></g></svg>`)}`,

  // Barcode scanner icon - handheld scanner device
  barcodeScanner: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_LIGHT}${INNER_SHADOW_LIGHT}<g transform="translate(10, 4)"><rect x="4" y="2" width="20" height="14" rx="2" fill="#374151" stroke="#1f2937" stroke-width="1.5"/><rect x="6" y="4" width="16" height="9" rx="1" fill="#60a5fa"/><rect x="6" y="16" width="16" height="22" rx="2" fill="#4b5563" stroke="#1f2937" stroke-width="1.5"/><circle cx="14" cy="34" r="2.5" fill="#1f2937"/><rect x="8" y="20" width="12" height="8" rx="1" fill="#d1d5db"/><line x1="10" y1="22" x2="10" y2="26" stroke="#374151" stroke-width="1"/><line x1="12" y1="22" x2="12" y2="26" stroke="#374151" stroke-width="2"/><line x1="14" y1="22" x2="14" y2="26" stroke="#374151" stroke-width="1"/><line x1="16" y1="22" x2="16" y2="26" stroke="#374151" stroke-width="2"/><line x1="18" y1="22" x2="18" y2="26" stroke="#374151" stroke-width="1"/><path d="M-2 8 L4 8" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/><path d="M-2 8 L-2 4" stroke="#ef4444" stroke-width="2" stroke-linecap="round" opacity="0.6"/></g></svg>`)}`,

  // Checklist icon - clipboard with checkmarks
  checklist: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_LIGHT}${INNER_SHADOW_LIGHT}<g transform="translate(10, 6)"><rect x="2" y="4" width="24" height="32" rx="2" stroke="#374151" stroke-width="2" fill="#fff"/><rect x="8" y="0" width="12" height="8" rx="2" stroke="#374151" stroke-width="2" fill="#f9fafb"/><circle cx="8" cy="14" r="3" fill="#22c55e"/><path d="M6 14 L7.5 15.5 L10 12.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="14" y1="14" x2="24" y2="14" stroke="#6b7280" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="22" r="3" fill="#22c55e"/><path d="M6 22 L7.5 23.5 L10 20.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="14" y1="22" x2="24" y2="22" stroke="#6b7280" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="30" r="3" fill="#ef4444"/><path d="M6.5 28.5 L9.5 31.5 M9.5 28.5 L6.5 31.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><line x1="14" y1="30" x2="24" y2="30" stroke="#6b7280" stroke-width="2" stroke-linecap="round"/></g></svg>`)}`,

  // Inspection icon - magnifying glass over document
  inspection: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_LIGHT}${INNER_SHADOW_LIGHT}<g transform="translate(6, 6)"><rect x="2" y="2" width="20" height="28" rx="2" fill="#fff" stroke="#374151" stroke-width="2"/><line x1="6" y1="10" x2="18" y2="10" stroke="#9ca3af" stroke-width="2" stroke-linecap="round"/><line x1="6" y1="16" x2="18" y2="16" stroke="#9ca3af" stroke-width="2" stroke-linecap="round"/><line x1="6" y1="22" x2="14" y2="22" stroke="#9ca3af" stroke-width="2" stroke-linecap="round"/><circle cx="28" cy="24" r="7" fill="#dbeafe" stroke="#2563eb" stroke-width="2.5"/><line x1="33" y1="29" x2="38" y2="34" stroke="#2563eb" stroke-width="3.5" stroke-linecap="round"/></g></svg>`)}`,

  // Repair icon - wrench tool
  repair: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_LIGHT}${INNER_SHADOW_LIGHT}<g transform="translate(8, 8)"><path d="M25 7a8 8 0 0 0-11.3 0l-2.1 2.1 8.5 8.5 2.1-2.1a8 8 0 0 0 0-11.3l-2.8 2.8-3.5-3.5 2.8-2.8" fill="#f59e0b" stroke="#92400e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.6 17.6 L3.5 25.7a3 3 0 0 0 0 4.2l.6.6a3 3 0 0 0 4.2 0l8.1-8.1" fill="#6b7280" stroke="#374151" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="28" r="2" fill="#ef4444"/></g></svg>`)}`,

  // Tasks icon - checklist box
  tasks: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_LIGHT}${INNER_SHADOW_LIGHT}<g transform="translate(8, 8)"><rect x="2" y="6" width="28" height="24" rx="3" fill="#fff" stroke="#2563eb" stroke-width="2"/><path d="M10 18 L14 22 L24 12" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g></svg>`)}`,

  // Scan icon - barcode in frame (minimal style)
  scan: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_LIGHT}${INNER_SHADOW_LIGHT}<g transform="translate(6, 8)"><rect x="2" y="2" width="32" height="28" rx="2" fill="#fff" stroke="#e5e5e5" stroke-width="1.5"/><rect x="4" y="4" width="28" height="24" rx="1" fill="#fafafa" stroke="#d4d4d4" stroke-width="1"/><g transform="translate(8, 8)"><line x1="0" y1="0" x2="0" y2="16" stroke="#1a1a1a" stroke-width="2"/><line x1="3" y1="0" x2="3" y2="16" stroke="#1a1a1a" stroke-width="1"/><line x1="5" y1="0" x2="5" y2="16" stroke="#1a1a1a" stroke-width="3"/><line x1="9" y1="0" x2="9" y2="16" stroke="#1a1a1a" stroke-width="1"/><line x1="11" y1="0" x2="11" y2="16" stroke="#1a1a1a" stroke-width="2"/><line x1="14" y1="0" x2="14" y2="16" stroke="#1a1a1a" stroke-width="1"/><line x1="16" y1="0" x2="16" y2="16" stroke="#1a1a1a" stroke-width="3"/><line x1="20" y1="0" x2="20" y2="16" stroke="#1a1a1a" stroke-width="1"/></g></g></svg>`)}`,

  // Damage icon - warning
  damage: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_LIGHT}${INNER_SHADOW_LIGHT}<g transform="translate(6, 8)"><path d="M18 4 L34 32 H2 Z" fill="#fef3c7" stroke="#f59e0b" stroke-width="2.5" stroke-linejoin="round"/><line x1="18" y1="14" x2="18" y2="22" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/><circle cx="18" cy="27" r="2" fill="#f59e0b"/></g></svg>`)}`,

  // Damaged package icon
  damagedPackage: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_LIGHT}${INNER_SHADOW_LIGHT}<g transform="translate(6, 6)"><path d="M18 4 L34 12 L34 28 L18 36 L2 28 L2 12 Z" fill="#fee2e2" stroke="#dc2626" stroke-width="2"/><path d="M2 12 L18 20 L34 12" stroke="#dc2626" stroke-width="1.5"/><path d="M18 20 L18 36" stroke="#dc2626" stroke-width="1.5"/><path d="M14 8 L12 14 L16 16 L13 22" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`)}`,

  // Claims icon
  claims: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_LIGHT}${INNER_SHADOW_LIGHT}<g transform="translate(10, 6)"><path d="M20 2H6a3 3 0 0 0-3 3v26a3 3 0 0 0 3 3h16a3 3 0 0 0 3-3V10Z" fill="#fff" stroke="#7c3aed" stroke-width="2"/><path d="M20 2 L20 10 L28 10" fill="#f5f3ff" stroke="#7c3aed" stroke-width="2" stroke-linejoin="round"/><line x1="8" y1="18" x2="20" y2="18" stroke="#a78bfa" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="24" x2="20" y2="24" stroke="#a78bfa" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="30" x2="14" y2="30" stroke="#a78bfa" stroke-width="2" stroke-linecap="round"/></g></svg>`)}`,
} as const;

/**
 * Dark mode icons (dark grey background)
 */
export const ICON_IMAGES_DARK = {
  // Claim clipboard icon - brown clipboard with silver clip, "Claim" text, and pen
  claimClipboard: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_DARK}${INNER_SHADOW_DARK}<g transform="translate(8, 4)"><rect x="2" y="6" width="28" height="36" rx="3" fill="#8b5a2b" stroke="#6b4423" stroke-width="1"/><rect x="4" y="8" width="24" height="32" rx="2" fill="#f5f5f5" stroke="#d0d0d0" stroke-width="0.5"/><rect x="10" y="3" width="12" height="8" rx="1" fill="#9ca3af" stroke="#6b7280" stroke-width="1"/><circle cx="16" cy="5" r="2" fill="#6b7280"/><text x="16" y="18" font-family="Georgia, serif" font-size="7" font-style="italic" fill="#1a1a1a" text-anchor="middle">Claim</text><line x1="7" y1="23" x2="25" y2="23" stroke="#c0c0c0" stroke-width="1"/><line x1="7" y1="27" x2="22" y2="27" stroke="#c0c0c0" stroke-width="1"/><line x1="7" y1="31" x2="18" y2="31" stroke="#c0c0c0" stroke-width="1"/><line x1="7" y1="35" x2="14" y2="35" stroke="#c0c0c0" stroke-width="1"/><g transform="translate(18, 22) rotate(35)"><rect x="0" y="0" width="3" height="18" rx="1" fill="#2a2a2a"/><polygon points="1.5,18 0,20 3,20" fill="#9ca3af"/><rect x="0.5" y="1" width="2" height="3" fill="#9ca3af"/></g></g></svg>`)}`,

  // Broken furniture icon - cracked table
  brokenFurniture: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_DARK}${INNER_SHADOW_DARK}<g transform="translate(6, 10)"><rect x="2" y="8" width="32" height="5" rx="1" fill="#a16207" stroke="#d4a574" stroke-width="1.5"/><path d="M6 13 L6 28" stroke="#d4a574" stroke-width="3" stroke-linecap="round"/><path d="M30 13 L30 28" stroke="#d4a574" stroke-width="3" stroke-linecap="round"/><path d="M15 9 L16.5 4 L19 11 L21 5 L22 9" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="17" cy="2" r="2.5" fill="#fcd34d"/><path d="M14.5 1 L13 -1" stroke="#fcd34d" stroke-width="1.5" stroke-linecap="round"/><path d="M19.5 1 L21 -1" stroke="#fcd34d" stroke-width="1.5" stroke-linecap="round"/><path d="M17 -0.5 L17 -2.5" stroke="#fcd34d" stroke-width="1.5" stroke-linecap="round"/></g></svg>`)}`,

  // Damaged box icon - crushed cardboard box
  damagedBox: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_DARK}${INNER_SHADOW_DARK}<g transform="translate(6, 6)"><path d="M4 12 L18 4 L32 12 L32 28 L18 36 L4 28 Z" fill="#78350f" stroke="#d97706" stroke-width="2"/><path d="M18 4 L18 36" stroke="#d97706" stroke-width="1.5" stroke-dasharray="3 2"/><path d="M4 12 L18 20 L32 12" stroke="#d97706" stroke-width="1.5"/><path d="M8 15 L10 20 L7 24 L12 26" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M26 14 L28 19 L25 23" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 31 L17 28 L15 33" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="28" cy="8" rx="5" ry="3.5" fill="#451a03" stroke="#fbbf24" stroke-width="1.5"/><text x="28" y="10" font-family="system-ui, -apple-system, sans-serif" font-size="6" font-weight="700" fill="#fbbf24" text-anchor="middle">!</text></g></svg>`)}`,

  // Barcode scanner icon - handheld scanner device
  barcodeScanner: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_DARK}${INNER_SHADOW_DARK}<g transform="translate(10, 4)"><rect x="4" y="2" width="20" height="14" rx="2" fill="#4b5563" stroke="#6b7280" stroke-width="1.5"/><rect x="6" y="4" width="16" height="9" rx="1" fill="#3b82f6"/><rect x="6" y="16" width="16" height="22" rx="2" fill="#374151" stroke="#6b7280" stroke-width="1.5"/><circle cx="14" cy="34" r="2.5" fill="#6b7280"/><rect x="8" y="20" width="12" height="8" rx="1" fill="#4b5563"/><line x1="10" y1="22" x2="10" y2="26" stroke="#9ca3af" stroke-width="1"/><line x1="12" y1="22" x2="12" y2="26" stroke="#9ca3af" stroke-width="2"/><line x1="14" y1="22" x2="14" y2="26" stroke="#9ca3af" stroke-width="1"/><line x1="16" y1="22" x2="16" y2="26" stroke="#9ca3af" stroke-width="2"/><line x1="18" y1="22" x2="18" y2="26" stroke="#9ca3af" stroke-width="1"/><path d="M-2 8 L4 8" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/><path d="M-2 8 L-2 4" stroke="#ef4444" stroke-width="2" stroke-linecap="round" opacity="0.6"/></g></svg>`)}`,

  // Checklist icon - clipboard with checkmarks
  checklist: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_DARK}${INNER_SHADOW_DARK}<g transform="translate(10, 6)"><rect x="2" y="4" width="24" height="32" rx="2" stroke="#6b7280" stroke-width="2" fill="#374151"/><rect x="8" y="0" width="12" height="8" rx="2" stroke="#6b7280" stroke-width="2" fill="#4b5563"/><circle cx="8" cy="14" r="3" fill="#22c55e"/><path d="M6 14 L7.5 15.5 L10 12.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="14" y1="14" x2="24" y2="14" stroke="#9ca3af" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="22" r="3" fill="#22c55e"/><path d="M6 22 L7.5 23.5 L10 20.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="14" y1="22" x2="24" y2="22" stroke="#9ca3af" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="30" r="3" fill="#ef4444"/><path d="M6.5 28.5 L9.5 31.5 M9.5 28.5 L6.5 31.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><line x1="14" y1="30" x2="24" y2="30" stroke="#9ca3af" stroke-width="2" stroke-linecap="round"/></g></svg>`)}`,

  // Inspection icon - magnifying glass over document
  inspection: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_DARK}${INNER_SHADOW_DARK}<g transform="translate(6, 6)"><rect x="2" y="2" width="20" height="28" rx="2" fill="#374151" stroke="#6b7280" stroke-width="2"/><line x1="6" y1="10" x2="18" y2="10" stroke="#6b7280" stroke-width="2" stroke-linecap="round"/><line x1="6" y1="16" x2="18" y2="16" stroke="#6b7280" stroke-width="2" stroke-linecap="round"/><line x1="6" y1="22" x2="14" y2="22" stroke="#6b7280" stroke-width="2" stroke-linecap="round"/><circle cx="28" cy="24" r="7" fill="#1e3a5f" stroke="#3b82f6" stroke-width="2.5"/><line x1="33" y1="29" x2="38" y2="34" stroke="#3b82f6" stroke-width="3.5" stroke-linecap="round"/></g></svg>`)}`,

  // Repair icon - wrench tool
  repair: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_DARK}${INNER_SHADOW_DARK}<g transform="translate(8, 8)"><path d="M25 7a8 8 0 0 0-11.3 0l-2.1 2.1 8.5 8.5 2.1-2.1a8 8 0 0 0 0-11.3l-2.8 2.8-3.5-3.5 2.8-2.8" fill="#d97706" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.6 17.6 L3.5 25.7a3 3 0 0 0 0 4.2l.6.6a3 3 0 0 0 4.2 0l8.1-8.1" fill="#4b5563" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="28" r="2" fill="#ef4444"/></g></svg>`)}`,

  // Tasks icon - checklist box
  tasks: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_DARK}${INNER_SHADOW_DARK}<g transform="translate(8, 8)"><rect x="2" y="6" width="28" height="24" rx="3" fill="#374151" stroke="#3b82f6" stroke-width="2"/><path d="M10 18 L14 22 L24 12" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g></svg>`)}`,

  // Scan icon - barcode in frame (minimal style)
  scan: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_DARK}${INNER_SHADOW_DARK}<g transform="translate(6, 8)"><rect x="2" y="2" width="32" height="28" rx="2" fill="#374151" stroke="#4b5563" stroke-width="1.5"/><rect x="4" y="4" width="28" height="24" rx="1" fill="#f5f5f5" stroke="#e5e5e5" stroke-width="1"/><g transform="translate(8, 8)"><line x1="0" y1="0" x2="0" y2="16" stroke="#1a1a1a" stroke-width="2"/><line x1="3" y1="0" x2="3" y2="16" stroke="#1a1a1a" stroke-width="1"/><line x1="5" y1="0" x2="5" y2="16" stroke="#1a1a1a" stroke-width="3"/><line x1="9" y1="0" x2="9" y2="16" stroke="#1a1a1a" stroke-width="1"/><line x1="11" y1="0" x2="11" y2="16" stroke="#1a1a1a" stroke-width="2"/><line x1="14" y1="0" x2="14" y2="16" stroke="#1a1a1a" stroke-width="1"/><line x1="16" y1="0" x2="16" y2="16" stroke="#1a1a1a" stroke-width="3"/><line x1="20" y1="0" x2="20" y2="16" stroke="#1a1a1a" stroke-width="1"/></g></g></svg>`)}`,

  // Damage icon - warning
  damage: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_DARK}${INNER_SHADOW_DARK}<g transform="translate(6, 8)"><path d="M18 4 L34 32 H2 Z" fill="#78350f" stroke="#fbbf24" stroke-width="2.5" stroke-linejoin="round"/><line x1="18" y1="14" x2="18" y2="22" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"/><circle cx="18" cy="27" r="2" fill="#fbbf24"/></g></svg>`)}`,

  // Damaged package icon
  damagedPackage: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_DARK}${INNER_SHADOW_DARK}<g transform="translate(6, 6)"><path d="M18 4 L34 12 L34 28 L18 36 L2 28 L2 12 Z" fill="#7f1d1d" stroke="#f87171" stroke-width="2"/><path d="M2 12 L18 20 L34 12" stroke="#f87171" stroke-width="1.5"/><path d="M18 20 L18 36" stroke="#f87171" stroke-width="1.5"/><path d="M14 8 L12 14 L16 16 L13 22" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`)}`,

  // Claims icon
  claims: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${SQUIRCLE_BG_DARK}${INNER_SHADOW_DARK}<g transform="translate(10, 6)"><path d="M20 2H6a3 3 0 0 0-3 3v26a3 3 0 0 0 3 3h16a3 3 0 0 0 3-3V10Z" fill="#374151" stroke="#a78bfa" stroke-width="2"/><path d="M20 2 L20 10 L28 10" fill="#4b5563" stroke="#a78bfa" stroke-width="2" stroke-linejoin="round"/><line x1="8" y1="18" x2="20" y2="18" stroke="#6b7280" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="24" x2="20" y2="24" stroke="#6b7280" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="30" x2="14" y2="30" stroke="#6b7280" stroke-width="2" stroke-linecap="round"/></g></svg>`)}`,
} as const;

/**
 * Default export uses light mode icons for backwards compatibility
 */
export const ICON_IMAGES = ICON_IMAGES_LIGHT;

export type IconName = keyof typeof ICON_IMAGES_LIGHT;

/**
 * Get all available icon names
 */
export const getIconNames = (): IconName[] => {
  return Object.keys(ICON_IMAGES_LIGHT) as IconName[];
};

/**
 * Get icon by name and theme
 */
export const getIcon = (name: IconName, theme: 'light' | 'dark' = 'light'): string => {
  return theme === 'dark' ? ICON_IMAGES_DARK[name] : ICON_IMAGES_LIGHT[name];
};
