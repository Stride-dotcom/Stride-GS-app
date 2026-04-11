import { Tag } from 'lucide-react';
import { theme } from '../styles/theme';

const BASE_URL = 'https://script.google.com/a/macros/stridenw.com/s/AKfycbyMrvs7SnbchtUf5iZzB4jWkVHV6n4mtDicyOXodPTIlvEUFQEZiUOBHSpvjmTleDZJow/exec';

export function Labels() {
  const labelsUrl = BASE_URL + '?page=labels';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', borderBottom: `1px solid ${theme.colors.border}`,
        background: theme.colors.bgCard, flexShrink: 0,
      }}>
        <Tag size={18} style={{ color: theme.colors.primary }} />
        <span style={{ fontSize: 15, fontWeight: 600 }}>Label Printer</span>
      </div>

      <iframe
        src={labelsUrl}
        title="Label Printer"
        style={{ flex: 1, border: 'none', width: '100%', minHeight: 0 }}
      />
    </div>
  );
}
