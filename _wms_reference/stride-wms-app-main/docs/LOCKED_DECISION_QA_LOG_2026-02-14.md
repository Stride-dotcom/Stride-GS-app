# Decision Q&A Log — 2026-02-14 (SMS / Twilio / Billing)

Purpose: append-only trace of substantive implementation Q&A decisions from the SMS/Twilio/billing planning thread.

## Entries

| QA ID | Date | Question (summary) | Answer / Outcome | Decision Link |
|---|---|---|---|---|
| QA-2026-02-14-001 | 2026-02-14 | Can Twilio 30509 requirements be built directly into the app? | Yes; proceed with in-app public opt-in flow and compliance support. | DL-2026-02-14-072, DL-2026-02-14-084 |
| QA-2026-02-14-002 | 2026-02-14 | Must public opt-in be accessible without login? | Yes; public route required for Twilio review. | DL-2026-02-14-084 |
| QA-2026-02-14-003 | 2026-02-14 | Move opt-in capability to `/sms` landing experience? | Yes; include user-facing opt-in information/flow in public experience. | DL-2026-02-14-084 |
| QA-2026-02-14-004 | 2026-02-14 | Are Twilio verification fields admin-only or for end users? | Admin-only; end users only see opt-in flow and disclosures. | DL-2026-02-14-072, DL-2026-02-14-085, DL-2026-02-14-086 |
| QA-2026-02-14-005 | 2026-02-14 | Should `/sms` include public opt-in + explanatory sections? | Yes. | DL-2026-02-14-084 |
| QA-2026-02-14-006 | 2026-02-14 | Platform-managed Twilio vs tenant self-setup? | Platform-managed under Stride account. | DL-2026-02-14-072 |
| QA-2026-02-14-007 | 2026-02-14 | Tenant branding on public SMS page using org settings? | Yes; pull tenant brand/company metadata. | DL-2026-02-14-084 |
| QA-2026-02-14-008 | 2026-02-14 | Tenant context for public `/sms`: subdomain vs URL parameter? | Subdomain. | DL-2026-02-14-084 |
| QA-2026-02-14-009 | 2026-02-14 | Should tenant admins edit SMS compliance content? | Keep simple and lock tenant editing. | DL-2026-02-14-085 |
| QA-2026-02-14-010 | 2026-02-14 | Remove/hide Twilio setup sections from tenant settings? | Yes. | DL-2026-02-14-086 |
| QA-2026-02-14-011 | 2026-02-14 | Manual or automated number provisioning? | Fully automated; no manual provisioning. | DL-2026-02-14-073 |
| QA-2026-02-14-012 | 2026-02-14 | Default sender type: toll-free or 10DLC? | Toll-free default. | DL-2026-02-14-074 |
| QA-2026-02-14-013 | 2026-02-14 | Allow sending while verification pending? | No; keep disabled until approved. | DL-2026-02-14-075 |
| QA-2026-02-14-014 | 2026-02-14 | Should billing start when approval is detected? | Yes; start from approval state transition. | DL-2026-02-14-076 |
| QA-2026-02-14-015 | 2026-02-14 | First-month monthly fee policy (match Twilio cycle vs prorate)? | Not finalized; prorate discussed as likely path. | DL-2026-02-14-088 (draft) |
| QA-2026-02-14-016 | 2026-02-14 | Global rates or per-tenant rates? | Global rates. | DL-2026-02-14-077 |
| QA-2026-02-14-017 | 2026-02-14 | Recipient for pricing-change notices? | Company email only; add info tooltip to field. | DL-2026-02-14-078 |
| QA-2026-02-14-018 | 2026-02-14 | Bill SMS usage inbound only, outbound only, or both? | Both inbound and outbound. | DL-2026-02-14-079 |
| QA-2026-02-14-019 | 2026-02-14 | Metering model: flat message count or Twilio-accurate? | Twilio-accurate segments. | DL-2026-02-14-080 |
| QA-2026-02-14-020 | 2026-02-14 | Automated Stripe billing vs manual tracking? | Automated Stripe billing. | DL-2026-02-14-081 |
| QA-2026-02-14-021 | 2026-02-14 | Should admin pricing page include app subscription monthly fee too? | Yes. | DL-2026-02-14-077, DL-2026-02-14-082 |
| QA-2026-02-14-022 | 2026-02-14 | Where should subscription invoices appear in app? | Tenant Account Settings → Billing page. | DL-2026-02-14-083 |
| QA-2026-02-14-023 | 2026-02-14 | Need internal/self-use without paying? | Yes; comped/waiver capability required. | DL-2026-02-14-087 |
| QA-2026-02-14-024 | 2026-02-14 | Should every Q&A be logged for execution tracking? | Yes. | DL-2026-02-14-071 |
| QA-2026-02-14-025 | 2026-02-14 | Comped billing override scope: single internal tenant or multiple? | Multiple tenants. | DL-2026-02-14-087 |

