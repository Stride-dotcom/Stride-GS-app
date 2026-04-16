import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { isValidEmail, resolvePlatformEmailDefaults } from "../_shared/platformEmail.ts";
import { resolveTenantReplyToRoutingAddress } from "../_shared/inboundReplyRouting.ts";
import { sendPlatformEmail } from "../_shared/emailProviders.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InvitePayload {
  user_id: string;
  tenant_id: string;
}

async function getTenantBranding(supabase: any, tenantId: string): Promise<{ 
  logoUrl: string | null; 
  companyName: string | null;
  primaryColor: string;
}> {
  try {
    const { data: settings } = await supabase
      .from('tenant_company_settings')
      .select('logo_url, company_name')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const { data: brandSettings } = await supabase
      .from('communication_brand_settings')
      .select('brand_logo_url, brand_primary_color')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    const { data: tenant } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .single();

    return {
      logoUrl: brandSettings?.brand_logo_url || settings?.logo_url || null,
      companyName: settings?.company_name || tenant?.name || 'Warehouse System',
      primaryColor: brandSettings?.brand_primary_color || '#3b82f6',
    };
  } catch {
    return { logoUrl: null, companyName: 'Warehouse System', primaryColor: '#3b82f6' };
  }
}

function generateInviteEmail(
  employeeName: string,
  companyName: string,
  inviteLink: string,
  logoUrl: string | null,
  primaryColor: string
): { html: string; text: string; subject: string } {
  const subject = `You're invited to join ${companyName}`;
  
  const logoHtml = logoUrl 
    ? `<img src="${logoUrl}" alt="${companyName}" style="max-height: 60px; max-width: 200px; margin-bottom: 24px;" />`
    : `<h1 style="color: ${primaryColor}; margin-bottom: 24px; font-size: 28px;">${companyName}</h1>`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #374151; margin: 0; padding: 0; background-color: #f3f4f6;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06);">
          <div style="text-align: center; margin-bottom: 32px;">
            ${logoHtml}
          </div>
          
          <h2 style="color: #111827; margin-bottom: 16px; font-size: 24px;">Welcome to the team, ${employeeName}! 🎉</h2>
          
          <p style="color: #4b5563; margin-bottom: 24px; font-size: 16px;">
            You've been invited to join <strong>${companyName}</strong> as a team member. 
            Click the button below to set up your account and get started.
          </p>
          
          <div style="text-align: center; margin: 32px 0;">
            <a href="${inviteLink}" 
               style="display: inline-block; background: ${primaryColor}; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              Accept Invitation
            </a>
          </div>
          
          <p style="color: #6b7280; font-size: 14px; margin-top: 32px;">
            If you didn't expect this invitation, you can safely ignore this email.
          </p>
          
          <p style="color: #6b7280; font-size: 14px;">
            If the button doesn't work, copy and paste this link into your browser:<br/>
            <a href="${inviteLink}" style="color: ${primaryColor}; word-break: break-all;">${inviteLink}</a>
          </p>
        </div>
        
        <div style="text-align: center; padding: 24px; color: #9ca3af; font-size: 12px;">
          <p>© ${new Date().getFullYear()} ${companyName}. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Welcome to the team, ${employeeName}!

You've been invited to join ${companyName} as a team member.

Click the link below to set up your account and get started:
${inviteLink}

If you didn't expect this invitation, you can safely ignore this email.

© ${new Date().getFullYear()} ${companyName}
  `.trim();

  return { html, text, subject };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const platformDefaults = await resolvePlatformEmailDefaults(supabase);
    const { user_id, tenant_id }: InvitePayload = await req.json();

    // Get user details
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email, first_name, last_name, invite_token')
      .eq('id', user_id)
      .single();

    if (userError || !user) {
      throw new Error('User not found');
    }

    if (!user.invite_token) {
      throw new Error('No invite token found for user');
    }

    // Get tenant branding
    const branding = await getTenantBranding(supabase, tenant_id);

    // Generate invite link (using the Supabase URL as base)
    const baseUrl = supabaseUrl.replace('.supabase.co', '.lovableproject.com');
    const inviteLink = `${baseUrl}/accept-invite?token=${user.invite_token}`;

    const employeeName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Team Member';

    // Generate email content
    const { html, text, subject } = generateInviteEmail(
      employeeName,
      branding.companyName || 'Warehouse System',
      inviteLink,
      branding.logoUrl,
      branding.primaryColor
    );

    const { data: senderSettings } = await supabase
      .from("communication_brand_settings")
      .select("use_default_email, email_domain_verified, from_email, from_name, custom_email_domain, brand_support_email")
      .eq("tenant_id", tenant_id)
      .maybeSingle();

    let fromEmail = platformDefaults.fromEmail;
    let fromName = senderSettings?.from_name || branding.companyName || platformDefaults.fromName;
    const routingReplyTo = await resolveTenantReplyToRoutingAddress(supabase, tenant_id);
    const supportEmail = (senderSettings?.brand_support_email || "").trim();
    let replyTo: string | null =
      routingReplyTo || (isValidEmail(supportEmail) ? supportEmail : platformDefaults.replyTo);

    const wantsCustom = senderSettings?.use_default_email === false;
    const isVerified = senderSettings?.email_domain_verified === true;
    if (wantsCustom && isVerified) {
      fromEmail = String(
        senderSettings?.from_email ||
        senderSettings?.custom_email_domain ||
        platformDefaults.fromEmail
      );
    }

    await sendPlatformEmail(supabase, {
      fromEmail,
      fromName,
      to: [user.email],
      subject,
      html,
      text,
      replyTo,
    });

    // Update user's invited_at timestamp
    await supabase
      .from('users')
      .update({ invited_at: new Date().toISOString() })
      .eq('id', user_id);

    console.log(`Invite email sent to ${user.email}`);

    return new Response(
      JSON.stringify({ success: true, message: `Invite sent to ${user.email}` }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error in send-employee-invite function:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};

serve(handler);
