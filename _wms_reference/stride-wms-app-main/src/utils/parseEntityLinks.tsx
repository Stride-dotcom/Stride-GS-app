import React from 'react';
import { ENTITY_CONFIG, EntityType } from '@/config/entities';
import { EntityLink } from '@/components/chat/EntityLink';

export interface EntityInfo {
  id: string;
  type: EntityType;
  exists: boolean;
  summary?: string;
}

export type EntityMap = Record<string, EntityInfo>;

interface Match {
  type: EntityType;
  number: string;
  start: number;
  end: number;
}

/**
 * Parse a message string and convert entity references to clickable EntityLink components
 */
export function parseMessageWithLinks(
  message: string,
  entityMap?: EntityMap,
  options?: { variant?: 'chip' | 'inline' }
): React.ReactNode[] {
  const allPatterns = Object.entries(ENTITY_CONFIG).map(([type, config]) => ({
    type: type as EntityType,
    pattern: new RegExp(config.pattern.source, config.pattern.flags),
  }));

  const matches: Match[] = [];

  // Find all entity matches in the message
  for (const { type, pattern } of allPatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(message)) !== null) {
      matches.push({
        type,
        number: match[1].toUpperCase(),
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  // Sort matches by position
  matches.sort((a, b) => a.start - b.start);

  // Remove overlapping matches (keep earliest)
  const filteredMatches: Match[] = [];
  for (const match of matches) {
    const lastMatch = filteredMatches[filteredMatches.length - 1];
    if (!lastMatch || match.start >= lastMatch.end) {
      filteredMatches.push(match);
    }
  }

  // Build result array with text and EntityLink components
  const result: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of filteredMatches) {
    // Add text before this match
    if (match.start > lastIndex) {
      result.push(message.slice(lastIndex, match.start));
    }

    // Get entity info from map if available
    const entityInfo = entityMap?.[match.number];

    // Add EntityLink component
    result.push(
      <EntityLink
        key={`${match.type}-${match.number}-${match.start}`}
        type={match.type}
        number={match.number}
        id={entityInfo?.id}
        exists={entityInfo?.exists ?? true}
        summary={entityInfo?.summary}
        variant={options?.variant}
      />
    );

    lastIndex = match.end;
  }

  // Add remaining text after last match
  if (lastIndex < message.length) {
    result.push(message.slice(lastIndex));
  }

  return result.length > 0 ? result : [message];
}

/**
 * Extract all entity numbers from a text string
 */
export function extractEntityNumbers(text: string): string[] {
  const numbers: string[] = [];

  for (const config of Object.values(ENTITY_CONFIG)) {
    const pattern = new RegExp(config.pattern.source, config.pattern.flags);
    const matches = text.match(pattern);
    if (matches) {
      numbers.push(...matches.map((m) => m.toUpperCase()));
    }
  }

  return [...new Set(numbers)];
}

/**
 * Get the entity type from a number string
 */
export function getEntityTypeFromNumber(number: string): EntityType | null {
  const upperNumber = number.toUpperCase();

  for (const [type, config] of Object.entries(ENTITY_CONFIG)) {
    if (upperNumber.startsWith(config.prefix + '-')) {
      return type as EntityType;
    }
  }

  return null;
}

/**
 * Format entity number with proper prefix
 */
export function formatEntityNumber(
  type: EntityType,
  numericPart: string | number
): string {
  const config = ENTITY_CONFIG[type];
  const padded = String(numericPart).padStart(5, '0');
  return `${config.prefix}-${padded}`;
}
