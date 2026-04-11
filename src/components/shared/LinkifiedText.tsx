import React from 'react';
import { DeepLink, type DeepLinkKind } from './DeepLink';

/**
 * LinkifiedText — renders a text string with auto-detected entity IDs
 * converted to deep-link anchors that open in a new tab.
 *
 * Detected patterns:
 *   Task IDs:    INSP-XXX-N, ASM-XXX-N, MNRTU-XXX-N, RUSH-XXX-N, DISP-XXX-N, etc.
 *   Repair IDs:  RPR-XXX-N
 *   WC Numbers:  WC-XXXXX (5+ digit WC numbers)
 *
 * Everything else is rendered as plain text (preserving whitespace/newlines).
 *
 * v38.9.0 / Task linkification in Item Notes.
 */

// Match entity IDs used across the system:
//   Task IDs:   2-6 uppercase letters, dash, digits, dash, digits (e.g. INSP-123-1, ASM-59374-285)
//   Repair IDs: RPR-digits-digits
//   WC numbers: WC-digits (5+ digits, e.g. WC-032426)
const ENTITY_ID_REGEX = /\b((?:INSP|ASM|MNRTU|RUSH|DISP|WC|WCPU|REPAIR|RPR|STOR|RCVG)-[\w]+-?\d*)\b/g;

function getDeepLinkKind(id: string): DeepLinkKind | null {
  const prefix = id.split('-')[0].toUpperCase();
  switch (prefix) {
    case 'RPR':
    case 'REPAIR':
      return 'repair';
    case 'WC':
    case 'WCPU':
      return 'willcall';
    // All task-type prefixes → tasks page
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
