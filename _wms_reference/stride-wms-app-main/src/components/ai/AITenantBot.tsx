import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  suggestions?: string[];
}

interface UIContext {
  route?: string;
  selected_item_ids?: string[];
  selected_shipment_id?: string;
  selected_task_id?: string;
  selected_account_id?: string;
}

// Entity link patterns for clickable references
const ENTITY_PATTERNS = {
  // Format: "ITM-12345 [id:uuid]" or just "ITM-12345"
  item: /ITM-\d+(?:\s*\[id:([a-f0-9-]+)\])?/gi,
  shipment: /(?:SHP|MAN|EXP|INT|OUT)-\d{5,6}(?:\s*\[id:([a-f0-9-]+)\])?/gi,
  task: /TSK-\d+(?:\s*\[id:([a-f0-9-]+)\])?/gi,
  stocktake: /STK-\d+(?:\s*\[id:([a-f0-9-]+)\])?/gi,
};

export function AITenantBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { profile, session } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  // Dragging state
  const [position, setPosition] = useState({ x: 24, y: 24 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);

  const getUIContext = useCallback((): UIContext => {
    const path = location.pathname;
    const params = new URLSearchParams(location.search);

    return {
      route: path,
      // Extract entity context from URL
      selected_shipment_id: path.includes('/shipments/')
        ? path.split('/shipments/')[1]?.split('/')[0]
        : params.get('shipment') || undefined,
      selected_item_ids: params.get('item') ? [params.get('item')!] : undefined,
      selected_task_id: path.includes('/tasks/')
        ? path.split('/tasks/')[1]?.split('/')[0]
        : params.get('task') || undefined,
      selected_account_id: params.get('account') || undefined,
    };
  }, [location.pathname, location.search]);

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

  const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tenant-chat`;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;
    if (!session?.access_token) {
      toast({ title: "Not authenticated", description: "Please log in to use the assistant.", variant: "destructive" });
      return;
    }

    const userContent = input.trim();
    const userMessage: Message = { role: 'user', content: userContent };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    let assistantContent = '';

    try {
      const conversationHistory = messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const uiContext = getUIContext();

      const response = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          message: userMessage.content,
          tenantId: profile?.tenant_id,
          uiContext,
          conversationHistory,
        }),
      });

      if (response.status === 429) {
        toast({
          title: 'Rate Limited',
          description: 'Too many requests. Try again shortly.',
          variant: 'destructive',
        });
        setIsLoading(false);
        return;
      }

      if (response.status === 402) {
        toast({
          title: 'Payment Required',
          description: 'AI credits exhausted.',
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

      if (assistantContent) {
        setMessages(prev => {
          const newMessages = [...prev];
          const lastIdx = newMessages.length - 1;
          if (newMessages[lastIdx]?.role === 'assistant') {
            newMessages[lastIdx] = { ...newMessages[lastIdx], content: assistantContent };
          }
          return newMessages;
        });
      }
    } catch (error) {
      console.error('Chat error:', error);
      toast({
        title: 'Error',
        description: 'Failed to get response. Try again.',
        variant: 'destructive',
      });
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

  const clearConversation = () => {
    setMessages([]);
  };

  // Handle entity link clicks
  const handleEntityClick = (type: string, id: string | null, displayNumber: string) => {
    if (!id) {
      // If no UUID provided, just search for the entity
      setInput(`Where is ${displayNumber}?`);
      return;
    }

    // Navigate to the appropriate page based on entity type
    switch (type) {
      case 'item':
        navigate(`/inventory?item=${id}`);
        break;
      case 'shipment':
        navigate(`/shipments?id=${id}`);
        break;
      case 'task':
        navigate(`/tasks?id=${id}`);
        break;
      case 'stocktake':
        navigate(`/stocktakes?id=${id}`);
        break;
    }
    setIsMinimized(true);
  };

  // Parse text and replace entity references with clickable elements
  const parseEntityLinks = (text: string, keyPrefix: string): (string | JSX.Element)[] => {
    const result: (string | JSX.Element)[] = [];
    let lastIndex = 0;

    // Combined regex for all entity types
    const combinedRegex = /(ITM-\d+|(?:SHP|MAN|EXP|INT|OUT)-\d{5,6}|TSK-\d+|STK-\d+)(?:\s*\[id:([a-f0-9-]+)\])?/gi;
    let match;

    while ((match = combinedRegex.exec(text)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        result.push(text.slice(lastIndex, match.index));
      }

      const displayNumber = match[1];
      const uuid = match[2] || null;
      const prefix = displayNumber.substring(0, 3).toUpperCase();

      let type: string;
      switch (prefix) {
        case 'ITM': type = 'item'; break;
        case 'SHP':
        case 'MAN':
        case 'EXP':
        case 'INT':
        case 'OUT':
          type = 'shipment';
          break;
        case 'TSK': type = 'task'; break;
        case 'STK': type = 'stocktake'; break;
        default: type = 'item';
      }

      result.push(
        <button
          key={`${keyPrefix}-entity-${match.index}`}
          onClick={() => handleEntityClick(type, uuid, displayNumber)}
          className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer font-semibold"
          title={uuid ? `Click to view ${displayNumber}` : `Search for ${displayNumber}`}
        >
          {displayNumber}
        </button>
      );

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      result.push(text.slice(lastIndex));
    }

    return result.length > 0 ? result : [text];
  };

  // Generate context-aware suggestions based on message content
  const generateSuggestions = (content: string): string[] => {
    const suggestions: string[] = [];
    const contentLower = content.toLowerCase();

    // Detect shipment mentions and suggest related actions
    if (contentLower.includes('shipment') || /(?:SHP|MAN|EXP|INT|OUT)-\d{5,6}/i.test(content)) {
      if (contentLower.includes('inbound') || contentLower.includes('received')) {
        suggestions.push('Create inspections for all items');
        suggestions.push('Move items to receiving');
      }
      if (contentLower.includes('outbound')) {
        suggestions.push('Validate outbound');
        suggestions.push('Check blockers');
      }
      suggestions.push('Show shipment items');
    }

    // Detect item mentions and suggest related actions
    if (/ITM-\d+/i.test(content)) {
      suggestions.push('Move this item');
      suggestions.push('Show movement history');
      suggestions.push('Add a note');
    }

    // Detect task mentions
    if (/TSK-\d+/i.test(content) || contentLower.includes('task')) {
      suggestions.push('Mark task complete');
      suggestions.push('Show task details');
    }

    // Detect stocktake mentions
    if (/STK-\d+/i.test(content) || contentLower.includes('stocktake')) {
      suggestions.push('Validate completion');
      suggestions.push('Show variances');
    }

    // Detect account mentions
    if (contentLower.includes('account') || contentLower.includes('client')) {
      suggestions.push('Show account summary');
      suggestions.push('View open tasks');
    }

    // If showing warehouse stats
    if (contentLower.includes('warehouse') || contentLower.includes('snapshot')) {
      suggestions.push('Show recent activity');
      suggestions.push('View pending outbound');
    }

    return suggestions.slice(0, 3); // Limit to 3 suggestions
  };

  // Handle suggestion click
  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
  };

  const renderMessageContent = (message: Message) => {
    if (!message.content) {
      return isLoading ? <MaterialIcon name="progress_activity" size="sm" className="animate-spin" /> : null;
    }

    const content = message.content;
    const lines = content.split('\n');

    return (
      <div className="whitespace-pre-wrap font-mono text-xs">
        {lines.map((line, idx) => {
          // First, parse entity links
          const withEntityLinks = parseEntityLinks(line, `line-${idx}`);

          // Then process bold text within each text segment
          const processedParts: (string | JSX.Element)[] = [];
          withEntityLinks.forEach((part, partIdx) => {
            if (typeof part === 'string') {
              // Process bold text
              const boldRegex = /\*\*(.*?)\*\*/g;
              let lastBoldIndex = 0;
              let boldMatch;

              while ((boldMatch = boldRegex.exec(part)) !== null) {
                if (boldMatch.index > lastBoldIndex) {
                  processedParts.push(part.slice(lastBoldIndex, boldMatch.index));
                }
                processedParts.push(
                  <strong key={`bold-${idx}-${partIdx}-${boldMatch.index}`}>{boldMatch[1]}</strong>
                );
                lastBoldIndex = boldMatch.index + boldMatch[0].length;
              }

              if (lastBoldIndex < part.length) {
                processedParts.push(part.slice(lastBoldIndex));
              }
            } else {
              processedParts.push(part);
            }
          });

          // List items
          const isListItem = line.trim().startsWith('- ') || line.trim().startsWith('* ');
          if (isListItem) {
            return (
              <div key={idx} className="flex items-start gap-1 pl-2">
                <span className="text-muted-foreground">-</span>
                <span>{processedParts.slice(1)}</span>
              </div>
            );
          }

          // Numbered items
          const numberedMatch = line.trim().match(/^(\d+)\.\s+(.*)/);
          if (numberedMatch) {
            return (
              <div key={idx} className="flex items-start gap-2 pl-2">
                <span className="text-muted-foreground min-w-[1.25rem]">{numberedMatch[1]}.</span>
                <span>{processedParts}</span>
              </div>
            );
          }

          return (
            <div key={idx}>
              {processedParts.length > 0 ? processedParts : line}
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
        className={`fixed h-12 w-12 rounded-full bg-slate-800 text-white shadow-lg flex items-center justify-center z-50 transition-shadow duration-200 ${
          isDragging ? 'shadow-2xl scale-110 cursor-grabbing' : 'hover:shadow-xl hover:bg-slate-700 cursor-grab'
        }`}
        style={{
          right: position.x,
          bottom: position.y,
          transition: isDragging ? 'none' : 'box-shadow 0.2s, transform 0.2s',
        }}
        title="Stride Ops Assistant"
      >
        <MaterialIcon name="terminal" size="md" />
      </button>
    );
  }

  if (isMinimized) {
    return (
      <Card className="fixed bottom-3 left-3 right-3 sm:bottom-6 sm:left-auto sm:right-6 sm:w-72 shadow-lg z-50 bg-slate-900 border-slate-700">
        <CardHeader className="p-3 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <MaterialIcon name="terminal" size="md" className="text-green-400" />
            <CardTitle className="text-sm text-slate-100">Ops Assistant</CardTitle>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-white" onClick={() => setIsMinimized(false)}>
              <MaterialIcon name="open_in_full" size="sm" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-white" onClick={() => setIsOpen(false)}>
              <MaterialIcon name="close" size="sm" />
            </Button>
          </div>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="fixed inset-2 sm:inset-auto sm:bottom-6 sm:right-6 sm:w-[420px] sm:h-[560px] shadow-lg z-50 flex flex-col bg-slate-900 border-slate-700">
      <CardHeader className="p-3 border-b border-slate-700 flex flex-row items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <MaterialIcon name="terminal" size="md" className="text-green-400" />
          <div>
            <CardTitle className="text-sm text-slate-100">Ops Assistant</CardTitle>
            <p className="text-xs text-slate-400">Warehouse operations</p>
          </div>
        </div>
        <div className="flex gap-1">
          {messages.length > 0 && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-white" onClick={clearConversation} title="Clear">
              <MaterialIcon name="delete_sweep" size="sm" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-white" onClick={() => setIsMinimized(true)}>
            <MaterialIcon name="minimize" size="sm" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-white" onClick={() => setIsOpen(false)}>
            <MaterialIcon name="close" size="sm" />
          </Button>
        </div>
      </CardHeader>

      <ScrollArea ref={scrollRef} className="flex-1 p-4 bg-slate-950">
        {messages.length === 0 ? (
          <div className="text-slate-400 py-6">
            <p className="text-sm font-medium text-slate-200 mb-3">Stride Ops Assistant</p>
            <p className="text-xs mb-4">Search inventory, manage tasks, validate shipments.</p>
            <div className="space-y-2 text-xs font-mono bg-slate-900/50 rounded p-3 border border-slate-800">
              <p className="text-slate-500"># Examples</p>
              <p><span className="text-green-400">$</span> Where is item 12345?</p>
              <p><span className="text-green-400">$</span> What's in shipment 45678?</p>
              <p><span className="text-green-400">$</span> Create inspections for shipment SHP-99110</p>
              <p><span className="text-green-400">$</span> Move item 3435678 to B1-04</p>
              <p><span className="text-green-400">$</span> What's blocking outbound SHP-78901?</p>
              <p><span className="text-green-400">$</span> Who moved item 998877 last?</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, idx) => {
              const isLastAssistant = msg.role === 'assistant' && idx === messages.length - 1;
              const suggestions = isLastAssistant && !isLoading ? generateSuggestions(msg.content) : [];

              return (
                <div key={idx}>
                  <div className={`flex items-start gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`p-1.5 rounded shrink-0 ${
                      msg.role === 'user' ? 'bg-blue-600' : 'bg-slate-700'
                    }`}>
                      {msg.role === 'user' ? (
                        <MaterialIcon name="person" size="sm" className="text-white" />
                      ) : (
                        <MaterialIcon name="terminal" size="sm" className="text-green-400" />
                      )}
                    </div>
                    <div className={`rounded p-2.5 max-w-[85%] ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-100'
                    }`}>
                      {renderMessageContent(msg)}
                    </div>
                  </div>
                  {/* Suggested actions */}
                  {suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2 ml-9">
                      {suggestions.map((suggestion, sIdx) => (
                        <button
                          key={sIdx}
                          onClick={() => handleSuggestionClick(suggestion)}
                          className="px-2 py-1 text-[10px] font-medium rounded-full bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700 transition-colors"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <CardContent className="p-3 border-t border-slate-700 shrink-0 bg-slate-900">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Search, query, or command..."
            disabled={isLoading}
            className="flex-1 bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500 font-mono text-sm"
          />
          <Button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            size="icon"
            className="bg-green-600 hover:bg-green-500"
          >
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
