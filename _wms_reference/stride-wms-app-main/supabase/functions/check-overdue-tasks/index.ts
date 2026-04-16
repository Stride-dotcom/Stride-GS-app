import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Starting overdue tasks check...");

    // Get current date in YYYY-MM-DD format for comparison
    const today = new Date().toISOString().split('T')[0];

    // Find all overdue tasks that haven't had an alert sent yet
    const { data: overdueTasks, error: fetchError } = await supabase
      .from('tasks')
      .select(`
        id,
        tenant_id,
        title,
        task_type,
        due_date,
        priority,
        account_id,
        assigned_to,
        warehouse_id,
        accounts(account_name),
        users!tasks_assigned_to_fkey(first_name, last_name, email),
        warehouses(name)
      `)
      .lt('due_date', today)
      .not('status', 'in', '("completed","cancelled")')
      .is('deleted_at', null)
      .is('overdue_alert_sent_at', null);

    if (fetchError) {
      console.error("Error fetching overdue tasks:", fetchError);
      throw fetchError;
    }

    if (!overdueTasks || overdueTasks.length === 0) {
      console.log("No overdue tasks found");
      return new Response(
        JSON.stringify({ message: "No overdue tasks found", queued: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${overdueTasks.length} overdue task(s)`);

    let queued = 0;
    let errors = 0;

    for (const task of overdueTasks) {
      try {
        // Calculate days overdue
        const dueDate = new Date(task.due_date);
        const todayDate = new Date(today);
        const diffTime = todayDate.getTime() - dueDate.getTime();
        const daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        // Build subject and body - handle joined relations (may be objects or arrays)
        const user = task.users as any;
        const account = task.accounts as any;
        const warehouse = task.warehouses as any;
        
        const assigneeName = user
          ? `${user.first_name || ''} ${user.last_name || ''}`.trim() 
          : 'Unassigned';
        
        const accountName = account?.account_name || 'N/A';
        const warehouseName = warehouse?.name || 'N/A';

        const subject = `⏰ Task Overdue: ${task.title} (${daysOverdue} day${daysOverdue > 1 ? 's' : ''} late)`;
        
        const bodyHtml = `
          <h2 style="color: #dc2626;">⏰ Task Overdue</h2>
          <p>The following task is <strong>${daysOverdue} day${daysOverdue > 1 ? 's' : ''}</strong> past its due date:</p>
          <table style="border-collapse: collapse; margin: 20px 0; width: 100%;">
            <tr style="background: #f9fafb;">
              <td style="padding: 12px; font-weight: bold; border: 1px solid #e5e7eb;">Task</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${task.title}</td>
            </tr>
            <tr>
              <td style="padding: 12px; font-weight: bold; border: 1px solid #e5e7eb;">Type</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${task.task_type || 'General'}</td>
            </tr>
            <tr style="background: #f9fafb;">
              <td style="padding: 12px; font-weight: bold; border: 1px solid #e5e7eb;">Due Date</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb; color: #dc2626;">${new Date(task.due_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</td>
            </tr>
            <tr>
              <td style="padding: 12px; font-weight: bold; border: 1px solid #e5e7eb;">Days Overdue</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb; color: #dc2626; font-weight: bold;">${daysOverdue}</td>
            </tr>
            <tr style="background: #f9fafb;">
              <td style="padding: 12px; font-weight: bold; border: 1px solid #e5e7eb;">Assigned To</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${assigneeName}</td>
            </tr>
            <tr>
              <td style="padding: 12px; font-weight: bold; border: 1px solid #e5e7eb;">Account</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${accountName}</td>
            </tr>
            <tr style="background: #f9fafb;">
              <td style="padding: 12px; font-weight: bold; border: 1px solid #e5e7eb;">Warehouse</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${warehouseName}</td>
            </tr>
            <tr>
              <td style="padding: 12px; font-weight: bold; border: 1px solid #e5e7eb;">Priority</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${task.priority || 'Normal'}</td>
            </tr>
          </table>
          <p>Please take action to complete or reassign this task.</p>
        `;

        const bodyText = `Task Overdue: ${task.title}

This task is ${daysOverdue} day(s) past its due date.

Task: ${task.title}
Type: ${task.task_type || 'General'}
Due Date: ${new Date(task.due_date).toLocaleDateString()}
Days Overdue: ${daysOverdue}
Assigned To: ${assigneeName}
Account: ${accountName}
Warehouse: ${warehouseName}
Priority: ${task.priority || 'Normal'}

Please take action to complete or reassign this task.`;

        // Insert into alert_queue
        const { error: insertError } = await supabase
          .from('alert_queue')
          .insert({
            tenant_id: task.tenant_id,
            alert_type: 'task.overdue',
            entity_type: 'task',
            entity_id: task.id,
            subject,
            body_html: bodyHtml,
            body_text: bodyText,
            status: 'pending',
          });

        if (insertError) {
          console.error(`Error inserting alert for task ${task.id}:`, insertError);
          errors++;
          continue;
        }

        // Update task to mark that overdue alert was sent
        const { error: updateError } = await supabase
          .from('tasks')
          .update({ overdue_alert_sent_at: new Date().toISOString() })
          .eq('id', task.id);

        if (updateError) {
          console.error(`Error updating task ${task.id}:`, updateError);
          errors++;
          continue;
        }

        queued++;
        console.log(`Queued overdue alert for task ${task.id} (${daysOverdue} days overdue)`);
      } catch (taskError) {
        console.error(`Error processing task ${task.id}:`, taskError);
        errors++;
      }
    }

    console.log(`Finished: queued ${queued} alerts, ${errors} errors`);

    return new Response(
      JSON.stringify({ 
        message: `Processed ${overdueTasks.length} overdue tasks`,
        queued,
        errors 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in check-overdue-tasks function:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
