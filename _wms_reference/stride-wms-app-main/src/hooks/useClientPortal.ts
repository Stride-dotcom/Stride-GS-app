import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface ClientPortalContext {
  portalUser: {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    account_id: string;
    tenant_id: string;
    is_primary: boolean;
  } | null;
  account: {
    id: string;
    name: string;
    account_code: string;
  } | null;
  tenant: {
    id: string;
    name: string;
  } | null;
  isLoading: boolean;
  isClientPortalUser: boolean;
}

// Get the current client portal user context
export function useClientPortalContext(): ClientPortalContext {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['client-portal-context', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      // NOTE: Do not use .single() here.
      // PostgREST returns 406 when 0 rows match, which can create noisy retries and
      // destabilize app startup for non-client users.
      const { data: portalUsers, error } = await (supabase
        .from('client_portal_users') as any)
        .select(`
          id,
          email,
          first_name,
          last_name,
          account_id,
          tenant_id,
          is_primary,
          accounts:account_id (
            id,
            account_name,
            account_code
          ),
          tenants:tenant_id (
            id,
            name
          )
        `)
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .limit(1);

      const portalUser = portalUsers?.[0] ?? null;

      if (error || !portalUser) return null;

      return {
        portalUser: {
          id: portalUser.id,
          email: portalUser.email,
          first_name: portalUser.first_name,
          last_name: portalUser.last_name,
          account_id: portalUser.account_id,
          tenant_id: portalUser.tenant_id,
          is_primary: portalUser.is_primary,
        },
        account: portalUser.accounts ? {
          id: portalUser.accounts.id,
          name: portalUser.accounts.account_name,
          account_code: portalUser.accounts.account_code,
        } : null,
        tenant: portalUser.tenants ? {
          id: portalUser.tenants.id,
          name: portalUser.tenants.name,
        } : null,
      };
    },
    enabled: !!user?.id,
  });

  return {
    portalUser: data?.portalUser || null,
    account: data?.account || null,
    tenant: data?.tenant || null,
    isLoading,
    isClientPortalUser: !!data?.portalUser,
  };
}

// Get items for the client's account
export function useClientItems() {
  const { portalUser, isLoading: contextLoading } = useClientPortalContext();

  return useQuery({
    queryKey: ['client-items', portalUser?.account_id],
    queryFn: async () => {
      if (!portalUser?.account_id) return [];

      const { data, error } = await supabase
        .from('items')
        .select(`
          id,
          account_id,
          warehouse_id,
          item_code,
          quantity,
          description,
          status,
          condition,
          location_id,
          current_location,
          category,
          created_at,
          photos,
          sidemarks:sidemark_id (
            id,
            sidemark_code,
            sidemark_name
          )
        `)
        .eq('account_id', portalUser.account_id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!portalUser?.account_id && !contextLoading,
  });
}

// Get quotes for the client's account
export function useClientQuotes() {
  const { portalUser, isLoading: contextLoading } = useClientPortalContext();

  return useQuery({
    queryKey: ['client-quotes', portalUser?.account_id],
    queryFn: async () => {
      if (!portalUser?.account_id) return [];

      const { data, error } = await (supabase
        .from('repair_quotes') as any)
        .select(`
          id,
          quote_number,
          status,
          customer_total,
          client_response,
          client_responded_at,
          expires_at,
          created_at,
          repair_quote_items (
            id,
            item_code,
            item_description
          )
        `)
        .eq('account_id', portalUser.account_id)
        .in('status', ['sent_to_client', 'accepted', 'declined', 'expired'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!portalUser?.account_id && !contextLoading,
  });
}

// Get recent shipments for the client's account
export function useClientShipments() {
  const { portalUser, isLoading: contextLoading } = useClientPortalContext();

  return useQuery({
    queryKey: ['client-shipments', portalUser?.account_id],
    queryFn: async () => {
      if (!portalUser?.account_id) return [];

      const { data, error } = await supabase
        .from('shipments')
        .select(`
          id,
          shipment_number,
          shipment_type,
          status,
          metadata,
          scheduled_date,
          created_at,
          origin_name,
          destination_name,
          total_items
        `)
        .eq('account_id', portalUser.account_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!portalUser?.account_id && !contextLoading,
  });
}

// Get claims for the client's account (with visibility restrictions)
export function useClientClaims() {
  const { portalUser, isLoading: contextLoading } = useClientPortalContext();

  return useQuery({
    queryKey: ['client-claims', portalUser?.account_id],
    queryFn: async () => {
      if (!portalUser?.account_id) return [];

      // Clients can only see claims for their account
      // They can see: initiated, under_review, pending_acceptance, accepted, declined, credited, paid, closed
      // They CANNOT see internal notes or payout details until sent for acceptance
      const { data, error } = await supabase
        .from('claims')
        .select(`
          id,
          claim_number,
          claim_type,
          status,
          description,
          public_notes,
          incident_date,
          created_at,
          sent_for_acceptance_at,
          settlement_accepted_at,
          settlement_declined_at,
          total_approved_amount,
          payout_method,
          client_initiated,
          sidemark:sidemarks!claims_sidemark_id_fkey(id, sidemark_name),
          item:items!claims_item_id_fkey(id, item_code, description)
        `)
        .eq('account_id', portalUser.account_id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Filter out payout details for claims not yet sent for acceptance
      return (data || []).map(claim => ({
        ...claim,
        // Only show payout info if claim was sent for acceptance
        total_approved_amount: claim.sent_for_acceptance_at ? claim.total_approved_amount : null,
        payout_method: claim.sent_for_acceptance_at ? claim.payout_method : null,
      }));
    },
    enabled: !!portalUser?.account_id && !contextLoading,
  });
}

// Get single claim detail for client (with visibility restrictions)
export function useClientClaimDetail(claimId: string | undefined) {
  const { portalUser, isLoading: contextLoading } = useClientPortalContext();

  return useQuery({
    queryKey: ['client-claim-detail', claimId, portalUser?.account_id],
    queryFn: async () => {
      if (!portalUser?.account_id || !claimId) return null;

      const { data: claim, error } = await supabase
        .from('claims')
        .select(`
          id,
          claim_number,
          claim_type,
          status,
          description,
          public_notes,
          incident_date,
          incident_location,
          incident_contact_name,
          incident_contact_phone,
          incident_contact_email,
          created_at,
          sent_for_acceptance_at,
          settlement_accepted_at,
          settlement_declined_at,
          settlement_terms_text,
          total_approved_amount,
          payout_method,
          client_initiated,
          acceptance_token,
          acceptance_token_expires_at,
          sidemark:sidemarks!claims_sidemark_id_fkey(id, sidemark_name),
          item:items!claims_item_id_fkey(id, item_code, description)
        `)
        .eq('id', claimId)
        .eq('account_id', portalUser.account_id)
        .is('deleted_at', null)
        .single();

      if (error) throw error;
      if (!claim) return null;

      // Get claim items (limited view)
      const { data: items } = await supabase
        .from('claim_items')
        .select(`
          id,
          coverage_type,
          declared_value,
          weight_lbs,
          approved_amount,
          repairable,
          item:items(id, item_code, description, primary_photo_url)
        `)
        .eq('claim_id', claimId);

      // Get public attachments only
      const { data: attachments } = await supabase
        .from('claim_attachments')
        .select('*')
        .eq('claim_id', claimId)
        .eq('is_public', true)
        .order('created_at', { ascending: false });

      // Filter visibility based on acceptance status
      const isSentForAcceptance = !!claim.sent_for_acceptance_at;

      return {
        ...claim,
        // Only show financial details if sent for acceptance
        total_approved_amount: isSentForAcceptance ? claim.total_approved_amount : null,
        payout_method: isSentForAcceptance ? claim.payout_method : null,
        settlement_terms_text: isSentForAcceptance ? claim.settlement_terms_text : null,
        items: items?.map(item => ({
          ...item,
          // Hide approved amounts until sent for acceptance
          approved_amount: isSentForAcceptance ? item.approved_amount : null,
        })) || [],
        attachments: attachments || [],
      };
    },
    enabled: !!portalUser?.account_id && !!claimId && !contextLoading,
  });
}

// Get dashboard stats
export function useClientDashboardStats() {
  const { portalUser, isLoading: contextLoading } = useClientPortalContext();

  return useQuery({
    queryKey: ['client-dashboard-stats', portalUser?.account_id],
    queryFn: async () => {
      if (!portalUser?.account_id) {
        return {
          totalItems: 0,
          inStorage: 0,
          pendingQuotes: 0,
          recentShipments: 0,
        };
      }

      // Get item counts
      const { count: totalItems } = await supabase
        .from('items')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', portalUser.account_id)
        .is('deleted_at', null);

      const { count: inStorage } = await supabase
        .from('items')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', portalUser.account_id)
        .eq('status', 'available')
        .is('deleted_at', null);

      // Get pending quotes count
      const { count: pendingQuotes } = await (supabase
        .from('repair_quotes') as any)
        .select('*', { count: 'exact', head: true })
        .eq('account_id', portalUser.account_id)
        .eq('status', 'sent_to_client');

      // Get recent shipments (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { count: recentShipments } = await supabase
        .from('shipments')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', portalUser.account_id)
        .gte('created_at', thirtyDaysAgo.toISOString());

      return {
        totalItems: totalItems || 0,
        inStorage: inStorage || 0,
        pendingQuotes: pendingQuotes || 0,
        recentShipments: recentShipments || 0,
      };
    },
    enabled: !!portalUser?.account_id && !contextLoading,
  });
}
