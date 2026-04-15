import { useEffect } from 'react';
import { ScanLine } from 'lucide-react';
import { theme } from '../styles/theme';
import { entityEvents } from '../lib/entityEvents';

const BASE_URL = 'https://script.google.com/a/macros/stridenw.com/s/AKfycbyMrvs7SnbchtUf5iZzB4jWkVHV6n4mtDicyOXodPTIlvEUFQEZiUOBHSpvjmTleDZJow/exec';

export function Scanner() {
  const scannerUrl = BASE_URL + '?page=scanner';

  // Listen for move-complete notifications from the scanner iframe and fan
  // them out onto the entityEvents bus. useInventory and BatchDataContext
  // already subscribe, so a silent refetch kicks in within ~1s of the write.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data;
      if (!data || typeof data !== 'object') return;
      if (data.type !== 'stride-scanner-move-complete') return;
      const ids: unknown = data.itemIds;
      if (!Array.isArray(ids) || ids.length === 0) {
        entityEvents.emit('inventory', '*');
        return;
      }
      for (const id of ids) {
        if (typeof id === 'string' && id) entityEvents.emit('inventory', id);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', borderBottom: `1px solid ${theme.colors.border}`,
        background: theme.colors.bgCard, flexShrink: 0,
      }}>
        <ScanLine size={18} style={{ color: theme.colors.primary }} />
        <span style={{ fontSize: 15, fontWeight: 600 }}>QR Scanner</span>
      </div>

      <iframe
        src={scannerUrl}
        title="QR Scanner"
        style={{ flex: 1, border: 'none', width: '100%', minHeight: 0 }}
        allow="camera"
      />
    </div>
  );
}
