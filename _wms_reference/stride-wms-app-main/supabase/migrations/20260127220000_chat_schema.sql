-- ============================================================
-- Chat Conversations and Messages Schema
-- Supports AI chatbot with entity recognition and deep linking
-- ============================================================

-- Chat conversations table
CREATE TABLE IF NOT EXISTS chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT DEFAULT 'New Chat',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES chat_conversations(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  entity_map JSONB DEFAULT '{}',
  tool_calls JSONB,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_chat_conversations_user ON chat_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_tenant ON chat_conversations(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);

-- Entity number indexes for fast lookups (if columns exist)
DO $$
BEGIN
  -- Tasks
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'task_number') THEN
    CREATE INDEX IF NOT EXISTS idx_tasks_task_number ON tasks(task_number);
  END IF;

  -- Shipments
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shipments' AND column_name = 'shipment_number') THEN
    CREATE INDEX IF NOT EXISTS idx_shipments_shipment_number ON shipments(shipment_number);
  END IF;

  -- Repair quotes
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'repair_quotes' AND column_name = 'quote_number') THEN
    CREATE INDEX IF NOT EXISTS idx_repair_quotes_quote_number ON repair_quotes(quote_number);
  END IF;

  -- Items
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'item_number') THEN
    CREATE INDEX IF NOT EXISTS idx_items_item_number ON items(item_number);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'sku') THEN
    CREATE INDEX IF NOT EXISTS idx_items_sku ON items(sku);
  END IF;

  -- Quotes
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'quotes' AND column_name = 'quote_number') THEN
    CREATE INDEX IF NOT EXISTS idx_quotes_quote_number_lookup ON quotes(quote_number);
  END IF;

  -- Invoices
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'invoice_number') THEN
    CREATE INDEX IF NOT EXISTS idx_invoices_invoice_number ON invoices(invoice_number);
  END IF;

  -- Accounts
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = 'account_code') THEN
    CREATE INDEX IF NOT EXISTS idx_accounts_account_code ON accounts(account_code);
  END IF;

  -- Work orders
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'work_orders' AND column_name = 'work_order_number') THEN
    CREATE INDEX IF NOT EXISTS idx_work_orders_work_order_number ON work_orders(work_order_number);
  END IF;
END $$;

-- Enable Row Level Security
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for chat_conversations
DROP POLICY IF EXISTS "Users can view own conversations" ON chat_conversations;
CREATE POLICY "Users can view own conversations"
  ON chat_conversations
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own conversations" ON chat_conversations;
CREATE POLICY "Users can create own conversations"
  ON chat_conversations
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own conversations" ON chat_conversations;
CREATE POLICY "Users can update own conversations"
  ON chat_conversations
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own conversations" ON chat_conversations;
CREATE POLICY "Users can delete own conversations"
  ON chat_conversations
  FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for chat_messages
DROP POLICY IF EXISTS "Users can view messages in own conversations" ON chat_messages;
CREATE POLICY "Users can view messages in own conversations"
  ON chat_messages
  FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM chat_conversations WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can create messages in own conversations" ON chat_messages;
CREATE POLICY "Users can create messages in own conversations"
  ON chat_messages
  FOR INSERT
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM chat_conversations WHERE user_id = auth.uid()
    )
  );

-- Function to auto-update conversation updated_at
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE chat_conversations
  SET updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update conversation timestamp on new message
DROP TRIGGER IF EXISTS chat_message_timestamp_trigger ON chat_messages;
CREATE TRIGGER chat_message_timestamp_trigger
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_timestamp();

-- Function to auto-generate conversation title from first message
CREATE OR REPLACE FUNCTION set_conversation_title()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role = 'user' THEN
    UPDATE chat_conversations
    SET title = LEFT(NEW.content, 50) || CASE WHEN LENGTH(NEW.content) > 50 THEN '...' ELSE '' END
    WHERE id = NEW.conversation_id
    AND title = 'New Chat';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to set conversation title from first user message
DROP TRIGGER IF EXISTS set_conversation_title_trigger ON chat_messages;
CREATE TRIGGER set_conversation_title_trigger
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION set_conversation_title();
