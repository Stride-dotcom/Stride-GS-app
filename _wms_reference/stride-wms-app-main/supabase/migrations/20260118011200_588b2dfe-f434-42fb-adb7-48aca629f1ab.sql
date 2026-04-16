-- Phase 1: Enable RLS on exposed tables
ALTER TABLE public.rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_card_details ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for rate_cards (tenant isolation)
CREATE POLICY "rate_cards_tenant_select" ON public.rate_cards
  FOR SELECT USING (tenant_id = user_tenant_id());

CREATE POLICY "rate_cards_tenant_insert" ON public.rate_cards
  FOR INSERT WITH CHECK (tenant_id = user_tenant_id());

CREATE POLICY "rate_cards_tenant_update" ON public.rate_cards
  FOR UPDATE USING (tenant_id = user_tenant_id());

CREATE POLICY "rate_cards_tenant_delete" ON public.rate_cards
  FOR DELETE USING (tenant_id = user_tenant_id());

-- Create RLS policies for rate_card_details (access via rate_card tenant)
CREATE POLICY "rate_card_details_select" ON public.rate_card_details
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.rate_cards rc 
      WHERE rc.id = rate_card_details.rate_card_id 
      AND rc.tenant_id = user_tenant_id()
    )
  );

CREATE POLICY "rate_card_details_insert" ON public.rate_card_details
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rate_cards rc 
      WHERE rc.id = rate_card_details.rate_card_id 
      AND rc.tenant_id = user_tenant_id()
    )
  );

CREATE POLICY "rate_card_details_update" ON public.rate_card_details
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.rate_cards rc 
      WHERE rc.id = rate_card_details.rate_card_id 
      AND rc.tenant_id = user_tenant_id()
    )
  );

CREATE POLICY "rate_card_details_delete" ON public.rate_card_details
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.rate_cards rc 
      WHERE rc.id = rate_card_details.rate_card_id 
      AND rc.tenant_id = user_tenant_id()
    )
  );