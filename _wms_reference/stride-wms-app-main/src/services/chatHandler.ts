import { supabase } from '@/integrations/supabase/client';
import { extractEntityNumbers } from '@/utils/parseEntityLinks';
import { resolveEntities, buildEntityMap, ResolvedEntity } from '@/services/entityResolver';
import { getChatbotToolsForAnthropic, executeTool } from '@/services/chatbotTools';
import { EntityType } from '@/config/entities';

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
  entityMap?: Record<string, { id: string; type: EntityType; exists: boolean; summary?: string }>;
  toolCalls?: any[];
}

export interface ChatConversation {
  id: string;
  title?: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

// Type-safe helper for chat tables not yet in generated types
const chatDb = supabase as any;

/**
 * Get or create a chat conversation
 */
export async function getOrCreateConversation(
  userId: string,
  conversationId?: string
): Promise<string> {
  if (conversationId) {
    // Verify conversation exists and belongs to user
    const { data } = await chatDb
      .from('chat_conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', userId)
      .single();

    if (data) return data.id;
  }

  // Create new conversation
  const { data, error } = await chatDb
    .from('chat_conversations')
    .insert({
      user_id: userId,
      title: 'New Chat',
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/**
 * Get conversation history
 */
export async function getConversationHistory(
  conversationId: string
): Promise<ChatMessage[]> {
  const { data, error } = await chatDb
    .from('chat_messages')
    .select('id, role, content, entity_map, tool_calls, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) throw error;

  return (data || []).map((msg: any) => ({
    id: msg.id,
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
    timestamp: new Date(msg.created_at),
    entityMap: msg.entity_map as any,
    toolCalls: msg.tool_calls as any,
  }));
}

/**
 * Save a message to the database
 */
export async function saveMessage(params: {
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  entityMap?: Record<string, any>;
  toolCalls?: any[];
  userId?: string;
}): Promise<ChatMessage> {
  const { data, error } = await chatDb
    .from('chat_messages')
    .insert({
      conversation_id: params.conversationId,
      role: params.role,
      content: params.content,
      entity_map: params.entityMap || {},
      tool_calls: params.toolCalls,
      created_by: params.userId,
    })
    .select('id, role, content, entity_map, tool_calls, created_at')
    .single();

  if (error) throw error;

  // Update conversation timestamp
  await chatDb
    .from('chat_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', params.conversationId);

  return {
    id: data.id,
    role: data.role as 'user' | 'assistant' | 'system',
    content: data.content,
    timestamp: new Date(data.created_at),
    entityMap: data.entity_map as any,
    toolCalls: data.tool_calls as any,
  };
}

/**
 * Process a chat message and get AI response
 */
export async function handleChatMessage(params: {
  message: string;
  conversationId: string;
  userId: string;
  tenantId: string;
}): Promise<ChatMessage> {
  const { message, conversationId, userId, tenantId } = params;

  // Get conversation history
  const history = await getConversationHistory(conversationId);

  // Extract entities from user message
  const userEntityNumbers = extractEntityNumbers(message);
  const userEntities = userEntityNumbers.length > 0
    ? await resolveEntities(userEntityNumbers)
    : [];

  // Build context from resolved entities
  const entityContext = userEntities
    .filter((e) => e.exists)
    .map((e) => `${e.number}: ${e.summary}`)
    .join('\n');

  // Save user message with entity map
  await saveMessage({
    conversationId,
    role: 'user',
    content: message,
    entityMap: buildEntityMap(userEntities),
    userId,
  });

  // Build messages for AI
  const aiMessages = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  aiMessages.push({ role: 'user', content: message });

  // Call AI with tools
  const aiResponse = await callAIWithTools({
    messages: aiMessages,
    entityContext,
    tenantId,
  });

  // Extract entities from AI response
  const responseEntityNumbers = extractEntityNumbers(aiResponse.content);
  const allEntityNumbers = [...new Set([...userEntityNumbers, ...responseEntityNumbers])];
  const allEntities = allEntityNumbers.length > 0
    ? await resolveEntities(allEntityNumbers)
    : [];

  // Save and return assistant message
  const savedMessage = await saveMessage({
    conversationId,
    role: 'assistant',
    content: aiResponse.content,
    entityMap: buildEntityMap(allEntities),
    toolCalls: aiResponse.toolCalls,
    userId,
  });

  return savedMessage;
}

/**
 * Call AI service with tool support
 */
async function callAIWithTools(params: {
  messages: { role: string; content: string }[];
  entityContext: string;
  tenantId: string;
}): Promise<{ content: string; toolCalls?: any[] }> {
  const { messages, entityContext } = params;

  // Get tools
  const tools = getChatbotToolsForAnthropic();

  // Build system prompt
  const systemPrompt = buildSystemPrompt(entityContext);

  try {
    // Call edge function for AI processing
    const { data, error } = await supabase.functions.invoke('chat-ai', {
      body: {
        messages,
        systemPrompt,
        tools,
      },
    });

    if (error) {
      console.error('AI call error:', error);
      return {
        content: "I apologize, but I'm having trouble processing your request right now. Please try again.",
      };
    }

    // Handle tool calls if present
    if (data.toolCalls && data.toolCalls.length > 0) {
      const toolResults = await executeToolCalls(data.toolCalls);

      // Make follow-up call with tool results
      const followUpMessages = [
        ...messages,
        { role: 'assistant', content: data.content || '', tool_calls: data.toolCalls },
        ...toolResults.map((result) => ({
          role: 'tool',
          tool_call_id: result.id,
          content: JSON.stringify(result.result),
        })),
      ];

      const followUpResponse = await supabase.functions.invoke('chat-ai', {
        body: {
          messages: followUpMessages,
          systemPrompt,
        },
      });

      if (followUpResponse.error) {
        return { content: data.content || 'I found some information but had trouble formatting it.' };
      }

      return {
        content: followUpResponse.data.content,
        toolCalls: data.toolCalls,
      };
    }

    return {
      content: data.content,
      toolCalls: data.toolCalls,
    };
  } catch (err) {
    console.error('AI call error:', err);
    return {
      content: "I apologize, but I'm having trouble processing your request right now. Please try again.",
    };
  }
}

/**
 * Execute tool calls from AI response
 */
async function executeToolCalls(
  toolCalls: { id: string; name: string; input: any }[]
): Promise<{ id: string; result: any }[]> {
  const results: { id: string; result: any }[] = [];

  for (const call of toolCalls) {
    try {
      const result = await executeTool(call.name, call.input);
      results.push({ id: call.id, result });
    } catch (err) {
      console.error(`Tool call error (${call.name}):`, err);
      results.push({
        id: call.id,
        result: { error: `Failed to execute ${call.name}` },
      });
    }
  }

  return results;
}

/**
 * Build system prompt for the chatbot
 */
function buildSystemPrompt(entityContext: string): string {
  const basePrompt = `You are Stride Assistant, an AI helper for the Stride WMS (Warehouse Management System). You help users find information about tasks, shipments, repair quotes, inventory items, quotes, invoices, accounts, and work orders.

## Entity Lookup Tools
You have access to tools to search for and list entities:
- lookup_task: Search tasks by number (TSK-XXXXX) or keywords
- lookup_shipment: Search shipments by number (SHP/MAN/EXP/INT/OUT-XXXXX), tracking number, or keywords
- lookup_repair_quote: Search repair quotes by number (RPQ-XXXXX) or keywords
- lookup_item: Search items by number (ITM-XXXXX), SKU, or name
- lookup_quote: Search quotes by number (EST-XXXXX) or account name
- list_tasks: List tasks with filters (status, assignee, due date, priority)
- list_shipments: List shipments with filters (status, account, carrier, dates)
- list_quotes: List quotes with filters (status, account, expiration)

## Response Guidelines
1. Always use tools to look up information rather than guessing.
2. Include entity numbers in responses so they become clickable links (e.g., "Task TSK-00142 is assigned to John Smith").
3. Use the full number format (TSK-00142, not "task 142" or just "142").
4. Show related entities when relevant.
5. Handle "not found" gracefully and offer alternatives.
6. Be concise but helpful.
7. If a user asks about something and you don't have enough context, ask clarifying questions.`;

  if (entityContext) {
    return `${basePrompt}

## Entities Referenced in Current Message
${entityContext}`;
  }

  return basePrompt;
}

/**
 * Get user's recent conversations
 */
export async function getUserConversations(
  userId: string,
  limit = 10
): Promise<ChatConversation[]> {
  const { data, error } = await chatDb
    .from('chat_conversations')
    .select('id, title, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data || []).map((conv: any) => ({
    id: conv.id,
    title: conv.title,
    messages: [],
    createdAt: new Date(conv.created_at),
    updatedAt: new Date(conv.updated_at),
  }));
}

/**
 * Update conversation title
 */
export async function updateConversationTitle(
  conversationId: string,
  title: string
): Promise<void> {
  await chatDb
    .from('chat_conversations')
    .update({ title })
    .eq('id', conversationId);
}

/**
 * Delete a conversation
 */
export async function deleteConversation(conversationId: string): Promise<void> {
  await chatDb
    .from('chat_conversations')
    .delete()
    .eq('id', conversationId);
}
