import { useState, useCallback } from 'react';

export function useRowSelection<T>(getKey: (row: T) => string) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const toggle = useCallback(
    (row: T) => {
      const key = getKey(row);
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    },
    [getKey]
  );

  const toggleAll = useCallback(
    (rows: T[]) => {
      setSelectedKeys((prev) => {
        const allKeys = rows.map(getKey);
        if (prev.size === allKeys.length) return new Set();
        return new Set(allKeys);
      });
    },
    [getKey]
  );

  const clear = useCallback(() => setSelectedKeys(new Set()), []);

  const isSelected = useCallback((row: T) => selectedKeys.has(getKey(row)), [selectedKeys, getKey]);

  return { selectedKeys, setSelectedKeys, toggle, toggleAll, clear, isSelected };
}
