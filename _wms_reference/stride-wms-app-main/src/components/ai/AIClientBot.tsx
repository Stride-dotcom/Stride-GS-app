import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import { useClientPortalContext } from '@/hooks/useClientPortal';
import { useToast } from '@/hooks/use-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface UIContext {
  route?: string;
  selected_item_ids?: string[];
}

export function AIClientBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { profile, session } = useAuth();
  const { portalUser, isClientPortalUser } = useClientPortalContext();
  const { toast } = useToast();
  const location = useLocation();

  // Dragging state
  const [position, setPosition] = useState({ x: 24, y: 24 }); // bottom-right default
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);

  // Get current UI context for the chatbot
  const getUIContext = useCallback((): UIContext => {
    return {
      route: location.pathname,
      // selected_item_ids could be passed via a context or URL params
      // For now, we'll extract from URL if available
      selected_item_ids: undefined,
    };
  }, [location.pathname]);

  const handleDragStart = (e: React.TouchEvent | React.MouseEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    dragRef.current = {
      startX: clientX,
      startY: clientY,
      startPosX: position.x,
      startPosY: position.y,
    };
    setIsDragging(true);
  };

  const handleDragMove = useCallback((e: TouchEvent | MouseEvent) => {
    if (!isDragging || !dragRef.current) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const deltaX = dragRef.current.startX - clientX;
    const deltaY = dragRef.current.startY - clientY;

    setPosition({
      x: Math.max(8, Math.min(window.innerWidth - 48, dragRef.current.startPosX + deltaX)),
      y: Math.max(8, Math.min(window.innerHeight - 48, dragRef.current.startPosY + deltaY)),
    });
  }, [isDragging]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    dragRef.current = null;
  }, []);

  // Add global event listeners for drag
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove);
      window.addEventListener('touchend', handleDragEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleDragMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/client-chat`;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;
    if (!session?.access_token) {
      toast({ title: "Not authenticated", description: "Please log in to use the chat assistant.", variant: "destructive" });
      return;
    }

    const userContent = input.trim();

    const userMessage: Message = {
      role: 'user',
      content: userContent,
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    let assistantContent = '';

    try {
      // Build conversation history for context
      const conversationHistory = messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      // Get UI context
      const uiContext = getUIContext();

      const response = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          message: userMessage.content,
          // Use client portal context if available, otherwise fall back to profile
          tenantId: isClientPortalUser ? portalUser?.tenant_id : profile?.tenant_id,
          accountId: isClientPortalUser ? portalUser?.account_id : undefined,
          uiContext,
          conversationHistory,
        }),
      });

      if (response.status === 429) {
        toast({
          title: 'Rate Limited',
          description: 'Too many requests. Please try again later.',
          variant: 'destructive',
        });
        setIsLoading(false);
        return;
      }

      if (response.status === 402) {
        toast({
          title: 'Payment Required',
          description: 'AI credits have been exhausted.',
          variant: 'destructive',
        });
        setIsLoading(false);
        return;
      }

      if (!response.ok || !response.body) {
        throw new Error('Failed to get response');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';

      // Add initial assistant message
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantContent += content;
              setMessages(prev => {
                const newMessages = [...prev];
                const lastIdx = newMessages.length - 1;
                if (newMessages[lastIdx]?.role === 'assistant') {
                  newMessages[lastIdx] = { ...newMessages[lastIdx], content: assistantContent };
                }
                return newMessages;
              });
            }
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // Final update
      if (assistantContent) {
        setMessages(prev => {
          const newMessages = [...prev];
          const lastIdx = newMessages.length - 1;
          if (newMessages[lastIdx]?.role === 'assistant') {
            newMessages[lastIdx] = {
              ...newMessages[lastIdx],
              content: assistantContent,
            };
          }
          return newMessages;
        });
      }
    } catch (error) {
      console.error('Chat error:', error);
      toast({
        title: 'Error',
        description: 'Failed to get response. Please try again.',
        variant: 'destructive',
      });
      // Remove the empty assistant message if there was an error
      setMessages(prev => prev.filter((m, i) => !(i === prev.length - 1 && m.role === 'assistant' && !m.content)));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Clear conversation
  const clearConversation = () => {
    setMessages([]);
  };

  // Render message content with markdown-like formatting
  const renderMessageContent = (message: Message) => {
    if (!message.content) {
      return isLoading ? <MaterialIcon name="progress_activity" size="sm" className="animate-spin" /> : null;
    }

    // Simple markdown rendering for bold text and lists
    const content = message.content;
    const lines = content.split('\n');

    return (
      <div className="whitespace-pre-wrap">
        {lines.map((line, idx) => {
          // Bold text: **text**
          const boldRegex = /\*\*(.*?)\*\*/g;
          const parts: (string | JSX.Element)[] = [];
          let lastIndex = 0;
          let match;

          while ((match = boldRegex.exec(line)) !== null) {
            if (match.index > lastIndex) {
              parts.push(line.slice(lastIndex, match.index));
            }
            parts.push(<strong key={`bold-${idx}-${match.index}`}>{match[1]}</strong>);
            lastIndex = match.index + match[0].length;
          }

          if (lastIndex < line.length) {
            parts.push(line.slice(lastIndex));
          }

          // Check if it's a list item
          const isListItem = line.trim().startsWith('- ') || line.trim().startsWith('• ');
          const listContent = isListItem ? line.replace(/^[\s]*[-•]\s*/, '') : null;

          if (isListItem && listContent) {
            return (
              <div key={idx} className="flex items-start gap-1">
                <span className="text-muted-foreground">•</span>
                <span>{listContent}</span>
              </div>
            );
          }

          // Check if it's a numbered item
          const numberedMatch = line.trim().match(/^(\d+)\.\s+(.*)/);
          if (numberedMatch) {
            return (
              <div key={idx} className="flex items-start gap-2">
                <span className="font-medium min-w-[1.5rem]">{numberedMatch[1]}.</span>
                <span>{numberedMatch[2]}</span>
              </div>
            );
          }

          return (
            <div key={idx}>
              {parts.length > 0 ? parts : line}
              {idx < lines.length - 1 && <br />}
            </div>
          );
        })}
      </div>
    );
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => !isDragging && setIsOpen(true)}
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
        className={`fixed h-14 w-14 rounded-full flex items-center justify-center z-50 backdrop-blur-xl bg-white/70 dark:bg-black/50 border border-white/30 dark:border-white/10 text-primary shadow-[0_8px_32px_rgba(0,0,0,0.12)] ${
          isDragging ? 'shadow-2xl scale-110 cursor-grabbing' : 'hover:shadow-xl hover:scale-105 cursor-grab'
        }`}
        style={{
          right: position.x,
          bottom: position.y,
          transition: isDragging ? 'none' : 'box-shadow 0.2s, transform 0.2s',
          animation: isDragging ? 'none' : 'fab-spring-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        }}
      >
        <MaterialIcon name="smart_toy" size="md" />
      </button>
    );
  }

  if (isMinimized) {
    return (
      <Card className="fixed bottom-3 left-3 right-3 sm:bottom-6 sm:left-auto sm:right-6 sm:w-72 shadow-lg z-50">
        <CardHeader className="p-3 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <MaterialIcon name="smart_toy" size="md" className="text-primary" />
            <CardTitle className="text-sm">Stride Helper</CardTitle>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsMinimized(false)}>
              <MaterialIcon name="open_in_full" size="sm" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsOpen(false)}>
              <MaterialIcon name="close" size="sm" />
            </Button>
          </div>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="fixed inset-2 sm:inset-auto sm:bottom-6 sm:right-6 sm:w-96 sm:h-[520px] shadow-lg z-50 flex flex-col">
      <CardHeader className="p-3 border-b flex flex-row items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <MaterialIcon name="smart_toy" size="md" className="text-primary" />
          <div>
            <CardTitle className="text-sm">Stride Helper</CardTitle>
            <p className="text-xs text-muted-foreground">Your friendly warehouse assistant</p>
          </div>
        </div>
        <div className="flex gap-1">
          {messages.length > 0 && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearConversation} title="Clear chat">
              <MaterialIcon name="delete_sweep" size="sm" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsMinimized(true)}>
            <MaterialIcon name="minimize" size="sm" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsOpen(false)}>
            <MaterialIcon name="close" size="sm" />
          </Button>
        </div>
      </CardHeader>

      <ScrollArea ref={scrollRef} className="flex-1 p-4">
        {messages.length === 0 ? (
          <div className="text-center text-muted-foreground py-6">
            <MaterialIcon name="waving_hand" className="mx-auto mb-3 text-primary" style={{ fontSize: '40px' }} />
            <p className="text-sm font-medium text-foreground mb-2">Hi there! I'm here to help.</p>
            <p className="text-xs mb-4">Here are some things I can do:</p>
            <div className="text-left space-y-2 text-xs bg-muted/50 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <MaterialIcon name="local_shipping" size="sm" className="text-primary mt-0.5" />
                <span>"Did I get a Jones sofa yet?"</span>
              </div>
              <div className="flex items-start gap-2">
                <MaterialIcon name="inventory_2" size="sm" className="text-primary mt-0.5" />
                <span>"Create a will call for my dining table"</span>
              </div>
              <div className="flex items-start gap-2">
                <MaterialIcon name="build" size="sm" className="text-primary mt-0.5" />
                <span>"Request a repair quote for the blue sofa"</span>
              </div>
              <div className="flex items-start gap-2">
                <MaterialIcon name="swap_horiz" size="sm" className="text-primary mt-0.5" />
                <span>"Move items from Job A to Job B"</span>
              </div>
              <div className="flex items-start gap-2">
                <MaterialIcon name="description" size="sm" className="text-primary mt-0.5" />
                <span>"Show inspection reports"</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div
                  className={`p-2 rounded-full shrink-0 ${
                    msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <MaterialIcon name="person" size="sm" />
                  ) : (
                    <MaterialIcon name="smart_toy" size="sm" />
                  )}
                </div>
                <div
                  className={`rounded-lg p-3 max-w-[80%] text-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}
                >
                  {renderMessageContent(msg)}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <CardContent className="p-3 border-t shrink-0">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Ask me anything..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button onClick={sendMessage} disabled={isLoading || !input.trim()} size="icon">
            {isLoading ? (
              <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
            ) : (
              <MaterialIcon name="send" size="sm" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
