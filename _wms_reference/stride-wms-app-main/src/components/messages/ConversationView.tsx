import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';

interface ConversationMessage {
  id: string;
  message_id?: string;
  content: string;
  sender_id: string;
  sender_name: string;
  created_at: string;
  is_sent: boolean;
  is_external?: boolean;
  read_label?: string;
}

interface ConversationViewProps {
  messages: ConversationMessage[];
  currentUserId: string;
  typingText?: string | null;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - messageDay.getTime()) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function getDateKey(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function ConversationView({ messages, currentUserId, typingText }: ConversationViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Group messages by date
  const groupedMessages: { dateLabel: string; messages: ConversationMessage[] }[] = [];
  let currentDateKey = '';

  for (const msg of messages) {
    const dateKey = getDateKey(msg.created_at);
    if (dateKey !== currentDateKey) {
      currentDateKey = dateKey;
      groupedMessages.push({
        dateLabel: formatDateLabel(msg.created_at),
        messages: [msg],
      });
    } else {
      groupedMessages[groupedMessages.length - 1].messages.push(msg);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      {groupedMessages.map((group, groupIdx) => (
        <div key={groupIdx} className="space-y-3">
          {/* Date separator */}
          <div className="flex items-center gap-3 py-2">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground font-medium shrink-0">
              {group.dateLabel}
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Messages in this group */}
          {group.messages.map((msg, msgIdx) => {
            const isSent = msg.sender_id === currentUserId;
            const prevMsg = msgIdx > 0 ? group.messages[msgIdx - 1] : null;
            const showAvatar = !isSent && (!prevMsg || prevMsg.sender_id !== msg.sender_id);

            return (
              <MessageBubble
                key={msg.id}
                message={msg.content}
                isSent={isSent}
                senderName={!isSent ? msg.sender_name : undefined}
                timestamp={formatTime(msg.created_at)}
                showAvatar={showAvatar}
                isExternal={msg.is_external}
                readLabel={msg.read_label}
              />
            );
          })}
        </div>
      ))}

      {typingText && (
        <div className="pl-1">
          <span className="text-xs text-muted-foreground italic">{typingText}</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
