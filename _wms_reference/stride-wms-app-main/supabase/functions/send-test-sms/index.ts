import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { loadTenantSmsSendConfig, normalizePhoneE164 } from "../_shared/smsRouting.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface TestSmsRequest {
  to_phone: string;
  body: string;
  tenant_id: string;
  entity_type?: 'shipment' | 'task' | 'item';
  entity_id?: string;
}

async function authenticateAndAuthorize(req: Request, tenant_id: string) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("UNAUTHORIZED");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    throw new Error("UNAUTHORIZED");
  }

  const userId = user.id;

  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  const { data: userData, error: userError } = await adminClient
    .from("users")
    .select("tenant_id")
    .eq("id", userId)
    .single();

  if (userError || !userData || userData.tenant_id !== tenant_id) {
    throw new Error("FORBIDDEN");
  }

  return { userId, adminClient };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestBody = await req.json();
    const { to_phone, body, tenant_id, entity_type, entity_id }: TestSmsRequest = requestBody;

    if (!to_phone || !body || !tenant_id) {
      throw new Error("Missing required fields: to_phone, body, tenant_id");
    }

    // Authenticate and verify tenant membership
    const { adminClient: supabase } = await authenticateAndAuthorize(req, tenant_id);

    const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");

    if (!twilioAuthToken) {
      throw new Error("Twilio auth token is not configured. Please add TWILIO_AUTH_TOKEN in Supabase secrets.");
    }

    const smsConfig = await loadTenantSmsSendConfig(supabase, tenant_id);
    const twilioAccountSid = smsConfig.accountSid;
    const twilioPhoneNumber = smsConfig.fromPhone || normalizePhoneE164(Deno.env.get("TWILIO_PHONE_NUMBER"));
    const twilioMessagingServiceSid = smsConfig.messagingServiceSid;

    if (!smsConfig.smsEnabled) {
      throw new Error("SMS is not enabled for this organization.");
    }

    if (!twilioAccountSid) {
      throw new Error(
        "Twilio Account SID is not configured. Configure TWILIO_ACCOUNT_SID secret or tenant fallback settings."
      );
    }

    if (!twilioAccountSid.startsWith("AC") || twilioAccountSid.length !== 34) {
      throw new Error("TWILIO_ACCOUNT_SID appears invalid. It should start with 'AC' followed by 32 characters.");
    }

    if (!twilioMessagingServiceSid && !twilioPhoneNumber) {
      throw new Error("No SMS sender is configured. Assign a platform sender or configure fallback From settings.");
    }

    // Fetch brand settings for sender ID
    const { data: brandSettings } = await supabase
      .from('communication_brand_settings')
      .select('sms_sender_id')
      .eq('tenant_id', tenant_id)
      .single();

    let messageBody = body;

    // If entity provided, fetch real data for variable replacement
    if (entity_type && entity_id) {
      let entityData: Record<string, string> = {};
      
      if (entity_type === 'shipment') {
        const { data: shipment } = await supabase
          .from('shipments')
          .select(`
            *,
            account:accounts(account_name, primary_contact_name, primary_contact_email)
          `)
          .eq('id', entity_id)
          .single();
        
        if (shipment) {
          entityData = {
            shipment_number: shipment.shipment_number || '',
            shipment_vendor: shipment.vendor || '',
            shipment_status: shipment.status || '',
            account_name: shipment.account?.account_name || '',
            account_contact_name: shipment.account?.primary_contact_name || '',
          };
        }
      } else if (entity_type === 'task') {
        const { data: task } = await supabase
          .from('tasks')
          .select(`
            *,
            account:accounts(account_name)
          `)
          .eq('id', entity_id)
          .single();
        
        if (task) {
          entityData = {
            task_number: task.id?.slice(0, 8).toUpperCase() || '',
            task_type: task.task_type || '',
            task_status: task.status || '',
            task_due_date: task.due_date || '',
            account_name: task.account?.account_name || '',
          };
        }
      } else if (entity_type === 'item') {
        const { data: item } = await supabase
          .from('items')
          .select(`
            *,
            account:accounts(account_name)
          `)
          .eq('id', entity_id)
          .single();
        
        if (item) {
          entityData = {
            item_id: item.item_code || '',
            item_description: item.description || '',
            item_vendor: item.vendor || '',
            item_location: item.location_code || '',
            account_name: item.account?.account_name || '',
          };
        }
      }
      
      // Replace variables in message
      Object.entries(entityData).forEach(([key, value]) => {
        const regexBraces = new RegExp(`{{${key}}}`, 'g');
        const regexBrackets = new RegExp(`\\[\\[${key}\\]\\]`, 'g');
        messageBody = messageBody.replace(regexBraces, value).replace(regexBrackets, value);
      });
    }

    // Add [TEST] prefix
    const testMessage = `[TEST] ${messageBody}`;

    // Clean phone number
    const cleanPhone = normalizePhoneE164(to_phone);
    if (!cleanPhone) {
      throw new Error("Invalid destination phone number.");
    }

    // Send SMS via Twilio REST API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;
    
    const formData = new URLSearchParams();
    formData.append('To', cleanPhone);
    formData.append('Body', testMessage);
    if (twilioMessagingServiceSid) {
      formData.append("MessagingServiceSid", twilioMessagingServiceSid);
    } else {
      formData.append("From", twilioPhoneNumber!);
    }

    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${twilioAccountSid}:${twilioAuthToken}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const twilioData = await twilioResponse.json();

    if (!twilioResponse.ok) {
      console.error("Twilio error:", twilioData);
      
      if (twilioData.code === 21608 || (twilioData.message && twilioData.message.includes('unverified'))) {
        throw new Error(
          `Trial account limitation: Your Twilio trial account can only send SMS to verified phone numbers. ` +
          `Please verify this number at twilio.com/console/phone-numbers/verified, or upgrade your Twilio account.`
        );
      }
      
      throw new Error(twilioData.message || 'Failed to send SMS');
    }

    console.log("Test SMS sent:", twilioData.sid);

    return new Response(
      JSON.stringify({ success: true, data: { sid: twilioData.sid } }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    if (error.message === "UNAUTHORIZED") {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    if (error.message === "FORBIDDEN") {
      return new Response(
        JSON.stringify({ error: "Forbidden: tenant mismatch" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    console.error("Error sending test SMS:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
