/**
 * ClientSelector — autocomplete dropdown to pick a client for entity pages.
 *
 * Shown only to staff/admin/parent users. Single-client users never see it.
 * Uses useClients() which is already cached in useApiData.
 *
 * Props:
 *   value        — currently selected clientSheetId (null = nothing selected)
 *   onChange     — called with new clientSheetId
 *   placeholder  — text shown when no client is selected (default: "Select a client...")
 *   autoSelectSingle — if true AND only 1 client in list, auto-select it (default: false)
 */
import { useEffect, useMemo } from 'react';
import { useClients } from '../hooks/useClients';
import { AutocompleteSelect } from './shared/AutocompleteSelect';
import type { AutocompleteOption } from './shared/AutocompleteSelect';

interface ClientSelectorProps {
  value: string | null;
  onChange: (clientSheetId: string) => void;
  placeholder?: string;
  autoSelectSingle?: boolean;
}

export function ClientSelector({
  value,
  onChange,
  placeholder = 'Select a client...',
  autoSelectSingle = false,
}: ClientSelectorProps) {
  const { clients, loading } = useClients();

  // Auto-select when there's exactly one client and autoSelectSingle is true
  useEffect(() => {
    if (autoSelectSingle && clients.length === 1 && !value) {
      onChange(clients[0].id);
    }
  }, [autoSelectSingle, clients, value, onChange]);

  const options = useMemo<AutocompleteOption[]>(
    () => clients.map(c => ({ value: c.id, label: c.name })),
    [clients]
  );

  return (
    <AutocompleteSelect
      options={options}
      value={value ?? ''}
      onChange={onChange}
      placeholder={loading ? 'Loading clients...' : placeholder}
      disabled={loading}
    />
  );
}
