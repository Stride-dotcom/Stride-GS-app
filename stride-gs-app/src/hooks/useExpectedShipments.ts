/**
 * useExpectedShipments — localStorage CRUD for expected shipment calendar entries.
 * Per-user keyed by email (mirrors useQuoteStore pattern).
 */
import { useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';

export interface ExpectedShipment {
  id: string;
  client: string;
  clientSheetId?: string;
  vendor: string;
  carrier: string;
  tracking?: string;
  expectedDate: string; // YYYY-MM-DD
  pieces?: number;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

function storageKey(email: string) {
  return `stride_expected_shipments_${email}`;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

export function useExpectedShipments() {
  const { user } = useAuth();
  const email = user?.email || '_anon';
  const keyRef = useRef(storageKey(email));
  keyRef.current = storageKey(email);

  const [items, setItemsRaw] = useState<ExpectedShipment[]>(() => loadJson(keyRef.current, []));

  const setItems = useCallback((updater: ExpectedShipment[] | ((prev: ExpectedShipment[]) => ExpectedShipment[])) => {
    setItemsRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveJson(keyRef.current, next);
      return next;
    });
  }, []);

  const add = useCallback((entry: Omit<ExpectedShipment, 'id' | 'createdBy' | 'createdAt'>) => {
    const full: ExpectedShipment = {
      ...entry,
      id: crypto.randomUUID(),
      createdBy: email,
      createdAt: new Date().toISOString(),
    };
    setItems(prev => [full, ...prev]);
    return full;
  }, [email, setItems]);

  const update = useCallback((id: string, patch: Partial<ExpectedShipment>) => {
    setItems(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  }, [setItems]);

  const remove = useCallback((id: string) => {
    setItems(prev => prev.filter(e => e.id !== id));
  }, [setItems]);

  return { items, add, update, remove };
}
