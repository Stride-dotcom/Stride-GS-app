import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: string;
  isSent: boolean;
  senderName?: string;
  timestamp: string;
  showAvatar?: boolean;
  isExternal?: boolean;
  readLabel?: string;
}

const avatarColors = [
  'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-pink-500',
  'bg-indigo-500', 'bg-teal-500', 'bg-orange-500', 'bg-cyan-500',
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function useIsDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function MessageBubble({
  message,
  isSent,
  senderName,
  timestamp,
  showAvatar,
  isExternal,
  readLabel,
}: MessageBubbleProps) {
  const initial = senderName ? senderName.charAt(0).toUpperCase() : '?';
  const isDark = useIsDark();

  const sentStyle: React.CSSProperties = {
    borderRadius: '18px 18px 4px 18px',
    padding: '10px 14px',
    background: 'linear-gradient(180deg, #45B0FF 0%, #007AFF 30%, #0066CC 100%)',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.20)',
  };

  const receivedStyle: React.CSSProperties = {
    borderRadius: '18px 18px 18px 4px',
    padding: '10px 14px',
    background: isExternal
      ? 'linear-gradient(180deg, #5AD175 0%, #34C759 60%, #2EB34D 100%)'
      : isDark
        ? 'linear-gradient(180deg, #3E3E42 0%, #303034 100%)'
        : 'linear-gradient(180deg, #F0F0F5 0%, #E5E5EA 100%)',
    boxShadow: isDark
      ? 'inset 0 1px 0 rgba(255, 255, 255, 0.06)'
      : 'inset 0 1px 0 rgba(255, 255, 255, 0.60)',
  };

  return (
    <div className={cn('flex flex-col gap-1', isSent ? 'items-end' : 'items-start')}>
      {/* Sender name for received messages */}
      {!isSent && senderName && (
        <span className="text-xs text-muted-foreground ml-11 mb-0.5">{senderName}</span>
      )}

      <div className={cn('flex items-end gap-2', isSent ? 'flex-row-reverse' : 'flex-row')}>
        {/* Avatar for received messages */}
        {!isSent && showAvatar ? (
          <Avatar className="h-8 w-8 shadow-sm shrink-0">
            <AvatarFallback className={cn('text-xs text-white font-medium', getAvatarColor(senderName || ''))}>
              {initial}
            </AvatarFallback>
          </Avatar>
        ) : !isSent ? (
          <div className="w-8 shrink-0" />
        ) : null}

        {/* Bubble */}
        <div
          className="max-w-[75%] whitespace-pre-wrap break-words"
          style={isSent ? sentStyle : receivedStyle}
        >
          <p
            className={cn(
              'text-sm leading-relaxed',
              isSent || isExternal ? 'text-white' : 'text-black dark:text-white'
            )}
          >
            {message}
          </p>
        </div>
      </div>

      {/* Timestamp */}
      <span className={cn('text-[11px] text-muted-foreground', isSent ? 'mr-1' : 'ml-11')}>
        {timestamp}
      </span>
      {isSent && readLabel && (
        <span className="text-[11px] text-muted-foreground mr-1">
          {readLabel}
        </span>
      )}
    </div>
  );
}
