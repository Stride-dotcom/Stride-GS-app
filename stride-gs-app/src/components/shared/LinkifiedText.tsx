import React from 'react';
import { DeepLink, type DeepLinkKind } from './DeepLink';

/**
 * LinkifiedText — renders a text string with auto-detected entity IDs
 * converted to deep-link anchors that open in a new tab.
 *
 * Detected patterns:
 *   Legacy task IDs:    INSP-XXX-N, ASM-XXX-N, MNRTU-XXX-N, RUSH-XXX-N, DISP-XXX-N, etc.
 *   Legacy repair IDs:  RPR-XXX-N
 *   Legacy WC Numbers:  WC-XXXXX (5+ digit WC numbers)
 *   Clean order IDs:    PREFIX-RPR-N / PREFIX-WC-N / PREFIX-TSK-N (orderNumbering
 *                       feature — type token is the MIDDLE segment, e.g. JAS-RPR-12)
 *
 * Everything else is rendered as plain text (preserving whitespace/newlines).
 *
 * v38.9.0 / Task linkification in Item Notes.
 */

// Match entity IDs used across the system. The first alternative matches the
// clean orderNumbering format FIRST so it captures the whole id (otherwise
// the legacy alternative below would mis-match the inner `WC-7` of `JAS-WC-7`
// or the inner `INSP-13` of `JUS-INSP-13`). Since 2026-06-11 clean task ids
// carry the SERVICE code as the middle token (PREFIX-INSP-N, PREFIX-ASM-N,
// PREFIX-FAB_RUG-N, …) instead of the generic TSK, so the middle segment is
// open-ended ([A-Z][A-Z0-9_]{1,7}); getDeepLinkKind gates what actually
// linkifies — unrecognized shapes render as plain text. The second
// alternative is the legacy token-first form:
//   Task IDs:   2-6 uppercase letters, dash, digits, dash, digits (e.g. INSP-123-1)
//   Repair IDs: RPR-digits-digits
//   WC numbers: WC-digits (5+ digits, e.g. WC-032426)
const ENTITY_ID_REGEX = /\b([A-Za-z]{1,4}-[A-Z][A-Z0-9_]{1,7}-\d+|(?:INSP|ASM|MNRTU|RUSH|DISP|WC|WCPU|REPAIR|RPR|STOR|RCVG)-[\w]+-?\d*)\b/g;

// Clean orderNumbering ids carry the type token in the MIDDLE segment
// (PREFIX-TOKEN-N); legacy ids carry it FIRST. Resolve the token accordingly.
const CLEAN_ORDER_ID = /^[A-Za-z]{1,4}-([A-Z][A-Z0-9_]{1,7})-\d+$/;

// Clean-form middle tokens that resolve to a TASK deep link: the generic TSK
// (pre-2026-06-11 ids) plus the known task service codes. Kept as an explicit
// allowlist — treating ANY unknown middle token as a task would linkify
// arbitrary note text shaped like PO-ABC-123. Custom catalog codes outside
// this list (rare) render as plain text rather than mis-linking.
const CLEAN_TASK_TOKENS = new Set([
  'TSK', 'INSP', 'ASM', 'MNRTU', 'RUSH', 'DISP', 'STOR', 'RCVG',
  'PLLT', 'PICK', 'LABEL', 'RSTK', 'REPAIR', 'SIT', 'NO_ID', 'MULTI_INS',
]);

function getDeepLinkKind(id: string): DeepLinkKind | null {
  const cleanMatch = CLEAN_ORDER_ID.exec(id.toUpperCase());
  if (cleanMatch) {
    const token = cleanMatch[1];
    if (token === 'RPR') return 'repair';
    if (token === 'WC' || token === 'WCPU') return 'willcall';
    // Fabric Protection family (FAB_RUG, FAB_BED, …) is open-ended — match
    // by prefix; everything else goes through the explicit allowlist.
    if (CLEAN_TASK_TOKENS.has(token) || token.startsWith('FAB')) return 'task';
    return null;
  }
  switch (id.split('-')[0].toUpperCase()) {
    case 'RPR':
    case 'REPAIR':
      return 'repair';
    case 'WC':
    case 'WCPU':
      return 'willcall';
    // All task-type tokens → tasks page
    case 'TSK':
    case 'INSP':
    case 'ASM':
    case 'MNRTU':
    case 'RUSH':
    case 'DISP':
    case 'STOR':
    case 'RCVG':
      return 'task';
    default:
      return null;
  }
}

interface Props {
  text: string | undefined | null;
  /** Font size for the container. Default 13. */
  fontSize?: number;
  /** Color for non-linked text. Default inherits. */
  color?: string;
  /** Render style. Default 'inline'. */
  style?: React.CSSProperties;
}

export function LinkifiedText({ text, fontSize = 13, color, style }: Props) {
  if (!text) return <span style={{ color: color || '#94A3B8', ...style }}>—</span>;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(ENTITY_ID_REGEX.source, 'g'); // fresh instance per render

  while ((match = regex.exec(text)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const id = match[1];
    const kind = getDeepLinkKind(id);
    if (kind) {
      parts.push(
        <DeepLink key={`${id}-${match.index}`} kind={kind} id={id} size="sm" showIcon={false} />
      );
    } else {
      // Unrecognized prefix — render as plain text
      parts.push(id);
    }

    lastIndex = regex.lastIndex;
  }

  // Add remaining plain text after last match
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  // If no matches found, return the text as-is
  if (parts.length === 0) {
    return <span style={{ fontSize, color, whiteSpace: 'pre-wrap', ...style }}>{text}</span>;
  }

  return (
    <span style={{ fontSize, color, whiteSpace: 'pre-wrap', ...style }}>
      {parts}
    </span>
  );
}
