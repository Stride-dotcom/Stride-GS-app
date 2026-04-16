import { useState, useCallback, useEffect } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface MessageInputBarProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  isSms?: boolean;
  onTypingChange?: (isTyping: boolean) => void;
}

export function MessageInputBar({ onSend, disabled, isSms, onTypingChange }: MessageInputBarProps) {
  const [text, setText] = useState('');
  const [wasTyping, setWasTyping] = useState(false);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
    onTypingChange?.(false);
    setWasTyping(false);
  }, [text, onSend, onTypingChange]);

  useEffect(() => {
    if (!onTypingChange) return;
    const isTyping = text.trim().length > 0;
    if (isTyping !== wasTyping) {
      onTypingChange(isTyping);
      setWasTyping(isTyping);
    }
  }, [text, wasTyping, onTypingChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasText = text.trim().length > 0;

  return (
    <div className="border-t bg-background px-4 py-2 pb-safe">
      <div className="flex items-center gap-2">
        {/* Plus button placeholder */}
        <button
          className="flex items-center justify-center h-9 w-9 rounded-full bg-muted text-muted-foreground hover:bg-muted/80 transition-colors shrink-0"
          aria-label="Add attachment"
          type="button"
        >
          <MaterialIcon name="add" size="md" />
        </button>

        {/* Input field */}
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isSms ? 'SMS Reply...' : 'Message...'}
          autoCapitalize="sentences"
          disabled={disabled}
          className="flex-1 h-9 rounded-[24px] border border-input bg-background px-4 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
        />

        {/* Send button - green for SMS, blue for in-app */}
        <button
          onClick={handleSend}
          disabled={!hasText || disabled}
          className="flex items-center justify-center h-9 w-9 rounded-full shrink-0 transition-colors"
          style={{
            backgroundColor: hasText
              ? (isSms ? '#34C759' : '#007AFF')
              : '#8e8e93',
            opacity: hasText ? 1 : 0.6,
          }}
          aria-label={isSms ? 'Send SMS' : 'Send message'}
          type="button"
        >
          <MaterialIcon name="arrow_upward" size="sm" className="text-white" />
        </button>
      </div>
    </div>
  );
}
