-- TASK_CLIENT_NOTE — office alert when a client posts a note on a task.
--
-- Use cases:
--   • Client taps "Accept As-Is" on a Completed/Fail INSP task — the
--     acknowledgement note (body starts with "✓ Accepted as-is by …")
--     fires this template.
--   • Client comments on any task via the Notes tab or the inline
--     "Add comment" expander on the AcceptAsIs widget.
--
-- Trigger path: the React `useEntityNotes.addNote` hook fires the
-- `notify-task-client-note` edge function fire-and-forget after a
-- successful insert when (entityType='task', user.role='client').
-- The edge function fetches task + item + client context, builds the
-- token map, and delegates to `send-email` (Resend). Same wiring as
-- `notify-public-request` — see that function for the pattern.
--
-- Recipients: the `recipients` column resolves to NOTIFICATION_EMAILS,
-- which is an Edge Function secret (comma-separated). Edit that secret
-- to add or remove office addresses without redeploying. Admins can
-- also override via Settings → Email Templates → TASK_CLIENT_NOTE.

INSERT INTO public.email_templates (
  template_key,
  subject,
  body,
  notes,
  recipients,
  category,
  active
) VALUES (
  'TASK_CLIENT_NOTE',
  '🔔 {{NOTE_KIND}} on {{TASK_TYPE}} {{TASK_ID}} — {{CLIENT_NAME}} (Item {{ITEM_ID}})',
  E'<div style="font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', sans-serif; max-width: 640px; color: #111;">\n'
  || E'  <div style="background: #E85D2D; color: #fff; padding: 16px 24px; border-radius: 8px 8px 0 0;">\n'
  || E'    <h2 style="margin: 0; font-size: 18px;">{{NOTE_KIND}} from {{CLIENT_NAME}}</h2>\n'
  || E'    <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">Task {{TASK_ID}} · Item {{ITEM_ID}}</div>\n'
  || E'  </div>\n'
  || E'  <div style="border: 1px solid #E5E7EB; border-top: 0; padding: 20px 24px; border-radius: 0 0 8px 8px; background: #fff;">\n'
  || E'    <p style="margin-top: 0; font-size: 14px;"><strong>{{AUTHOR_NAME}}</strong> posted a note on this task at {{NOTE_TIME}}.</p>\n'
  || E'\n'
  || E'    <div style="background: #F9FAFB; border-left: 3px solid #E85D2D; padding: 12px 14px; margin: 14px 0; border-radius: 4px;">\n'
  || E'      <div style="font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; margin-bottom: 6px;">Note</div>\n'
  || E'      <div style="font-size: 14px; color: #111; white-space: pre-wrap;">{{NOTE_BODY}}</div>\n'
  || E'    </div>\n'
  || E'\n'
  || E'    <table style="width:100%; border-collapse: collapse; margin: 16px 0; font-size: 13px;">\n'
  || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280; width: 130px;">Client</td><td style="padding:6px 0;"><strong>{{CLIENT_NAME}}</strong></td></tr>\n'
  || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">Item</td><td style="padding:6px 0;">{{ITEM_ID}} — {{ITEM_DESCRIPTION}}</td></tr>\n'
  || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">Sidemark</td><td style="padding:6px 0;">{{ITEM_SIDEMARK}}</td></tr>\n'
  || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">Reference</td><td style="padding:6px 0;">{{ITEM_REFERENCE}}</td></tr>\n'
  || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">Task</td><td style="padding:6px 0;">{{TASK_ID}} ({{TASK_TYPE}})</td></tr>\n'
  || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">Task status</td><td style="padding:6px 0;">{{TASK_STATUS}}{{TASK_RESULT_SUFFIX}}</td></tr>\n'
  || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">Note time</td><td style="padding:6px 0;">{{NOTE_TIME}}</td></tr>\n'
  || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">Author</td><td style="padding:6px 0;">{{AUTHOR_NAME}} (client)</td></tr>\n'
  || E'    </table>\n'
  || E'\n'
  || E'    <div style="text-align:center; margin: 24px 0;">\n'
  || E'      <a href="{{DEEP_LINK}}" style="display:inline-block; padding:12px 28px; background:#E85D2D; color:#fff; text-decoration:none; border-radius:6px; font-weight:600;">Open Task in MyStrideHub</a>\n'
  || E'    </div>\n'
  || E'\n'
  || E'    <p style="color:#6B7280; font-size:11px; margin-bottom:0; text-align:center;">You''re receiving this because you''re on the office NOTIFICATION_EMAILS list.</p>\n'
  || E'  </div>\n'
  || E'</div>',
  E'Fires from useEntityNotes.addNote when a client-role user posts a note on a task (entity_type=task, author_role=client).\n\n'
  || E'Available tokens:\n'
  || E'  {{NOTE_KIND}}            — "Acceptance" for is_system acceptance events, "Comment" for regular notes\n'
  || E'  {{CLIENT_NAME}}          — display name of the client/tenant\n'
  || E'  {{AUTHOR_NAME}}          — who posted the note\n'
  || E'  {{NOTE_BODY}}            — the note content (whitespace preserved)\n'
  || E'  {{NOTE_TIME}}            — readable timestamp (Pacific)\n'
  || E'  {{ITEM_ID}}              — inventory item id\n'
  || E'  {{ITEM_DESCRIPTION}}     — item description\n'
  || E'  {{ITEM_SIDEMARK}}        — item sidemark or "—"\n'
  || E'  {{ITEM_REFERENCE}}       — item reference / PO or "—"\n'
  || E'  {{TASK_ID}}              — task id (e.g. INSP-62391-1)\n'
  || E'  {{TASK_TYPE}}            — INSP / ASM / REPAIR / etc.\n'
  || E'  {{TASK_STATUS}}          — Open / In Progress / Completed / Cancelled\n'
  || E'  {{TASK_RESULT_SUFFIX}}   — " (Fail)" / " (Pass)" or empty\n'
  || E'  {{DEEP_LINK}}            — query-param URL: /#/tasks?open=<taskId>&client=<tenant_id>\n\n'
  || E'Recipients: NOTIFICATION_EMAILS (Edge Function secret, comma-separated). Edit there to change the office distribution list without touching this row.',
  'NOTIFICATION_EMAILS',
  'task',
  TRUE
)
ON CONFLICT (template_key) DO NOTHING;
