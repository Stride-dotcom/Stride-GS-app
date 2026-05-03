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

**Where we are right now (2026-05-02, late EOD — superseded by sessions 91+):**
- ✅ **Session 91 (perf sweep)** shipped 6 PRs fixing per-cell `setValue` antipattern across the GAS surface — all bulk-write operations now <5 sec regardless of batch size. PR [#188](https://github.com/Stride-dotcom/Stride-GS-app/pull/188) handleCancelWillCall_, [#190](https://github.com/Stride-dotcom/Stride-GS-app/pull/190) api_writeThrough_ batch (4 batch handlers + new resyncEntitiesBatchToSupabase_ — Supabase mirror is now batched too), [#191](https://github.com/Stride-dotcom/Stride-GS-app/pull/191) Class C handlers (start-task / complete-task / complete-repair), [#194](https://github.com/Stride-dotcom/Stride-GS-app/pull/194) bulk-cancel-WCs cascade. PRs #186 + #187 (release-items, invoice-commit) earlier in the day were the production fires that triggered the sweep. GAS now at v38.143.1 / Web App **v431**.
- ✅ **Session 91 (process)** added per-builder worktree convention to CLAUDE.md ([#197](https://github.com/Stride-dotcom/Stride-GS-app/pull/197)) — `git worktree add -b ... source` per topic. Two HEAD-stomp incidents during this very session validated the need.
- ✅ **Billing-page audit (2026-05-02) PR 1+2+3 all done.** PR [#183](https://github.com/Stride-dotcom/Stride-GS-app/pull/183) seed INSURANCE row, PR [#185](https://github.com/Stride-dotcom/Stride-GS-app/pull/185) services filter from Supabase, PR [#200](https://github.com/Stride-dotcom/Stride-GS-app/pull/200) Category MultiSelectFilter narrows Service dropdown reactively. The audit's open backlog is just the `billing_parity_log` 4% mismatch triage (gating the billing-engine port).
- ✅ **Other parallel work shipped today:** [#189](https://github.com/Stride-dotcom/Stride-GS-app/pull/189) storage charges Postgres RPC + GAS commit-rows write-only (progress on long-term step 5), [#192](https://github.com/Stride-dotcom/Stride-GS-app/pull/192) separate_by_sidemark fix, [#193](https://github.com/Stride-dotcom/Stride-GS-app/pull/193)+[#195](https://github.com/Stride-dotcom/Stride-GS-app/pull/195) task add-on services, [#196](https://github.com/Stride-dotcom/Stride-GS-app/pull/196)+[#198](https://github.com/Stride-dotcom/Stride-GS-app/pull/198)+[#199](https://github.com/Stride-dotcom/Stride-GS-app/pull/199) BillingPreviewCard / BillingCalculator port.

**Where session 90 left it (kept for context):**
- ✅ Session 90 shipped 9 PRs (#174–#182). GAS at v38.121.0 / Web App v424.
- ✅ Every email handler that doesn't need temp-password generation or
  attachments is now off GAS MailApp. All sends route through
  `send-email` → Resend.
- ✅ `notify-new-order`, `notify-public-request`, `notify-order-revision`
  refactored to delegate sends to `send-email` (no more GAS sendRawEmail).
- ✅ React-side fires for CLAIM_STAFF_NOTIFY, CLAIM_RECEIVED,
  CLAIM_MORE_INFO, CLAIM_DENIAL, ACCOUNT_REFRESH_INVITATION.
- ✅ New edge function `send-onboarding-email` for the admin Resend
  Onboarding flow.
- ✅ Cleanup PR removed ~383 lines of dead GAS handlers + matching
  React API wrappers (PR #181).
- ✅ `send-email` now supports `attachments` (PR #182) — unblocks the
  next two big migrations.
- ⏭️ Remaining migrations are larger and need attention:
    1. **INSP_EMAIL** — fires inside GAS task-completion handler;
       attaches Work Order PDF currently on Drive. Needs PDF source
       solved (Drive → Supabase Storage, OR GAS posts base64 to send-email).
    2. **ONBOARDING_EMAIL activation/temp-password path** — issues
       temp passwords + credentials-block fallback. Resend path
       already migrated; the credential-issuing path stays for now.
    3. **CLAIM_SETTLEMENT** — server-generated PDF attachment, same
       Drive-source issue as INSP_EMAIL.
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
| 6 | [#176](https://github.com/Stride-dotcom/Stride-GS-app/pull/176) | `CLAIM_STAFF_NOTIFY` | ✅ Live | Fires React-side from CreateClaimModal after postCreateClaim succeeds. GAS-side send stripped. |
| 7 | [#178](https://github.com/Stride-dotcom/Stride-GS-app/pull/178) | `CLAIM_RECEIVED` + `CLAIM_MORE_INFO` + `CLAIM_DENIAL` | ✅ Live | CreateClaimModal + ClaimDetailPanel fire after their respective postX calls. GAS-side sends stripped. |
| 8 | [#179](https://github.com/Stride-dotcom/Stride-GS-app/pull/179) | `ORDER_REJECTED` + `ORDER_REVISION_REQUESTED` | ✅ Live | `notify-order-revision` edge function delegates to send-email. Idempotency `${action}:${orderId}`. |
| 9 | [#180](https://github.com/Stride-dotcom/Stride-GS-app/pull/180) | `ACCOUNT_REFRESH_INVITATION` | ✅ Live | Settings → Clients → Send Refresh Link. Modal-edit override path. |
| 10 | [#181](https://github.com/Stride-dotcom/Stride-GS-app/pull/181) | (cleanup) — dead GAS handlers + React wrappers | ✅ Live | ~383 lines retired: sendIntakeInvitation, notifyIntakeSubmitted, sendOnboardingToUsers, emailSignedAgreement. StrideAPI.gs v38.121.0 / Web App v424. |
| 11 | [#182](https://github.com/Stride-dotcom/Stride-GS-app/pull/182) | (infra) `send-email` attachments support | ✅ Live | Optional `attachments` array forwarded 1:1 to Resend. Unblocks INSP_EMAIL + CLAIM_SETTLEMENT. v5 deployed. |

### Still on GAS

The remaining handlers are non-trivial — they involve PDF attachments
sourced from Drive, server-side credential issuance, or are coupled
to billing writes. They need their own design pass.

| Template | Trigger | Recipients | Why it's not done |
|----------|---------|------------|---|
| `INSP_EMAIL` | Inspection task completed (Pass/Fail) | Client + notification list | Fires inside the GAS task-completion handler that also writes billing rows. Attaches Work Order PDF from the Drive task folder. Migration needs: (a) move email fire to React after task-completion succeeds, (b) source the Work Order PDF (Drive→Storage migration OR GAS posts base64 to send-email). PDF infra is now in place (PR #182) — design pass needed for PDF source. |
| `CLAIM_SETTLEMENT` | Settlement generated | Single (claimant) | Attaches server-generated settlement PDF (api_generateSettlementPdf_). Same Drive-source problem as INSP_EMAIL. PR #182 made the attachment path possible; PDF source is still GAS. |
| `ONBOARDING_EMAIL` (activation / temp-password path) | New client activation, admin set-password | Single (user) | Handler generates a random temp password and applies a styled credentials-block fallback when the template doesn't include `{{TEMP_PASSWORD}}`. Migration touches credential-issuance, which is sensitive. Resend path is already migrated via `send-onboarding-email`. |

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

## 📋 Billing-page audit (added 2026-05-02 after Justin questions)

Justin asked why insurance was missing from the Billing → Report Service
filter dropdown, how insurance was being invoiced if auto-added monthly,
and whether the filter could support category + service combos. Audit
surfaced three actionable items + one significant discovery.

### PR 1 ✅ — INSURANCE row seeded in service_catalog

`service_catalog` was missing the `INSURANCE` row entirely. The
2026-05-01 rate-change migration tried to UPDATE it but no row
existed — silent no-op. The cron `insurance_bill_due()` writes
billing rows with `svc_code='INSURANCE'` monthly, but those rows
couldn't be filtered by name in any UI surface since the row didn't
exist in service_catalog.

Migration `20260502130000_seed_insurance_service_catalog.sql` seeds
the row idempotently. Already in source via PR #183; live DB row
verified.

### PR 2 ✅ — Billing services filter reads from Supabase

Shipped via PR [#185](https://github.com/Stride-dotcom/Stride-GS-app/pull/185). `Billing.tsx` swapped `usePricing` (GAS-backed) → `useServiceCatalog` (Supabase-native). New services added via Settings → Pricing now show up in the Report tab's Service filter immediately, INSURANCE is filterable (depended on PR 1's seed), and the page drops one GAS round-trip on every load.

### PR 3 ✅ — Category + service combo filter

Shipped via PR [#200](https://github.com/Stride-dotcom/Stride-GS-app/pull/200). Added a `Category` `MultiSelectFilter` between `Sidemark` and `Service` on the Billing → Report tab. Selecting categories reactively narrows the Service dropdown — `SVC_OPTIONS_FOR_FILTER` filters `NON_STOR_SERVICES` by `s.category ∈ rptCategoryFilter`, with a `useEffect` that drops service selections that fall out of view when categories change (no ghost selections). `BillingFilterParams.categoryFilter?: string[]` flows through both the Supabase path (`.in('category', filters.categoryFilter)`) and the GAS path (URL param; handler may ignore — Supabase is primary). Filter row order is now: Client | Sidemark | Category | Service | Status.

`billing.category` is populated on every write and was already in the SELECT, so no schema/data migration was needed.

### 🔍 DISCOVERY — `billing_parity_log` is ALREADY shadow-running

Major finding from this session. The shadow-mode parity infrastructure
described as "future work" in this doc's billing-engine-port section
**already exists and is actively running**.

`public.billing_parity_log` as of 2026-05-02:
- **64,288 rows** of side-by-side rate computations (sheet vs Supabase)
- **Match rate: 95.94%** (61,677 matches / 2,611 mismatches)
- **1,867 of those mismatches are from the last 7 days alone**
- Each row: tenant_id, item_id, svc_code, item_class, sheet_rate,
  supabase_rate, sheet_total, supabase_total, qty, match, delta,
  event_source, billing_ledger_id, created_at

**Implication for migration plan:** the billing-engine port phase is
partially de-risked — dual-computation infra is wired. Before any
flip-to-Supabase-authoritative, **investigate the 4% mismatch**.

Useful starting query:
```sql
-- Mismatch distribution by service code (last 7 days)
SELECT svc_code,
       count(*) AS mismatches,
       ROUND(AVG(ABS(supabase_total::numeric - sheet_total::numeric)), 2) AS avg_delta,
       MAX(ABS(supabase_total::numeric - sheet_total::numeric)) AS max_delta
FROM public.billing_parity_log
WHERE match = false AND created_at > now() - interval '7 days'
GROUP BY svc_code
ORDER BY mismatches DESC;
```

If mismatches concentrate on a few svc_codes → fixable rule-by-rule.
If spread broadly → deeper engine bug. Either way the answer is the
gating question for the eventual cutover.

A **billing parity dashboard** (admin-only Settings tab) would make
this triagable: mismatch list, by-svc-code breakdown, delta histogram,
optional "freeze parity → flip to Supabase authority per svc_code"
admin control once mismatch count hits zero per code. Maybe the next
real billing-related PR after PR 2 + PR 3 land.

---

End of handoff doc. Update the scoreboard + status TL;DR in this file
when you ship more migrations.
