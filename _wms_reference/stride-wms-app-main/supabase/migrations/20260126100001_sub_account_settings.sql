-- Migration: Sub-Account Settings
-- Adds settings for sub-account hierarchy management

-- Add new columns to accounts table for sub-account features
ALTER TABLE public.accounts
ADD COLUMN IF NOT EXISTS can_view_parent_data boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS allow_item_reassignment boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS sidemark_label text DEFAULT 'sidemark';

-- Add comments for documentation
COMMENT ON COLUMN public.accounts.can_view_parent_data IS 'For sub-accounts: allows users of this sub-account to view parent account data';
COMMENT ON COLUMN public.accounts.allow_item_reassignment IS 'For parent accounts: enables all users in hierarchy to reassign items between accounts';
COMMENT ON COLUMN public.accounts.sidemark_label IS 'Display label for sidemarks (sidemark or reference)';

-- Create a function to get all accounts in the same hierarchy (parent + siblings + children)
CREATE OR REPLACE FUNCTION get_account_hierarchy(account_id uuid)
RETURNS TABLE (hierarchy_account_id uuid) AS $$
DECLARE
  root_account_id uuid;
BEGIN
  -- Find the root account (either the parent or self if no parent)
  SELECT COALESCE(a.parent_account_id, a.id) INTO root_account_id
  FROM accounts a
  WHERE a.id = account_id;

  -- Return all accounts in the hierarchy
  RETURN QUERY
  SELECT a.id
  FROM accounts a
  WHERE a.id = root_account_id  -- The root itself
     OR a.parent_account_id = root_account_id  -- All children of the root
     OR a.id = account_id;  -- The account itself (in case it's a child)
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Create a function to check if credit hold applies to an account (including parent cascade)
CREATE OR REPLACE FUNCTION is_credit_hold_active(account_id uuid)
RETURNS boolean AS $$
DECLARE
  account_credit_hold boolean;
  parent_credit_hold boolean;
  parent_id uuid;
BEGIN
  -- Get the account's own credit hold status and parent_id
  SELECT a.credit_hold, a.parent_account_id
  INTO account_credit_hold, parent_id
  FROM accounts a
  WHERE a.id = account_id;

  -- If the account itself is on credit hold, return true
  IF account_credit_hold = true THEN
    RETURN true;
  END IF;

  -- If no parent, return false
  IF parent_id IS NULL THEN
    RETURN false;
  END IF;

  -- Check parent's credit hold status
  SELECT a.credit_hold INTO parent_credit_hold
  FROM accounts a
  WHERE a.id = parent_id;

  RETURN COALESCE(parent_credit_hold, false);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Create a function to check if item reassignment is allowed for an account
CREATE OR REPLACE FUNCTION is_item_reassignment_allowed(account_id uuid)
RETURNS boolean AS $$
DECLARE
  parent_id uuid;
  parent_allows boolean;
  self_allows boolean;
BEGIN
  -- Get account info
  SELECT a.parent_account_id, a.allow_item_reassignment
  INTO parent_id, self_allows
  FROM accounts a
  WHERE a.id = account_id;

  -- If no parent, check self
  IF parent_id IS NULL THEN
    RETURN COALESCE(self_allows, false);
  END IF;

  -- If has parent, check parent's setting
  SELECT a.allow_item_reassignment INTO parent_allows
  FROM accounts a
  WHERE a.id = parent_id;

  RETURN COALESCE(parent_allows, false);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_account_hierarchy(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_credit_hold_active(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_item_reassignment_allowed(uuid) TO authenticated;
