# Locked Decision Source Artifact

- Topic: Consolidate Admin Ops pages (Stripe Ops + Pricing Ops)
- Topic Slug: `ADMIN_OPS_CONSOLIDATION`
- Date: `2026-02-17`
- Chat ID: `bc-6a91388d-c030-4783-bc5f-5a493b5d7301`
- Source Mode: `current_chat`

## Q&A excerpts

### QA-2026-02-17-ADMINOPS-001
User request:
- Consolidate `/admin/stripe-ops` and `/admin/pricing-ops` into one page.
- Make fields/data easier for non-technical users to understand and use.
- Improve layout/navigation; remove “tabbed pages inside of tabbed pages”.
- Prefer one main dashboard page (overview) with multiple tabs/sections.
- Fix Stripe dashboard button behavior: currently shows an error when opening the new page.
- Process requirement: before implementing any changes, ask questions one at a time and log decisions during Q&A; implement only after Q&A is complete.

### QA-2026-02-17-ADMINOPS-002
User clarification:
- The failing button is the "Stripe dashboard" button.
- Error shown: "navigation was blocked by Cross-Origin-Opener-Policy".
- User question: whether they need to provide a Stripe account id to build a Stripe dashboard link.

### QA-2026-02-17-ADMINOPS-003
User clarification:
- The COOP navigation block occurs only when running inside a Lovable preview page.
- When opening the app outside that preview context (normal browser tab on the real domain), the Stripe dashboard link works.

### QA-2026-02-17-ADMINOPS-004
User decision:
- Leave Stripe dashboard links as-is (no special Lovable preview workaround/note).
- Focus efforts on the Stripe Ops + Pricing Ops consolidation and usability redesign.

### QA-2026-02-17-ADMINOPS-005
User decision:
- Access control for the consolidated admin ops page remains `admin_dev` only (do not expand to tenant_admin).

### QA-2026-02-17-ADMINOPS-006
User decision:
- Canonical route for the consolidated SaaS admin ops dashboard will be: `/admin/saas-ops`.

### QA-2026-02-17-ADMINOPS-007
User decision + new request:
- Old routes `/admin/stripe-ops` and `/admin/pricing-ops` can be discarded; only the new consolidated `/admin/saas-ops` will be used.
- User reports `/admin/email-ops` is not visible while logged in as `admin_dev` and requests it be added into `/admin/saas-ops` with the same UX simplicity.

### QA-2026-02-17-ADMINOPS-008
User requirements (Email Ops / Resend):
- Build email management analogous to the platform-managed Twilio SMS approach.
- Use the platform Resend account to support tenant-branded sending so clients can send emails from the app using their own domains.
- Tenant workflow intent: clients update DNS records and fill out fields in the app (self-service) to configure sending.
- Admin intent: “admin/email-ops” capability is for the operator (admin_dev) to ensure Resend is configured correctly to support this for tenants.

### QA-2026-02-17-ADMINOPS-009
User request (tenant-facing email setup UX + AI help):
- Check Settings → Organization → Company Info email settings to align with the new platform-managed Resend system.
- Build/revise tenant email setup fields + guide so non-technical users can set up email sending easily.
- Copy must be in layman’s terms.
- Add a help tool (“i”) that uses an AI prompt (ChatGPT-style) to:
  - Ask the user questions about their domain and/or email/DNS provider.
  - Provide tailored step-by-step DNS setup instructions.

### QA-2026-02-17-ADMINOPS-010
User decision (AI help delivery):
- Do not integrate the in-app AI bot for email setup instructions.
- Instead, provide a copy/paste prompt inside the help tool UI so users can paste it into ChatGPT (or similar) to get tailored step-by-step DNS instructions.

### QA-2026-02-17-ADMINOPS-011
User decision (prompt content):
- The help prompt should be generic (not auto-filled with tenant DNS records).
- The prompt must be detailed enough that ChatGPT asks the user questions about their domain registrar/DNS/email provider and then gives clear step-by-step instructions.

### QA-2026-02-17-ADMINOPS-012
User decision + requirements (email setup UX + Resend sync):
- Replace the existing email sender wizard with a simpler, extremely easy, step-by-step setup UI (single-page preferred).
- Treat the user as non-technical (“a child can figure it out”); use layman’s terms and a guided checklist-like flow.
- Every field should have a help tooltip/icon with simple tips.
- Build/complete the Resend API integration so when tenants enter info, the app syncs with Resend to configure/verify their sending domain (platform-managed Resend account).

### QA-2026-02-17-ADMINOPS-013
User decision (sender identity input):
- Tenant setup will collect the full “From email address” (example: `alerts@yourcompany.com`) rather than only the domain.

### QA-2026-02-17-ADMINOPS-014
User decision (default sender + admin config):
- Tenants who do not configure their own domain will use a platform default sender email.
- The platform default sender email must be configurable by `admin_dev` in the new `/admin/saas-ops` Email section (not hard-coded).

### QA-2026-02-17-ADMINOPS-015
User decision (default sender display name):
- Do not add a separate configurable “From name” field for the platform default sender; keep it as an email address only.

### QA-2026-02-17-ADMINOPS-016
User decision (Reply-To behavior when using platform default sender):
- When a tenant is using the platform default sender, replies should go to the tenant’s configured Reply-To email address (not a platform inbox, and not “no-reply”).

### QA-2026-02-17-ADMINOPS-017
User decision (Reply-To fallback):
- If a tenant has not configured a Reply-To email yet, default Reply-To to the tenant owner/admin login email (not a platform inbox and not blocked).

### QA-2026-02-17-ADMINOPS-018
User decision (Reply-To field + onboarding clarity):
- Tenant email settings should include a separate “Reply-To / inbound email” field so tenants can receive and control where incoming replies go.
- If a tenant has not set up a verified custom sender domain, the UI should clearly state outbound emails will be sent from a platform-managed address like: `"tenantid"@subdomain.stridewms.com` (exact address/domain may be updated later).
- The UI should clearly explain that the tenant must set their Reply-To / inbound email address to receive incoming replies.

### QA-2026-02-17-ADMINOPS-019
User decision (fallback From address is per-tenant):
- If a tenant has not set up a verified custom sender domain, the platform-managed “From” email should be per-tenant (e.g. `"tenantid"@subdomain.stridewms.com`) rather than one global default sender shared by all tenants.

### QA-2026-02-17-ADMINOPS-020
User decision (fallback sender local-part identifier):
- The `"tenantid"` portion of the platform-managed fallback sender email should use a human-friendly tenant code/slug (not UUID, not company name).

### QA-2026-02-17-ADMINOPS-021
User decision (fallback sender domain not finalized yet):
- The app’s domain (and therefore the fallback sender domain/subdomain) has not been picked yet because the product is still in development.
- Do not hardcode a final domain value into code; this should remain configurable and can be set later in admin Email Ops.

### QA-2026-02-17-ADMINOPS-022
User decision (Email Ops config format for fallback sender domain):
- In `/admin/saas-ops` → Email Ops, configure the platform-managed fallback sender as a domain/subdomain value only (example: `mail.yourapp.com`), not as a full pattern like `{tenant_slug}@mail.yourapp.com`.
- The app will generate the full From email automatically as: `{tenant_slug}@<configured_domain>`.

### QA-2026-02-17-ADMINOPS-023
User decision (Email Ops tenant list UX):
- `/admin/saas-ops` → Email Ops will include a tenant list/table view.
- The table must support sorting by tapping/clicking column headers (all columns).
- The table must include a Status column that supports filtering so the operator can quickly view all tenants in a given status (e.g., “pending”, etc.).
- The table must include a search autocomplete dropdown/select to quickly find a tenant by typing (for large tenant counts).

### QA-2026-02-17-ADMINOPS-024
User request (status meanings + builder selection):
- User requests the builder determine which Email Ops statuses matter and what they mean, because the user does not know which statuses are relevant to track.

### QA-2026-02-17-ADMINOPS-025
User decision (table columns):
- In the Email Ops tenant table, separate “Status” from “Sender Type” by using two columns (instead of encoding both concepts into a single Status string).

### QA-2026-02-17-ADMINOPS-026
User decision (Sender Type filter values):
- Email Ops tenant table “Sender Type” filter values should be:
  - Platform sender
  - Custom sender (verified)
  - Custom sender (pending)

### QA-2026-02-17-ADMINOPS-027
User decision (Status filter values):
- Email Ops tenant table Status filter values will be:
  - Ready
  - Pending (waiting on tenant DNS)
  - Action needed (set Reply-To inbox)
  - Warning (deliverability risk)
  - Error (misconfigured)

### QA-2026-02-17-ADMINOPS-028
User decision (status display model):
- Email Ops tenant table should show multiple issue indicators (e.g., “Pending DNS” and “Missing Reply-To”) when applicable.
- Also compute and display a single “overall status” as the worst/most severe of the applicable issues for sorting/filtering.

### QA-2026-02-17-ADMINOPS-029
User decision (issue badge scope):
- Email Ops tenant table should show issue badges for any issues that would prevent a tenant from successfully setting up email.

### QA-2026-02-17-ADMINOPS-030
User decision (warnings as badges):
- Show non-blocking warnings (e.g., deliverability risk like DKIM/SPF incomplete) as badges too.
- Warnings must be visually distinct (yellow) and must not count as “blocked”.

### QA-2026-02-17-ADMINOPS-031
User decision (warning badge list v1):
- Warning badges (deliverability risks) will include:
  - DKIM not verified
  - SPF not verified
- User question: whether those are the only deliverability risks (builder to advise; follow-up decision if expanding the warning list).

### QA-2026-02-17-ADMINOPS-032
User decision (add DMARC warning):
- Add DMARC as a deliverability warning badge in Email Ops (recommended), even if it requires adding a new check/field.

### QA-2026-02-17-ADMINOPS-033
User decision (DMARC warning criteria + badge labels):
- DMARC warning should trigger for both:
  - DMARC missing (no `_dmarc.<domain>` record found)
  - DMARC monitoring-only (record exists but `p=none`)
- DMARC warning should show clearer badge text as two possible badges:
  - “DMARC missing” (higher importance)
  - “DMARC monitoring only (p=none)” (lower importance)

### QA-2026-02-17-ADMINOPS-034
User decision (when to show warnings + tenant UI toggle):
- Only show DKIM/SPF/DMARC warnings if the tenant has opted to use their own email/domain (not the app-provided/platform sender).
- Add a simple checkbox/toggle in tenant email settings (e.g., “Use my own company email/domain”):
  - When checked: show the custom domain setup fields (DNS instructions + verification).
  - When unchecked: hide custom domain fields and show only platform sender info (their platform-created From address) plus the Reply-To/inbound address fields.

### QA-2026-02-17-ADMINOPS-035
User decision (toggle label):
- Use toggle label option 1: “Send emails from my company domain”.

### QA-2026-02-17-ADMINOPS-036
User requirement/clarification (switching back to platform sender):
- If a tenant starts the custom domain setup and then unchecks the toggle (switches back to platform sender), the app should automatically use the platform sender mode.
- Once they set their Reply-To/inbound address, replies should route to that address (no additional setup steps required for the tenant beyond saving the field).

### QA-2026-02-17-ADMINOPS-037
User decision (clearing custom setup on toggle off):
- If the tenant unchecks the toggle (switches back to platform sender), clear the custom-domain setup fields they had entered (rather than keeping them hidden).

### QA-2026-02-17-ADMINOPS-038
User decision (confirmation prompt on toggle off):
- When the tenant toggles off “Send emails from my company domain”, show a confirmation prompt explaining that custom-domain setup fields will be cleared.

### QA-2026-02-17-ADMINOPS-039
User decision (cleanup Resend domain registration on cancel):
- If a tenant starts custom domain setup and we registered the domain with Resend, then the tenant switches back to platform sender, we should remove/cleanup the domain registration in Resend as well (not just stop using it).

### QA-2026-02-17-ADMINOPS-040
User decision (cleanup failures do not block):
- If Resend cleanup/delete fails (API/network error), the tenant must still be able to switch back to platform sender immediately.
- Cleanup is best-effort; failures should be logged and retried later (or surfaced in Email Ops).

### QA-2026-02-17-ADMINOPS-041
User decision (Resend cleanup timing):
- When a tenant cancels custom sender setup, Resend domain cleanup/removal should be handled by a nightly cleanup job (not immediate on toggle-off), to reduce thrash/risk from repeated toggling.

### QA-2026-02-17-ADMINOPS-042
User decision (cleanup job operation):
- The Resend cleanup job should run fully automatically (nightly) without requiring an admin-only manual “run now” button.
- Email Ops may include logs/status for cleanup attempts.

### QA-2026-02-17-ADMINOPS-043
User decision (Cleanup Logs panel):
- Add a Cleanup Logs panel in the admin_dev console page (`/admin/saas-ops`) under Email Ops.
- Show the Cleanup Logs panel by default (simple view of recent cleanup events).

### QA-2026-02-17-ADMINOPS-044
User decision (Cleanup Logs defaults + table UX):
- Cleanup Logs should show failures only by default, with a toggle to show successes.
- Cleanup Logs should display as a table with filters.
- Column headers should be clickable/tappable to sort.
- Ensure client account (tenant/customer) is included as a column, plus any other relevant fields needed for troubleshooting.

### QA-2026-02-17-ADMINOPS-045
User decision (Cleanup Logs placement):
- Show Cleanup Logs within the Email Ops tab/section (not a separate top-level “Ops Logs” tab).

### QA-2026-02-17-ADMINOPS-046
User decision (Subscription Management page scope + capabilities):
- In `/admin/saas-ops`, manage Stripe + pricing under a single operator-friendly area labeled **“Subscription Management”**.
- Subscription Management should make it easy to deploy pricing updates and ensure Stripe billing uses the updated rates.
- Pricing updates should support an **effective date** (launch new rates on a specific date).
- Include tooling to **email all users** about an upcoming pricing change, plus an automated **reminder** right before the change goes live.
- Include a Stripe connectivity/ops area (fields/controls needed to manage Stripe API connectivity, potentially including API key management).
- It would be helpful to view Stripe invoices and a Stripe revenue summary from here, while acknowledging more detailed customer-level breakdowns may still require logging into Stripe directly.

### QA-2026-02-17-ADMINOPS-047
User decision (pricing change scope on effective date):
- When a scheduled pricing change goes live, it applies to **all active subscriptions automatically** (existing customers are moved to the new rates on that date), not just new signups.

### QA-2026-02-17-ADMINOPS-048
User decision (billing cycle alignment + proration policy):
- Configure scheduled price updates to launch on a **new statement period / billing cycle start** so **no proration** is needed for price changes.
- The only time proration is needed is the **first month when a new customer signs up**.
- Monthly subscription charges should be aligned to **calendar months**: bill for each month from the **1st through the last day** of the month.

### QA-2026-02-17-ADMINOPS-049
User decision (seat-change proration policy):
- For tenant staff seat count changes made mid-month, use **immediate proration** for the remainder of the current month (Option 1).

### QA-2026-02-17-ADMINOPS-050
User decision (billing timezone + ledger batching + terms roadmap):
- Use **UTC** for billing month-boundary calculations.
- Do **not** commit/push every decision immediately; batch ledger updates in groups of **20 decisions**.
- After the subscription planning is complete, implement subscription terms that customers must explicitly accept before signup can proceed.
- Make subscription terms editable in the **admin_dev-only** Subscription Management area so terms can be updated later.

### QA-2026-02-17-ADMINOPS-051
User decision (billing model + communications timing):
- Use **anniversary billing** (Stripe-managed) rather than calendar-month billing.
- For pricing changes, default customer communication timing is:
  - initial notice at **30 days** before change,
  - reminder at **3 days** before change.

### QA-2026-02-17-ADMINOPS-052
User decision (price migration timing with anniversary billing):
- Apply new prices per tenant at that tenant’s **next renewal date on or after** the change effective date.

### QA-2026-02-17-ADMINOPS-053
User decision (migration policy + promo capability):
- Existing customers should be migrated automatically (no grandfathering by default).
- Build an admin_dev promo code system that supports configuring promo terms (example: 10% for 3 months) and promo code expiration.

### QA-2026-02-17-ADMINOPS-054
User decision (promo applicability + usage control):
- Promo configuration must include whether a code is for **new customers only** or can be used by **existing customers**.
- Promo configuration must include **maximum usage quantity** (for example, set to 1 to prevent broad sharing).

### QA-2026-02-17-ADMINOPS-055
User decision (tenant-specific promo lock):
- Promo codes should support optional lock/restriction to a specific tenant/account.

### QA-2026-02-17-ADMINOPS-056
User decision (discount scope):
- Default promo behavior should apply discount to **base subscription price only**.
- Promo config should include an optional setting to include **seat charges**.

### QA-2026-02-17-ADMINOPS-057
User decision (discount type options):
- Promo codes must support **both** percent and fixed-amount discount types.

### QA-2026-02-17-ADMINOPS-058
User decision (fixed amount currency):
- Fixed-amount promo discounts are configured in **USD**.

### QA-2026-02-17-ADMINOPS-059
User decision (stacking policy):
- Only **one discount at a time**; promo stacking is not allowed.

### QA-2026-02-17-ADMINOPS-060
User decision (expiration vs duration behavior):
- If redeemed before promo expiration, the customer receives the **full configured duration** even if discount months extend past the code’s redemption deadline.

### QA-2026-02-17-ADMINOPS-061
User decision (duration + concurrent code support):
- Promo duration options should include **one-time**, **N billing cycles**, and **forever**.
- The system should allow **multiple promo codes** to exist concurrently for channel/market targeting.

### QA-2026-02-17-ADMINOPS-062
User decision (promo analytics):
- Subscription Management should include promo analytics including:
  - redemptions count,
  - conversion to paid,
  - total discount given,
  - MRR from redeemed accounts,
  - filters by date/code/channel.

### QA-2026-02-17-ADMINOPS-063
User decision (channel attribution + client-user parity):
- Capture promo attribution using **both** manual channel field and optional UTM-derived metadata.
- Build equivalent metrics tracking for **client-user promo codes** as well.

### QA-2026-02-17-ADMINOPS-064
User decision (shared promo module architecture):
- Implement **one shared promo system module** that both subscriber promos and client-user promos plug into.

### QA-2026-02-17-ADMINOPS-065
User decision (promo application surfaces + billing timing):
- Support promo entry for eligible existing customers in **checkout/plan-change flows** and on the **Billing page**.
- For existing customers applying from Billing, promo effects start at **next renewal** (no mid-cycle adjustment).

### QA-2026-02-17-ADMINOPS-066
User decision (terms acceptance strategy for updates):
- Use **explicit click re-acceptance** for **major legal terms changes**.
- For routine promotions/pricing notices, use continued-use-after-notice model.
- Include continued-use language in Terms accordingly.

### QA-2026-02-17-ADMINOPS-067
User decision (terms system scope):
- Terms must cover full app/legal scope (usage, liability, billing, etc.) for standard ToS protection.
- Store acceptance evidence and show acceptance history in account subscription settings (audit visibility).

### QA-2026-02-17-ADMINOPS-068
User decision (major update campaign control + role scope):
- In admin terms page, add action to send major-terms re-acceptance prompts.
- Initial role scope direction: require acceptance from admin users (not managers/warehouse).

### QA-2026-02-17-ADMINOPS-069
User decision (enforcement mode):
- For required major-terms acceptance, use **hard block** at login until accepted.

### QA-2026-02-17-ADMINOPS-070
User decision (initial accepter + email recipient, later revised):
- Initial direction was creator-admin acceptance requirement plus creator-admin email CTA link.

### QA-2026-02-17-ADMINOPS-071
User decision (revised accepter policy):
- Revise acceptance policy to require **at least one admin** acceptance (not specifically creator admin).

### QA-2026-02-17-ADMINOPS-072
User decision (re-acceptance email audience):
- Send major-terms re-acceptance email with CTA to **all admin users**.

### QA-2026-02-17-ADMINOPS-073
User decision (post-unblock behavior):
- Once one admin accepts and account is unblocked, remaining admins are **notice-only** (no mandatory block).

### QA-2026-02-17-ADMINOPS-074
User decision (acceptance evidence export):
- Skip accepted-terms PDF export for now; launch with in-app history/audit view first.

### QA-2026-02-17-ADMINOPS-075
User decision (public terms visibility):
- Public Terms page should show **current version only**.

### QA-2026-02-17-ADMINOPS-076
User decision (public terms route):
- Use public no-login URL **`/terms`** and link it from signup/checkout + footer.

### QA-2026-02-17-ADMINOPS-077
User decision (terms editing UX):
- Support **both** rich text and Markdown editing (with preview).

### QA-2026-02-17-ADMINOPS-078
User decision (publish guardrail):
- Require a **change summary** before publishing a new terms version.

### QA-2026-02-17-ADMINOPS-079
User decision (publish timing options):
- Support both **publish immediately** and **schedule publish date/time**.

### QA-2026-02-17-ADMINOPS-080
User decision (major/minor classification):
- Admin selects **Major** or **Minor** at publish time.

### QA-2026-02-17-ADMINOPS-081
User decision (terms update cadence for promo/pricing operations):
- Creating or editing promo codes should **not** require publishing a new Terms version each time.
- Terms updates should be driven by legal/billing policy changes, not routine campaign operations.

### QA-2026-02-17-ADMINOPS-082
User decision (explicit pricing-change legal clause):
- Include explicit Terms language that subscription pricing may change with advance notice and applies at renewal unless otherwise stated.

### QA-2026-02-17-ADMINOPS-083
User decision (renewal behavior during major-terms acceptance window):
- If major updated terms are pending acceptance, automatic renewal should still proceed.
- Admin login remains blocked until acceptance is completed.

### QA-2026-02-17-ADMINOPS-084
User decision (terms edit/publish permissions):
- Terms editing and publishing should remain **admin_dev only**.

### QA-2026-02-17-ADMINOPS-085
User decision (new-signup terms acceptance placement):
- Require terms acceptance **before checkout** and keep a **post-checkout safety gate** if acceptance record is missing.

### QA-2026-02-17-ADMINOPS-086
User decision (acceptance evidence fields):
- Store robust audit data per acceptance event:
  - `user_id`, `tenant_id`, `terms_version`, `terms_content_hash`, `accepted_at`,
  - `ip`, `user_agent`,
  - `acceptance_method` (signup/login),
  - `source_url`.

### QA-2026-02-17-ADMINOPS-087
User decision (public terms page quality):
- Public `/terms` page should be SEO-ready with clear structure and print-friendly rendering.

### QA-2026-02-17-ADMINOPS-088
User decision (promo code character format):
- Promo codes use normalized uppercase alphanumeric format with dashes.

### QA-2026-02-17-ADMINOPS-089
User decision (usage cap model):
- Support both **global max uses** and **per-tenant max uses**.

### QA-2026-02-17-ADMINOPS-090
User decision (promo failure messaging):
- Show specific promo validation errors (expired, usage limit reached, not eligible), not generic invalid-code messaging.

### QA-2026-02-17-ADMINOPS-091
User decision (attribution handling):
- Store both manual channel attribution and UTM attribution.
- Reporting should support selectable attribution mode.

### QA-2026-02-17-ADMINOPS-092
User decision (promo analytics default window):
- Default analytics window should be **last 30 days**.

### QA-2026-02-17-ADMINOPS-093
User decision (promo testing capability):
- Include an admin_dev-only **Test Promo simulator** in Subscription Management.

### QA-2026-02-17-ADMINOPS-094
User decision (promo code uniqueness):
- Promo code strings must be globally unique forever (no reuse).

### QA-2026-02-17-ADMINOPS-095
User decision (simulator mode + case handling):
- Test Promo simulator should support **preview + Stripe test checkout link**.
- Promo code entry should be **case-insensitive** (normalize input).

### QA-2026-02-17-ADMINOPS-096
User decision (dash validation):
- Disallow leading/trailing dashes and consecutive dashes in promo codes.

### QA-2026-02-17-ADMINOPS-097
User decision (promo code length):
- Promo code length range should be **6–32 characters**.

### QA-2026-02-17-ADMINOPS-098
User decision (fixed-amount overage behavior):
- Fixed discount amounts are capped at eligible charge amount (line floors at 0, no negative charge).

### QA-2026-02-17-ADMINOPS-099
User decision (discount tax order):
- Apply discount **before tax**.

### QA-2026-02-17-ADMINOPS-100
User confirmation (continued one-question guidance style):
- Continue using options + recommendation format for decision prompts.

