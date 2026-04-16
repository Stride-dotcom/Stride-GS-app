// Client invitation management hooks
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/lib/toastShim';
import { sendEmail, generateClientInvitationEmail } from '@/lib/emailService';

export interface ClientInvitation {
  id: string;
  tenant_id: string;
  account_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  token: string;
  status: 'pending' | 'sent' | 'accepted' | 'expired' | 'cancelled';
  sent_at: string | null;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
  created_by: string | null;
  client_portal_user_id: string | null;
}

export interface ClientPortalUser {
  id: string;
  tenant_id: string;
  account_id: string;
  auth_user_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  is_primary: boolean;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateInvitationParams {
  accountId: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

// Hook to get invitations for a specific account
export function useAccountInvitations(accountId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['client-invitations', accountId],
    queryFn: async () => {
      if (!accountId) return [];

      const { data, error } = await (supabase
        .from('client_invitations') as any)
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as ClientInvitation[];
    },
    enabled: !!accountId && !!user,
  });
}

// Hook to get portal users for a specific account
export function useAccountPortalUsers(accountId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['client-portal-users', accountId],
    queryFn: async () => {
      if (!accountId) return [];

      const { data, error } = await (supabase
        .from('client_portal_users') as any)
        .select('*')
        .eq('account_id', accountId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as ClientPortalUser[];
    },
    enabled: !!accountId && !!user,
  });
}

// Hook to create and send an invitation
export function useCreateInvitation() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();

  return useMutation({
    mutationFn: async (params: CreateInvitationParams) => {
      if (!user || !profile?.tenant_id) {
        throw new Error('Not authenticated');
      }

      // Get account details for the email
      const { data: account, error: accountError } = await supabase
        .from('accounts')
        .select('account_name')
        .eq('id', params.accountId)
        .single();

      if (accountError) throw accountError;

      // Get tenant/warehouse name
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('name')
        .eq('id', profile.tenant_id)
        .single();

      if (tenantError) throw tenantError;

      // Calculate expiration (7 days from now)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // Create the invitation
      const { data: invitation, error: createError } = await (supabase
        .from('client_invitations') as any)
        .insert({
          tenant_id: profile.tenant_id,
          account_id: params.accountId,
          email: params.email,
          first_name: params.firstName || null,
          last_name: params.lastName || null,
          expires_at: expiresAt.toISOString(),
          created_by: user.id,
        })
        .select()
        .single();

      if (createError) throw createError;

      // Generate activation link
      const baseUrl = window.location.origin;
      const activationLink = `${baseUrl}/activate?token=${invitation.token}`;

      // Generate and send email
      const emailContent = generateClientInvitationEmail({
        recipientName: params.firstName || params.email.split('@')[0],
        accountName: account.account_name,
        inviterName: profile.first_name
          ? `${profile.first_name} ${profile.last_name || ''}`.trim()
          : 'The team',
        warehouseName: tenant.name,
        activationLink,
        expiresIn: '7 days',
      });

      const emailResult = await sendEmail({
        to: params.email,
        toName: params.firstName
          ? `${params.firstName} ${params.lastName || ''}`.trim()
          : undefined,
        subject: emailContent.subject,
        htmlBody: emailContent.html,
        textBody: emailContent.text,
        emailType: 'client_invitation',
        tenantId: profile.tenant_id,
        entityType: 'client_invitation',
        entityId: invitation.id,
      });

      // Update invitation status
      if (emailResult.success) {
        await (supabase.from('client_invitations') as any)
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
          })
          .eq('id', invitation.id);
      }

      return { invitation, emailResult };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['client-invitations', variables.accountId] });
      if (data.emailResult.success) {
        // Check if in test mode and show the activation link
        if (data.emailResult.testModeData?.activationLink) {
          console.log('🔗 Activation Link:', data.emailResult.testModeData.activationLink);
          toast.success('Test Mode: Invitation created - check console for activation link', { duration: 10000 });
        } else {
          toast.success('Invitation sent successfully');
        }
      } else {
        toast.warning('Invitation created but email failed to send');
      }
    },
    onError: (error) => {
      console.error('Create invitation error:', error);
      toast.error('Failed to create invitation');
    },
  });
}

// Hook to resend an invitation
export function useResendInvitation() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async (invitationId: string) => {
      if (!profile?.tenant_id) {
        throw new Error('Not authenticated');
      }

      // Get the invitation with account details
      const { data: invitation, error: invError } = await (supabase
        .from('client_invitations') as any)
        .select(`
          *,
          accounts:account_id (account_name)
        `)
        .eq('id', invitationId)
        .single();

      if (invError) throw invError;

      // Get tenant name
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('name')
        .eq('id', profile.tenant_id)
        .single();

      if (tenantError) throw tenantError;

      // Extend expiration if needed
      const newExpiration = new Date();
      newExpiration.setDate(newExpiration.getDate() + 7);

      // Generate new token if expired
      let token = invitation.token;
      if (new Date(invitation.expires_at) < new Date()) {
        // Generate new token
        const { data: updated, error: updateError } = await (supabase
          .from('client_invitations') as any)
          .update({
            token: crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
            expires_at: newExpiration.toISOString(),
            status: 'pending',
          })
          .eq('id', invitationId)
          .select()
          .single();

        if (updateError) throw updateError;
        token = updated.token;
      }

      // Generate activation link
      const baseUrl = window.location.origin;
      const activationLink = `${baseUrl}/activate?token=${token}`;

      // Send email
      const emailContent = generateClientInvitationEmail({
        recipientName: invitation.first_name || invitation.email.split('@')[0],
        accountName: invitation.accounts?.account_name || 'your account',
        inviterName: profile.first_name
          ? `${profile.first_name} ${profile.last_name || ''}`.trim()
          : 'The team',
        warehouseName: tenant.name,
        activationLink,
        expiresIn: '7 days',
      });

      const emailResult = await sendEmail({
        to: invitation.email,
        toName: invitation.first_name
          ? `${invitation.first_name} ${invitation.last_name || ''}`.trim()
          : undefined,
        subject: emailContent.subject,
        htmlBody: emailContent.html,
        textBody: emailContent.text,
        emailType: 'client_invitation',
        tenantId: profile.tenant_id,
        entityType: 'client_invitation',
        entityId: invitation.id,
      });

      // Update invitation status
      if (emailResult.success) {
        await (supabase.from('client_invitations') as any)
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
          })
          .eq('id', invitationId);
      }

      return { invitation, emailResult };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['client-invitations'] });
      if (data.emailResult.success) {
        // Check if in test mode and show the activation link
        if (data.emailResult.testModeData?.activationLink) {
          console.log('🔗 Activation Link:', data.emailResult.testModeData.activationLink);
          toast.success('Test Mode: Invitation resent - check console for activation link', { duration: 10000 });
        } else {
          toast.success('Invitation resent successfully');
        }
      } else {
        toast.warning('Failed to resend invitation email');
      }
    },
    onError: (error) => {
      console.error('Resend invitation error:', error);
      toast.error('Failed to resend invitation');
    },
  });
}

// Hook to cancel an invitation
export function useCancelInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (invitationId: string) => {
      const { error } = await (supabase
        .from('client_invitations') as any)
        .update({ status: 'cancelled' })
        .eq('id', invitationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-invitations'] });
      toast.success('Invitation cancelled');
    },
    onError: (error) => {
      console.error('Cancel invitation error:', error);
      toast.error('Failed to cancel invitation');
    },
  });
}

// Hook to deactivate a portal user
export function useDeactivatePortalUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await (supabase
        .from('client_portal_users') as any)
        .update({ is_active: false })
        .eq('id', userId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-portal-users'] });
      toast.success('Portal access revoked');
    },
    onError: (error) => {
      console.error('Deactivate portal user error:', error);
      toast.error('Failed to revoke portal access');
    },
  });
}

// Hook to validate an invitation token (for activation page)
export function useValidateInvitationToken(token: string | null) {
  return useQuery({
    queryKey: ['invitation-token', token],
    queryFn: async () => {
      if (!token) return null;

      const { data, error } = await (supabase
        .from('client_invitations') as any)
        .select(`
          *,
          accounts:account_id (id, name:account_name),
          tenants:tenant_id (id, name)
        `)
        .eq('token', token)
        .single();

      if (error) throw error;

      // Check if expired
      if (new Date(data.expires_at) < new Date()) {
        return { ...data, isExpired: true, isValid: false };
      }

      // Check if already used
      if (data.status === 'accepted') {
        return { ...data, isUsed: true, isValid: false };
      }

      // Check if cancelled
      if (data.status === 'cancelled') {
        return { ...data, isCancelled: true, isValid: false };
      }

      return { ...data, isValid: true };
    },
    enabled: !!token,
  });
}

// Hook to accept an invitation and create portal user
export function useAcceptInvitation() {
  return useMutation({
    mutationFn: async ({
      token,
      password,
      firstName,
      lastName,
      phone,
    }: {
      token: string;
      password: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
    }) => {
      // Get invitation details
      const { data: invitation, error: invError } = await (supabase
        .from('client_invitations') as any)
        .select('*')
        .eq('token', token)
        .single();

      if (invError) throw invError;

      if (invitation.status === 'accepted') {
        throw new Error('This invitation has already been used');
      }

      if (new Date(invitation.expires_at) < new Date()) {
        throw new Error('This invitation has expired');
      }

      // Create Supabase auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: invitation.email,
        password,
        options: {
          data: {
            first_name: firstName || invitation.first_name,
            last_name: lastName || invitation.last_name,
            is_client_portal_user: true,
            tenant_id: invitation.tenant_id,
            account_id: invitation.account_id,
          },
        },
      });

      if (authError) throw authError;

      // Create client portal user record
      const { data: portalUser, error: portalError } = await (supabase
        .from('client_portal_users') as any)
        .insert({
          tenant_id: invitation.tenant_id,
          account_id: invitation.account_id,
          auth_user_id: authData.user?.id,
          email: invitation.email,
          first_name: firstName || invitation.first_name,
          last_name: lastName || invitation.last_name,
          phone: phone || null,
          is_primary: false,
          is_active: true,
        })
        .select()
        .single();

      if (portalError) {
        // If portal user creation fails, we should ideally clean up the auth user
        // but Supabase doesn't allow deleting users from client-side
        console.error('Failed to create portal user:', portalError);
        throw portalError;
      }

      // Update invitation status
      await (supabase.from('client_invitations') as any)
        .update({
          status: 'accepted',
          accepted_at: new Date().toISOString(),
          client_portal_user_id: portalUser.id,
        })
        .eq('id', invitation.id);

      return { portalUser, authUser: authData.user };
    },
    onError: (error) => {
      console.error('Accept invitation error:', error);
    },
  });
}
