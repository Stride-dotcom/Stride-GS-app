import { useState, useCallback, useEffect, useRef } from 'react';

const MIN_WIDTH = 360;
const MAX_WIDTH = 800;

/**
 * Hook for making detail panels resizable by dragging their left edge.
 * Width persists to localStorage per panel key.
 * Desktop only — returns defaultWidth on mobile.
 */
export function useResizablePanel(defaultWidth: number, panelKey: string, isMobile: boolean) {
  const storageKey = `panel-width-${panelKey}`;
  const [width, setWidth] = useState<number>(() => {
    if (isMobile) return defaultWidth;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const n = Number(saved);
        if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
      }
    } catch {}
    return defaultWidth;
  });
  const isResizing = useRef(false);
  const [resizing, setResizing] = useState(false);

  // Persist to localStorage on change
  useEffect(() => {
    if (!isMobile && width !== defaultWidth) {
      try { localStorage.setItem(storageKey, String(width)); } catch {}
    }
  }, [width, isMobile, storageKey, defaultWidth]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isMobile) return;
    e.preventDefault();
    isResizing.current = true;
    setResizing(true);

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - ev.clientX));
      setWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      setResizing(false);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [isMobile]);

  return { width: isMobile ? defaultWidth : width, handleMouseDown, isResizing: resizing };
}
