import type { CSSProperties } from 'react';

/** Extra inline styles to apply when isMobile is true */
export function mobileTableWrapper(isMobile: boolean): CSSProperties {
  if (!isMobile) return {};
  return { overflowX: 'auto', WebkitOverflowScrolling: 'touch' };
}

export function mobileTh(isMobile: boolean, isFirst: boolean): CSSProperties {
  if (!isMobile || !isFirst) return {};
  return {
    position: 'sticky',
    left: 0,
    zIndex: 3,
    background: '#fff',
  };
}

export function mobileTd(isMobile: boolean, isFirst: boolean): CSSProperties {
  const base: CSSProperties = isMobile ? { minHeight: 48, padding: '12px 12px' } : {};
  if (!isMobile || !isFirst) return base;
  return {
    ...base,
    position: 'sticky',
    left: 0,
    zIndex: 1,
    background: '#fff',
  };
}

export function mobileChipsRow(isMobile: boolean): CSSProperties {
  if (!isMobile) return { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' };
  return {
    display: 'flex',
    gap: 6,
    marginBottom: 10,
    flexWrap: 'wrap',
    paddingBottom: 2,
  };
}

export function mobileToolbar(isMobile: boolean): CSSProperties {
  if (!isMobile) return { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 };
  return {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 12,
  };
}

export function mobilePageHeader(isMobile: boolean): CSSProperties {
  if (!isMobile) return { marginBottom: 16 };
  return { marginBottom: 12 };
}
