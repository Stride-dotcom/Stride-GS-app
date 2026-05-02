/**
 * intakeReceipt — build the token map + sendEmail params for the
 * INTAKE_RECEIPT_CLIENT template.
 *
 * Mirrors the token-derivation logic that used to live in the GAS
 * `handleEmailSignedAgreement_` handler (StrideAPI.gs ~line 36031). We
 * moved it here so the React caller (ClientIntake.tsx) can build the
 * full sendEmail payload and skip the GAS round trip entirely — the
 * Resend pipeline owns the actual send via the `send-email` edge
 * function.
 *
 * Tokens produced (matching what the template body expects):
 *   BUSINESS_NAME, CONTACT_NAME, CONTACT_EMAIL, SIGNED_DATE,
 *   INSURANCE_LABEL, INSURANCE_DETAIL, AUTO_INSPECT_LABEL, INTAKE_REF
 *
 * Idempotency key is `intake-receipt:<linkId>:<refNum>` — keyed on link
 * id + reference number so:
 *   • The same intake submission's auto-fired receipt can't double-send
 *     if the React caller retries on a transient failure.
 *   • A manual resend with a DIFFERENT intakeId (e.g. after re-submitting
 *     to a fresh intake row) gets a fresh send instead of being deduped.
 */
import { sendEmail, type SendEmailResult } from './email';

export interface IntakeReceiptInput {
  /** intake link id — used for the related_entity_id audit field +
   *  idempotency key. */
  linkId: string;
  /** Recipient email — the prospect who just signed. */
  email: string;
  /** Display name of the prospect's business. */
  businessName: string;
  contactName?: string;
  /** ISO timestamp of signature; defaults to now() when omitted. */
  signedAt?: string;
  /** 'own_policy' | 'stride_coverage' | 'eis_coverage' | '' */
  insuranceChoice?: string;
  /** Required when insuranceChoice='stride_coverage' to compute the
   *  monthly add-on rate; ignored otherwise. */
  declaredValue?: number;
  autoInspect?: boolean;
  /** Supabase UUID of the client_intakes row created on submit; used as
   *  the prefix for the human-readable INTAKE_REF token (first 8 hex
   *  chars, uppercased). Falls back to the linkId. */
  intakeId?: string;
}

/** Build the full sendEmail params for the intake receipt and dispatch
 *  it. Returns the sendEmail result so callers can react to failures
 *  (e.g. show a "retry" UI on the manual resend button). */
export async function sendIntakeReceipt(input: IntakeReceiptInput): Promise<SendEmailResult> {
  const insuranceChoice = (input.insuranceChoice ?? '').trim();
  const declared = Number(input.declaredValue) || 0;

  // Insurance label/detail — mirrors the language on the React intake
  // success screen so the email reads identically. Three policies:
  //   own_policy     → "My own policy"
  //   stride_coverage → "Stride's policy" + monthly rate quote
  //   eis_coverage   → same as stride_coverage (legacy alias)
  //   anything else  → em-dash placeholder
  //
  // Rate (2026-05-01 change, migration 20260501175255_insurance_rate_per_10k):
  //   $30/month per $10,000 declared, $30 monthly minimum.
  //   Same effective 0.3%/mo rate the policy has always been; finer
  //   granularity so small-declared-value clients aren't paying for the
  //   $100k slab they don't fill. The Postgres cron uses the same math
  //   (GREATEST(30, ROUND(declared/10000 × 30, 2))).
  let insuranceLabel = '—';
  let insuranceDetail = '—';
  if (insuranceChoice === 'own_policy') {
    insuranceLabel = 'My own policy';
    insuranceDetail = 'I will maintain my own insurance and name Stride as additional insured.';
  } else if (insuranceChoice === 'stride_coverage' || insuranceChoice === 'eis_coverage') {
    insuranceLabel = "Stride's policy";
    const monthly = Math.max(30, Math.round((declared / 10000) * 30 * 100) / 100);
    insuranceDetail = declared > 0
      ? `Added to Stride's policy — $${declared.toLocaleString()} declared, $${monthly.toFixed(2)}/mo (per T&C §2.B, $30 minimum).`
      : "Added to Stride's policy ($30/mo minimum, per T&C §2.B).";
  }

  const signedAtDate = input.signedAt ? new Date(input.signedAt) : new Date();
  const signedDateLabel = signedAtDate.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Reference number — first 8 chars of intake UUID (or linkId fallback),
  // uppercased, dashes stripped. Matches the GAS handler's ref format so
  // any printed/forwarded receipt links back to the right intake row.
  const refSource = input.intakeId || input.linkId;
  const refNum = refSource.replace(/-/g, '').substring(0, 8).toUpperCase();

  return sendEmail({
    templateKey: 'INTAKE_RECEIPT_CLIENT',
    to: input.email,
    tokens: {
      BUSINESS_NAME:      input.businessName || 'your business',
      CONTACT_NAME:       input.contactName || 'there',
      CONTACT_EMAIL:      input.email,
      SIGNED_DATE:        signedDateLabel,
      INSURANCE_LABEL:    insuranceLabel,
      INSURANCE_DETAIL:   insuranceDetail,
      AUTO_INSPECT_LABEL: input.autoInspect ? 'Opted in' : 'Not opted in',
      INTAKE_REF:         refNum,
    },
    idempotencyKey:    `intake-receipt:${input.linkId}:${refNum}`,
    relatedEntityType: 'intake_link',
    relatedEntityId:   input.linkId,
  });
}
