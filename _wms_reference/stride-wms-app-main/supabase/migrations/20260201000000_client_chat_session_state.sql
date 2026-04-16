-- ============================================================
-- Client Chat Session State for Disambiguation
-- Supports stateful disambiguation in client chatbot
-- ============================================================

-- Client chat session state table
-- Stores pending disambiguation options and draft actions
CREATE TABLE IF NOT EXISTS client_chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Disambiguation state
  pending_disambiguation JSONB DEFAULT NULL,
  -- Structure: { type: 'items'|'subaccounts', candidates: [...], original_query: string }

  -- Draft action state
  pending_draft JSONB DEFAULT NULL,
  -- Structure: { type: 'will_call'|'repair_quote'|'reallocation', draft_id: uuid, summary: string, ... }

  -- Context
  last_route TEXT,
  last_selected_items TEXT[], -- array of item IDs

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 hour')
);

-- Draft will call orders (before confirmation)
CREATE TABLE IF NOT EXISTS client_chat_will_call_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE NOT NULL,
  subaccount_id UUID REFERENCES sidemarks(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Draft data
  item_ids UUID[] NOT NULL,
  release_type TEXT NOT NULL CHECK (release_type IN ('customer', 'third_party_carrier', 'stride_delivery')),
  released_to_name TEXT NOT NULL,
  notes TEXT,

  -- Status
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled', 'expired')),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 minutes')
);

-- Draft repair quote requests (before confirmation)
CREATE TABLE IF NOT EXISTS client_chat_repair_quote_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE NOT NULL,
  subaccount_id UUID REFERENCES sidemarks(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Draft data
  item_ids UUID[] NOT NULL,
  notes TEXT,

  -- Status
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled', 'expired')),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 minutes')
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_client_chat_sessions_user ON client_chat_sessions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_chat_sessions_lookup ON client_chat_sessions(tenant_id, account_id, user_id);
CREATE INDEX IF NOT EXISTS idx_client_chat_sessions_expires ON client_chat_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_will_call_drafts_user ON client_chat_will_call_drafts(created_by, status);
CREATE INDEX IF NOT EXISTS idx_will_call_drafts_expires ON client_chat_will_call_drafts(expires_at) WHERE status = 'draft';

CREATE INDEX IF NOT EXISTS idx_repair_quote_drafts_user ON client_chat_repair_quote_drafts(created_by, status);
CREATE INDEX IF NOT EXISTS idx_repair_quote_drafts_expires ON client_chat_repair_quote_drafts(expires_at) WHERE status = 'draft';

-- Enable Row Level Security
ALTER TABLE client_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_chat_will_call_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_chat_repair_quote_drafts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for client_chat_sessions
DROP POLICY IF EXISTS "Users can view own chat sessions" ON client_chat_sessions;
CREATE POLICY "Users can view own chat sessions"
  ON client_chat_sessions
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own chat sessions" ON client_chat_sessions;
CREATE POLICY "Users can manage own chat sessions"
  ON client_chat_sessions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for will_call_drafts
DROP POLICY IF EXISTS "Users can view own will call drafts" ON client_chat_will_call_drafts;
CREATE POLICY "Users can view own will call drafts"
  ON client_chat_will_call_drafts
  FOR SELECT
  USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can manage own will call drafts" ON client_chat_will_call_drafts;
CREATE POLICY "Users can manage own will call drafts"
  ON client_chat_will_call_drafts
  FOR ALL
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- RLS Policies for repair_quote_drafts
DROP POLICY IF EXISTS "Users can view own repair quote drafts" ON client_chat_repair_quote_drafts;
CREATE POLICY "Users can view own repair quote drafts"
  ON client_chat_repair_quote_drafts
  FOR SELECT
  USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Users can manage own repair quote drafts" ON client_chat_repair_quote_drafts;
CREATE POLICY "Users can manage own repair quote drafts"
  ON client_chat_repair_quote_drafts
  FOR ALL
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- Function to update session timestamp
CREATE OR REPLACE FUNCTION update_client_chat_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  NEW.expires_at = NOW() + INTERVAL '1 hour';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS client_chat_session_timestamp_trigger ON client_chat_sessions;
CREATE TRIGGER client_chat_session_timestamp_trigger
  BEFORE UPDATE ON client_chat_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_client_chat_session_timestamp();

-- Function to clean up expired sessions and drafts
CREATE OR REPLACE FUNCTION cleanup_expired_client_chat_data()
RETURNS void AS $$
BEGIN
  -- Delete expired sessions
  DELETE FROM client_chat_sessions WHERE expires_at < NOW();

  -- Mark expired drafts
  UPDATE client_chat_will_call_drafts
  SET status = 'expired'
  WHERE status = 'draft' AND expires_at < NOW();

  UPDATE client_chat_repair_quote_drafts
  SET status = 'expired'
  WHERE status = 'draft' AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql;
