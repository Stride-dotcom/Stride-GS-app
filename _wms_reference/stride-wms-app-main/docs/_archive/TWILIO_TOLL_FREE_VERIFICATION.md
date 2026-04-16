# Twilio Toll-Free Verification (Error 30509)

If Twilio shows:

> "The opt-in workflow provided is not sufficient. Provide a publicly accessible opt-in URL. See Error 30509"

it means your toll-free verification submission **must include a public URL** that clearly shows **how recipients opt in to receive SMS** (and includes required disclosures).

## What to enter in Twilio

- **Website URL**: your public company website (use `https://...`)
- **Proof of Consent (Opt-In) URL**: a public page that shows your SMS opt-in flow

This app includes a public opt-in page you can use:

- `https://<your-app-domain>/sms-opt-in?t=<tenantId>`

Notes:
- The page is **public** (no login required).
- If you want a stable URL without `?t=...`, set `VITE_DEFAULT_TENANT_ID` at build time.

## Required disclosures (what Twilio reviewers look for)

Make sure the opt-in page (and your confirmation message) clearly states:

- Who is sending the messages (your company name)
- What types of messages (e.g., operational notifications)
- Message frequency (e.g., "Message frequency varies")
- "Message & data rates may apply"
- How to opt out (`STOP`) and get help (`HELP`)
- Links to **Privacy Policy** and **Terms & Conditions**
- "Consent is not a condition of purchase"

