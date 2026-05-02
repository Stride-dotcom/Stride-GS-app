# GAS → Supabase Migration — Handoff Doc

> **Read this first** if you're picking up the migration work. Written
> 2026-05-02 PST. Updated as work progresses (each session that
> advances the migration should add a "Status" line at the top + bump
> the scoreboard).

---

## TL;DR for the next session

**Goal:** Justin (Stride Logistics owner) wants to leave GAS + Google
Sheets entirely. Run the whole app on **Supabase + GitHub Pages**, with
**Resend** for transactional email and edge functions for any
server-side work. Move one slice at a time, never break production.

**Where we are right now (2026-05-02, late afternoon):**
- ✅ Email pipeline shipped (PR #168) + 3 templates migrated in earlier
  session (PRs #169, #170, #172) + 3 more this session (PRs #174-176).
- ✅ Recipient-token resolver — staff/admin/notification audiences
  expand from `email_templates.recipients` automatically.
- ✅ `notify-new-order` + `notify-public-request` no longer call GAS
  sendRawEmail — both delegate to `send-email`.
- ✅ New `send-onboarding-email` edge function for the admin Resend
  Onboarding flow (Settings → Users).
- ✅ CLAIM_STAFF_NOTIFY now fires React-side from CreateClaimModal.
  GAS handler stripped (StrideAPI.gs v38.111.0).
- ⏭️ Next batch: claim status emails (CLAIM_RECEIVED + CLAIM_DENIAL +
  CLAIM_MORE_INFO + CLAIM_SETTLEMENT), order state emails
  (ORDER_REJECTED + ORDER_REVISION_REQUESTED), then the cleanup PR
  that deletes dead GAS handlers.
- ⏳ Billing engine port to Postgres is the **largest** future phase
  and gates retiring GAS entirely. Not started; needs shadow-test
  infra first (planned, not built).

**Most important architectural decisions made:**
- Sender: `Stride Logistics <notifications@mystridehub.com>` (verified
  Resend domain). DO NOT change this without re-doing DNS verification.
- Reply-To: `whse@stridenw.com` (default; per-call override allowed).
  Auto-forwards to email@stridenw.com via existing Wix mail rule.
- Domain `stridenw.com` is on Wix and was hard to configure for
  sending — that's why we use mystridehub.com as the From domain.
- DKIM/SPF: live in Hostinger DNS for mystridehub.com. Apex SPF was
  briefly broken (dual SPF records — PermError) and fixed
  2026-05-02. Don't add MX/TXT records to apex without checking
  Resend's domain page first.
- Idempotency keys are mandatory for any user-triggered email so
  double-clicks don't double-send.

---

## Repository pointers

- **Repo:** https://github.com/Stride-dotcom/Stride-GS-app
- **Local clone (canonical):** `C:\dev\Stride-GS-app` (NOT in Dropbox —
  Dropbox sync corrupts git)
- **Branch model:** all work on `source` via squash-merged PRs. NEVER
  commit directly to `source`. Branches: `feat/email/...`,
  `feat/fix/...`, etc. See `CLAUDE.md` "CRITICAL: Branching Rules."
- **Deploy:** `npm run deploy -- "msg"` from `stride-gs-app/` after
  merging to source. Builds + pushes `dist` to GitHub Pages.
- **Supabase project:** `uqplppugeickmamycpuz`
- **GitHub Pages live URL:** https://www.mystridehub.com

---

## Migration Scoreboard (emails)

| # | PR | Template / Subject | Status | Notes |
|---|----|---|---|---|
| 0 | [#168](https://github.com/Stride-dotcom/Stride-GS-app/pull/168) | (infra) `send-email` edge function + `email_sends` log | ✅ Live | The foundation. |
| 1 | [#169](https://github.com/Stride-dotcom/Stride-GS-app/pull/169) | `CLIENT_INTAKE_INVITE` | ✅ Live | Settings → Intakes → Send Invitation. Modal-edit path. |
| 2 | [#170](https://github.com/Stride-dotcom/Stride-GS-app/pull/170) | `INTAKE_RECEIPT_CLIENT` | ✅ Live | Auto + manual receipt to prospect after intake submit. |
| 2.1 | [#171](https://github.com/Stride-dotcom/Stride-GS-app/pull/171) | (rate fix in intakeReceipt helper) | ✅ Live | Updated $300 floor → $30 to match 2026-05-01 insurance rate change. |
| 3 | [#172](https://github.com/Stride-dotcom/Stride-GS-app/pull/172) | `INTAKE_SUBMITTED` + recipient-token resolver | ✅ Live | Foundational — unblocks every staff-broadcast template. |
| 4 | [#174](https://github.com/Stride-dotcom/Stride-GS-app/pull/174) | `ORDER_REVIEW_REQUEST` + `PUBLIC_REQUEST_ALERT` + `PUBLIC_REQUEST_CONFIRMATION` | ✅ Live | `notify-new-order` + `notify-public-request` edge functions now delegate to `send-email` instead of GAS sendRawEmail. Idempotency by orderId. |
| 5 | [#175](https://github.com/Stride-dotcom/Stride-GS-app/pull/175) | `ONBOARDING_EMAIL` (resend path) | ✅ Live | New `send-onboarding-email` edge function resolves user→client→tokens in Supabase. Settings → Users → Resend Onboarding. GAS handler retained for activation/temp-password path. |
| 6 | [#176](https://github.com/Stride-dotcom/Stride-GS-app/pull/176) | `CLAIM_STAFF_NOTIFY` | ✅ Live | Fires React-side from CreateClaimModal after postCreateClaim succeeds. GAS-side send stripped (StrideAPI.gs v38.111.0, deployment v422). |

### Still on GAS (handlers untouched, React still calls them via apiPost):

The following templates still send via GAS. Each one is a small
React-side migration once the resolver pattern is in place (which it
now is).

| Template | Trigger | Recipients | Effort |
|----------|---------|------------|--------|
| `CLAIM_RECEIVED` / `CLAIM_DENIAL` / `CLAIM_MORE_INFO` / `CLAIM_SETTLEMENT` | Claim status changes | Single (claimant email) | Small batch (~1h) |
| `ORDER_REJECTED` / `ORDER_REVISION_REQUESTED` | Order state changes | Single (client email) | Small (note: `notify-order-revision` edge function may already exist; check before duplicating) |
| `ONBOARDING_EMAIL` (activation/temp-password path) | New client activation, password reset | Single | Larger — handler issues temp password + applies credentials-block fallback. Resend path is already migrated via `send-onboarding-email`. |
| `INSP_EMAIL` | Inspection task completed (Pass/Fail) | Single (client email) | **Large — needs feature flag.** Coupled to GAS billing-write flow. |
| `ACCOUNT_REFRESH_INVITATION` | Admin requests client account refresh | Single | Small |
| `INTAKE_RECEIPT_CLIENT` (legacy GAS path) | (already migrated; GAS handler still exists but unused) | — | (cleanup) |
| `CLIENT_INTAKE_INVITE` (legacy GAS path) | (already migrated; GAS handler still exists but unused) | — | (cleanup) |

After 3-4 more migrations, do a **cleanup PR** that deletes the dead
GAS handlers (`sendIntakeInvitation`, `emailSignedAgreement`,
`notifyIntakeSubmitted`, plus router cases). Don't delete earlier or
we lose rollback capability.

---

## How to migrate a new email handler (the recipe)

For any GAS-side `apiFetch('sendXEmail', ...)` or `apiPost('sendX', ...)`:

1. **Find the GAS handler** in `AppScripts/stride-api/StrideAPI.gs`.
   Look for `case "actionName":` in the router (~line 6000+) and the
   handler function it calls (`handleSendXEmail_` or similar).
2. **Identify the template tokens** the handler computes. Move that
   computation into React. If non-trivial (insurance rate, formatted
   dates, ID derivations, etc.), put it in a small helper file under
   `src/lib/` named after the email type
   (e.g. `src/lib/intakeReceipt.ts` for `INTAKE_RECEIPT_CLIENT`).
3. **Identify the recipients:**
   - Single recipient (client/prospect) → React passes `to` directly
   - Staff/admin broadcast → leave `to` undefined; the edge function
     reads `email_templates.recipients` for the templateKey and
     resolves tokens (`{{STAFF_EMAILS}}`, etc.). See "Recipient
     resolver" below.
4. **Replace the React call** with:
   ```ts
   import { sendEmail } from '../lib/email';
   const result = await sendEmail({
     templateKey: 'TEMPLATE_KEY',
     to: recipientEmail,         // omit for staff broadcasts
     tokens: { TOKEN_NAME: value, ... },
     subjectOverride: '...',     // optional — usually template wins
     htmlOverride: bodyHtml,     // optional — for modal-edit paths only
     idempotencyKey: 'send-x:<entity-id>',  // mandatory for user-triggered
     relatedEntityType: 'task',
     relatedEntityId: task.id,
   });
   if (!result.ok) { /* show inline error, don't throw */ }
   ```
5. **Leave the GAS handler in place** for now. No React caller invokes
   it after the swap. It'll be deleted in a future cleanup PR.
6. **Test:** typecheck + build, then live test by triggering the email
   in the app once. Verify the `email_sends` table row.
7. **Branch + PR + merge + deploy** per CLAUDE.md rules.

### Recipient resolver — supported tokens

The `send-email` edge function (`supabase/functions/send-email/index.ts`)
exposes a `resolveRecipients()` helper used when caller `to` is
omitted. It reads `email_templates.recipients` (comma-separated) and
expands tokens against canonical Supabase sources:

| Token (both `{{X}}` and bare `X` accepted) | Resolves to |
|---|---|
| `STAFF_EMAILS` | `profiles.email` WHERE `role IN ('admin','staff') AND is_active = true` |
| `ADMIN_EMAILS` | Same as above filtered to `role = 'admin'` |
| `NOTIFICATION_EMAILS` | Edge Function secret `NOTIFICATION_EMAILS`, comma-split |
| `PUBLIC_FORM_SETTINGS` | `public_form_settings.alert_emails` (jsonb array) |

Unknown tokens are dropped (logged at warn). Final list deduped
case-insensitively. Empty resolution returns 400 with a descriptive
error rather than a silent no-op send.

---

## The `send-email` edge function — full architecture

**Location:** `stride-gs-app/supabase/functions/send-email/index.ts`
**Currently deployed version:** v4 (status=ACTIVE)
**Required Edge Function secrets** (Supabase Dashboard → Edge Functions
→ Secrets):
- `RESEND_API_KEY` — set 2026-05-02. Resend "Sending access" key named
  `stride-gs-app-prod`.
- `NOTIFICATION_EMAILS` — comma-separated staff emails (already used
  by `notify-new-order`)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` —
  auto-provisioned by Supabase

**Pipeline:**
1. Parse + validate `templateKey`
2. Resolve caller from JWT for `triggered_by` audit
3. Idempotency short-circuit (return existing `sent` row if
   `idempotency_key` matches)
4. Fetch template (subject, body, recipients) from `email_templates`
5. Resolve recipient list — caller `to` wins, else expand
   `template.recipients`
6. Token-substitute `{{KEY}}` in subject + body (override-aware)
7. Insert pending row in `email_sends`
8. POST to Resend `/emails` with List-Unsubscribe headers
9. Update `email_sends` row to `sent` (with resend_email_id) or
   `failed` (with error)

**Constants:**
- `FROM = 'Stride Logistics <notifications@mystridehub.com>'`
- `DEFAULT_REPLY_TO = 'whse@stridenw.com'`
- `UNSUBSCRIBE_MAILTO = 'unsubscribe@stridenw.com'`

---

## React wrapper

**Location:** `stride-gs-app/src/lib/email.ts`

Single function `sendEmail(params)` that calls the edge function via
`supabase.functions.invoke`. Returns `{ ok, id, resendEmailId, deduped?, error? }`.

Type definition is the source of truth for what params are supported.

---

## `email_sends` audit table

Migration: `stride-gs-app/supabase/migrations/20260502000000_email_sends_log.sql`

One row per send attempt. Columns: `template_key`, `to_emails[]`,
`reply_to`, `subject`, `status` (pending|sent|failed),
`resend_email_id`, `error_message`, `tokens` (jsonb),
`idempotency_key` (UNIQUE), `triggered_by` (uuid),
`triggered_by_email`, `related_entity_type`, `related_entity_id`,
`tenant_id`, `sent_at`, `created_at`.

RLS: admin/staff see all; clients see own-tenant rows; service_role
writes only.

---

## Sender + reply DNS state (Hostinger DNS for mystridehub.com)

**Don't change without checking Resend's records page first
(https://resend.com/domains).**

Current correct state (verified 2026-05-02):
- `TXT @ v=spf1 include:_spf.mail.hostinger.com ~all` — Hostinger
  inbound mail SPF
- `TXT _dmarc v=DMARC1; p=none` — DMARC monitor mode
- `TXT resend._domainkey [DKIM key]` — Resend DKIM (long base64)
- `MX @ feedback-smtp.us-east-1.amazonses.com priority 10` — leftover
  from initial Resend setup, technically misplaced (should be on
  `send.` subdomain). Not currently a problem because Resend's send
  path uses its own infra, but worth cleaning up if anyone redoes the
  Resend domain config.
- Hostinger MX records (`mx1`, `mx2.hostinger.com`) — for inbound mail
  to `@mystridehub.com` (currently no real mailboxes, but kept).

Resend's domain page shows `MX send` and `TXT send` as "Verified" but
those records don't actually exist in DNS — Resend's verification
seems to have accepted the equivalent records on apex. Fine in
practice; would be nice to clean up someday.

---

## Bigger picture — what else needs to leave GAS

**Already on Supabase (writes go React → Supabase direct):**
- `entity_notes` (notes), `item_photos`, `documents` (Storage),
  `service_catalog`, `email_templates`, `messages`,
  `conversations`, `message_recipients`, `in_app_notifications`,
  `profiles`, `cb_users`, `locations`, all DT tables
- Photos + price list + email templates + messaging are fully
  Supabase-native.

**Still GAS-authoritative (writes go React → GAS → Sheet → Supabase mirror):**
- Inventory items
- Tasks
- Repairs
- Will Calls
- Shipments
- Billing Ledger (per-client + Consolidated)
- Per-client Settings + Master Price List Class_Map
- Client onboarding (creates a per-client sheet from template)

**Still GAS-only (no Supabase equivalent yet):**
- Email send via `MailApp` (being migrated — see scoreboard)
- Invoice + statement PDFs (Google Doc template flows)
- QuickBooks export (CSV → Drive)
- Storage charge monthly cron (Apps Script time trigger)
- Drive folder creation per shipment/repair/task
- Apps Script `onEdit` triggers + sheet rollouts

### Recommended order (longer term)

1. **Finish the email migrations** (current work) — every handler off
   `MailApp` onto the `send-email` edge function. ~6 more PRs.
2. **Delete the dead GAS email handlers** (cleanup PR) once 3-4 are
   confirmed solid in production.
3. **Invoice + statement PDFs to client-side HTML+print or
   server-side puppeteer.** The `WORK ORDER` button work earlier in
   this session set the pattern (`window.open` + `document.write` +
   `print()`). Invoices that need email-attachment rendering are
   harder — likely an edge function with @sparticuz/puppeteer or
   browserless.
4. **QuickBooks export** — direct QBO API from an edge function, OR
   edge function generates the CSV and the user downloads from the
   browser (matches current UX).
5. **Storage charge cron** — already on `pg_cron` per the insurance
   billing pattern. Same approach: a daily/weekly Postgres function
   that inserts billing rows. The hard part is feature parity with
   the GAS storage logic.
6. **The big one — billing engine port to Postgres.** This is the
   boss fight. Current GAS billing has ~70 service-code rules.
   Approach: shadow-mode, run both engines on every event, diff in a
   `billing_parity_runs` table for ≥1 month before flipping per
   service-code. **Don't start without first standing up the parity
   harness** (small, ~3-5 days). Then port code-by-code with feature
   flags.
7. **Per-entity write migration (Tasks, Repairs, Will Calls,
   Shipments, Inventory).** Each entity becomes a Postgres RPC for
   creates/updates. React swaps `apiFetch('createX', ...)` →
   `supabase.rpc('create_x', ...)`. Order: smallest write surface
   first (Tasks). Inventory last (most-touched).
8. **Drive folder retirement.** Photos already in Supabase Storage;
   documents already in Supabase Storage. Stop creating new Drive
   folders. One-time backlog migration of old Drive contents into
   Supabase Storage (rolling).
9. **Onboarding without a sheet.** New client = INSERT INTO clients
   + edge function for Auth admin ops + Resend welcome email. Drop
   the per-client sheet template entirely.
10. **Retire `StrideAPI.gs`.** Once nothing in `apiFetch` is called,
    the GAS web app archives. Sheets become read-only history.

---

## Realtime + detail-panel coverage (adjacent recent work)

PR #167 wired entityEvents subscriptions into all 6 entity-detail
hooks (`useTaskDetail`, `useItemDetail`, `useRepairDetail`,
`useWillCallDetail`, `useShipmentDetail`, `useOrderDetail`). Now any
entity update from any tab/user surfaces in open detail panels within
~1-2s. The list-hook side has been wired since session 71/72.

The central realtime channel is in `src/hooks/useSupabaseRealtime.ts`
— mounted once in `AppLayout`. Don't open new Supabase channels for
mirror-table changes; subscribe to `entityEvents` instead.

Also see PR #166 (Notes column cross-entity rollup) and the messaging
rebuild on the conversations model (PRs from sessions 88-89).

---

## User context — Justin

- Owner-operator of Stride Logistics (3PL, Kent WA, ~60 clients)
- Technical enough to follow architecture decisions; doesn't write code
- Trusts you to make calls but expects clear summaries and the option
  to redirect at any decision point
- Strongly prefers small focused PRs with clear blast radius over big
  rewrites
- Cares about the user experience — "we want this app to function as
  any normal whatsapp, imessage, instant message" was a real quote
- Does NOT want to ship things that lose data, even briefly

When picking up: lead with "here's what's done, here's what's next, do
you want me to keep going or change direction?" Don't dump the entire
plan unless asked.

---

## Conventions to follow

- Branch naming: `feat/email/...`, `feat/fix/...`, `feat/clients/...`
- PR title format: `feat(email): description` / `fix(scope): description`
- Commit messages: imperative mood, longer body explaining *why*
- Never skip `tsc --noEmit` + `npm run build` before commit
- Update `BUILD_STATUS.md` + `_archive/Docs/Archive/Session_History.md`
  at end of each session per CLAUDE.md
- Co-Authored-By footer: `Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- Always provide a Test Plan section in PR descriptions

---

## Known gotchas

1. **Don't put files in Dropbox.** The local clone MUST be at
   `C:\dev\Stride-GS-app`. Dropbox sync corrupts git.
2. **`gh pr merge --squash --delete-branch`** is the only merge form
   used.
3. **Edge function secrets** are NOT set via SQL or MCP — they go in
   Supabase Dashboard → Edge Functions → Secrets, OR via Supabase CLI
   (`supabase secrets set`). The CLI isn't installed locally; use the
   Dashboard.
4. **Realtime on Supabase + UUID column filters is unreliable.** Use
   broad subscriptions and filter client-side (the messaging rebuild
   doc explains this in detail).
5. **The intake template's design** is in `email_templates.body` —
   editable from Settings → Email Templates → INTAKE_RECEIPT_CLIENT
   in the app. Justin asked about this 2026-05-02. The HTML is dated
   ("old style design" per his note); refresh visual treatment is a
   nice-to-have not blocking.
6. **First send of any new email type may go to spam** for that
   recipient (no prior trust signal). One "Not Spam" + send #2 lands
   inbox.
7. **`@mystridehub.com` has DKIM/SPF/DMARC + List-Unsubscribe headers
   set** — don't strip those. Adding new templates doesn't require
   re-doing DNS.
8. **`stridenw.com` is on Wix and is hard to add as a sender domain.**
   We tried in this session and bailed. Use mystridehub.com for From,
   stridenw.com for Reply-To via the existing whse@stridenw.com inbox
   that auto-forwards.

---

## Open questions to ask the user when ready

- Want me to do the next batch (`CLAIM_STAFF_NOTIFY` +
  `ORDER_REVIEW_REQUEST` + `PUBLIC_REQUEST_ALERT` in one PR)?
- Or pivot to `ONBOARDING_EMAIL` (single template, modal-edit path)?
- Or pause emails and start the billing-parity harness scaffold?
- Should we redesign the `INTAKE_RECEIPT_CLIENT` template body? (User
  flagged "old style design" 2026-05-02 — confirmed it's editable in
  Settings → Email Templates.)

---

## Quick verify on next session start

```bash
# 1. Are we on the right repo + on source?
cd /c/dev/Stride-GS-app && git status && git log --oneline -5

# 2. Anything not yet pulled from origin?
git fetch origin source && git log HEAD..origin/source --oneline

# 3. Edge function still ACTIVE?
# (Use Supabase MCP execute_sql or check dashboard:
#  https://supabase.com/dashboard/project/uqplppugeickmamycpuz/functions)

# 4. Quick send test (replace email + bump idempotency key):
curl -sS -X POST 'https://uqplppugeickmamycpuz.supabase.co/functions/v1/send-email' \
  -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"templateKey":"ACCOUNT_REFRESH_INVITATION","to":"email@stridenw.com","subjectOverride":"handoff smoke test","idempotencyKey":"handoff-smoke-YYYYMMDD-001","tokens":{"CLIENT_NAME":"Test"}}'
# Expect: {"ok":true,"id":"<uuid>","resendEmailId":"<uuid>"}
```

If anything's broken, check Supabase Edge Function logs first. The
function logs every error to console; surface them via the dashboard's
log viewer.

---

End of handoff doc. Update the scoreboard + status TL;DR in this file
when you ship more migrations.
