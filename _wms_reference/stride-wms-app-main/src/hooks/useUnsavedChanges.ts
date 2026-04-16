import { useState, useCallback, useRef } from 'react';

interface UseUnsavedChangesReturn {
  isDirty: boolean;
  markDirty: () => void;
  markClean: () => void;
  handleInteractOutside: (e: Event) => void;
  handleEscapeKeyDown: (e: KeyboardEvent) => void;
  showConfirmation: boolean;
  confirmDiscard: () => void;
  cancelDiscard: () => void;
  pendingCloseRef: React.MutableRefObject<(() => void) | null>;
}

export function useUnsavedChanges(): UseUnsavedChangesReturn {
  const [isDirty, setIsDirty] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const pendingCloseRef = useRef<(() => void) | null>(null);

  const markDirty = useCallback(() => setIsDirty(true), []);
  const markClean = useCallback(() => {
    setIsDirty(false);
    setShowConfirmation(false);
  }, []);

  const handleInteractOutside = useCallback((e: Event) => {
    if (isDirty) {
      e.preventDefault();
      setShowConfirmation(true);
    }
  }, [isDirty]);

  const handleEscapeKeyDown = useCallback((e: KeyboardEvent) => {
    if (isDirty) {
      e.preventDefault();
      setShowConfirmation(true);
    }
  }, [isDirty]);

  const confirmDiscard = useCallback(() => {
    setIsDirty(false);
    setShowConfirmation(false);
    if (pendingCloseRef.current) {
      pendingCloseRef.current();
      pendingCloseRef.current = null;
    }
  }, []);

  const cancelDiscard = useCallback(() => {
    setShowConfirmation(false);
  }, []);

  return {
    isDirty,
    markDirty,
    markClean,
    handleInteractOutside,
    handleEscapeKeyDown,
    showConfirmation,
    confirmDiscard,
    cancelDiscard,
    pendingCloseRef,
  };
}
