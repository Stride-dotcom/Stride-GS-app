import { useState, useMemo } from 'react';

export function useUniversalSearch<T>(
  items: T[],
  searchFields: (item: T) => string[]
) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((item) =>
      searchFields(item).some((field) => field.toLowerCase().includes(q))
    );
  }, [items, query, searchFields]);

  return { query, setQuery, filtered };
}
