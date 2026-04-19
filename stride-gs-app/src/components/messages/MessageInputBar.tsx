/**
 * MessageInputBar — iMessage-style message composer.
 *
 * Ported from the Stride WMS app. Pill input with a round send button.
 * Enter sends; Shift+Enter inserts a newline. The plus button is a
 * placeholder for future attachments (camera, file, etc.).
 */
import { useCallback, useState } from 'react';
import { ArrowUp, Plus } from 'lucide-react';
import { theme } from '../../styles/theme';

interface Props {
  onSend: (body: string) => void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

export function MessageInputBar({ onSend, disabled = false, placeholder = 'iMessage', autoFocus = false }: Props) {
  const v2 = theme.v2;
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);

  const canSend = !disabled && !sending && value.trim().length > 0;

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    const body = value.trim();
    setSending(true);
    try {
      await onSend(body);
      setValue('');
    } finally {
      setSending(false);
    }
  }, [canSend, value, onSend]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', gap: 8,
      padding: '10px 12px',
      borderTop: `1px solid ${v2.colors.border}`,
      background: v2.colors.bgWhite,
      fontFamily: theme.typography.fontFamily,
    }}>
      {/* Attachment placeholder */}
      <button
        type="button"
        disabled
        title="Attachments (coming soon)"
        style={{
          width: 34, height: 34, borderRadius: '50%',
          background: v2.colors.bgCard, color: v2.colors.textMuted,
          border: 'none', cursor: 'not-allowed',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Plus size={16} />
      </button>

      {/* Pill textarea */}
      <div style={{
        flex: 1,
        display: 'flex', alignItems: 'center', gap: 6,
        background: v2.colors.bgWhite,
        border: `1px solid ${v2.colors.border}`,
        borderRadius: 24,
        padding: '4px 6px 4px 14px',
        minHeight: 34,
      }}>
        <textarea
          autoFocus={autoFocus}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
          rows={1}
          style={{
            flex: 1,
            border: 'none', outline: 'none', resize: 'none',
            fontFamily: 'inherit', fontSize: 15, color: v2.colors.text,
            background: 'transparent',
            padding: '6px 0',
            maxHeight: 120,
            overflow: 'auto',
          }}
        />
        <button
          type="button"
          onClick={() => { void handleSend(); }}
          disabled={!canSend}
          title="Send"
          style={{
            width: 28, height: 28, borderRadius: '50%',
            background: canSend ? '#007AFF' : v2.colors.border,
            color: '#fff', border: 'none',
            cursor: canSend ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            transition: 'background 0.15s',
          }}
        >
          <ArrowUp size={16} strokeWidth={3} />
        </button>
      </div>
    </div>
  );
}
