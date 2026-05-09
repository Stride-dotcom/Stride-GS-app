-- TASK_CLIENT_NOTE — rewrite body + subject to use entity-agnostic tokens.
--
-- The template now serves both 'task' and 'repair' acceptance/comment
-- events (see notify-task-client-note edge function). Previously every
-- field was named TASK_* — for repair events that produced lines like
-- "Task RPR-12345 (Repair)" with a "Task" row label, which read as
-- confusing nonsense.
--
-- New token vocabulary (set by the edge function per route):
--   {{ENTITY_LABEL}}        — "Task" or "Repair" (capitalized)
--   {{ENTITY_LABEL_LOWER}}  — "task" or "repair" (for inline prose)
--   {{ENTITY_ID}}           — the task_id or repair_id
--   {{ENTITY_TYPE_DETAIL}}  — INSP/ASM/etc. for tasks, "Repair" for repairs
--   {{ENTITY_STATUS}}       — Open / In Progress / Completed / Failed / etc.
--   {{ENTITY_RESULT_SUFFIX}} — " (Fail)" / " (Failed)" / "" — appended to
--                             the status row when the entity has a separate
--                             pass/fail dimension worth surfacing
--
-- The legacy TASK_* names are dropped; the edge function emits ENTITY_*
-- in v3. Subject + body + notes column all replaced; the recipients
-- ('NOTIFICATION_EMAILS'), category ('task' — kept for back-compat),
-- and active flag stay as-is.

UPDATE public.email_templates
SET
  subject = '🔔 {{NOTE_KIND}} on {{ENTITY_TYPE_DETAIL}} {{ENTITY_ID}} — {{CLIENT_NAME}} (Item {{ITEM_ID}})',
  body =
    E'<div style="font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', sans-serif; max-width: 640px; color: #111;">\n'
    || E'  <div style="background: #E85D2D; color: #fff; padding: 16px 24px; border-radius: 8px 8px 0 0;">\n'
    || E'    <h2 style="margin: 0; font-size: 18px;">{{NOTE_KIND}} from {{CLIENT_NAME}}</h2>\n'
    || E'    <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">{{ENTITY_LABEL}} {{ENTITY_ID}} · Item {{ITEM_ID}}</div>\n'
    || E'  </div>\n'
    || E'  <div style="border: 1px solid #E5E7EB; border-top: 0; padding: 20px 24px; border-radius: 0 0 8px 8px; background: #fff;">\n'
    || E'    <p style="margin-top: 0; font-size: 14px;"><strong>{{AUTHOR_NAME}}</strong> posted a note on this {{ENTITY_LABEL_LOWER}} at {{NOTE_TIME}}.</p>\n'
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
    || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">{{ENTITY_LABEL}}</td><td style="padding:6px 0;">{{ENTITY_ID}} ({{ENTITY_TYPE_DETAIL}})</td></tr>\n'
    || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">{{ENTITY_LABEL}} status</td><td style="padding:6px 0;">{{ENTITY_STATUS}}{{ENTITY_RESULT_SUFFIX}}</td></tr>\n'
    || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">Note time</td><td style="padding:6px 0;">{{NOTE_TIME}}</td></tr>\n'
    || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">Author</td><td style="padding:6px 0;">{{AUTHOR_NAME}} (client)</td></tr>\n'
    || E'    </table>\n'
    || E'\n'
    || E'    <div style="text-align:center; margin: 24px 0;">\n'
    || E'      <a href="{{DEEP_LINK}}" style="display:inline-block; padding:12px 28px; background:#E85D2D; color:#fff; text-decoration:none; border-radius:6px; font-weight:600;">Open {{ENTITY_LABEL}} in MyStrideHub</a>\n'
    || E'    </div>\n'
    || E'\n'
    || E'    <p style="color:#6B7280; font-size:11px; margin-bottom:0; text-align:center;">You''re receiving this because you''re on the office NOTIFICATION_EMAILS list.</p>\n'
    || E'  </div>\n'
    || E'</div>',
  notes =
    E'Office alert when a client posts a note on a task or a repair. Fired by the notify-task-client-note edge function (entity-agnostic in v3+).\n\n'
    || E'Tokens:\n'
    || E'  {{NOTE_KIND}}             — "Acceptance" (system note) or "Comment"\n'
    || E'  {{CLIENT_NAME}}           — display name of the client/tenant\n'
    || E'  {{AUTHOR_NAME}}           — who posted the note\n'
    || E'  {{NOTE_BODY}}             — the note content (whitespace preserved)\n'
    || E'  {{NOTE_TIME}}             — readable timestamp (Pacific)\n'
    || E'  {{ITEM_ID}}               — inventory item id\n'
    || E'  {{ITEM_DESCRIPTION}}      — item description\n'
    || E'  {{ITEM_SIDEMARK}}         — item sidemark or "—"\n'
    || E'  {{ITEM_REFERENCE}}        — item reference / PO or "—"\n'
    || E'  {{ENTITY_LABEL}}          — "Task" or "Repair"\n'
    || E'  {{ENTITY_LABEL_LOWER}}    — "task" or "repair"\n'
    || E'  {{ENTITY_ID}}             — task_id or repair_id\n'
    || E'  {{ENTITY_TYPE_DETAIL}}    — INSP/ASM/etc. for tasks, "Repair" for repairs\n'
    || E'  {{ENTITY_STATUS}}         — Open / In Progress / Completed / Failed / etc.\n'
    || E'  {{ENTITY_RESULT_SUFFIX}}  — " (Fail)" / " (Failed)" / ""\n'
    || E'  {{DEEP_LINK}}             — query-param URL: /#/tasks?open=… or /#/repairs?open=… with &client=<tenant>\n\n'
    || E'Recipients: NOTIFICATION_EMAILS (Edge Function secret, comma-separated). Edit there to change the office distribution list without touching this row.',
  updated_at = now()
WHERE template_key = 'TASK_CLIENT_NOTE';
