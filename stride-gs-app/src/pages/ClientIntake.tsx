/**
 * ClientIntake — public 6-step wizard rendered at /#/intake/:linkId.
 *
 * No auth required. The page validates the linkId against
 * client_intake_links (anon RLS allows reads of active non-expired
 * rows) and shows a "this link isn't active" screen if the magic URL
 * is revoked / expired / typo'd.
 *
 * Submit flow:
 *   1. All form state is held in one big draft object.
 *   2. On final Submit the wizard:
 *      a. Uploads the resale cert (+ any additional docs) to
 *         documents/intakes/<linkId>/... via anon RLS.
 *      b. INSERTs a client_intakes row with every field captured —
 *         including signature_data (typed name or base64 canvas),
 *         section initials, insurance choice, payment-authorized flag.
 *      c. Best-effort flips client_intake_links.used_at (anon can't
 *         update links; admin side reconciles on next review).
 *   3. Renders a "Thanks — we'll be in touch" confirmation screen.
 *
 * PDF generation is deferred: the admin side renders a signed-T&C PDF
 * from the intake row on demand. That keeps this page's dependency
 * surface small (no pdf/canvas deps beyond the built-in HTMLCanvas).
 */
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Loader2, FileText, Upload, ChevronRight, ChevronLeft, Plus, Trash2, Edit3, ExternalLink, Download, Mail } from 'lucide-react';
import {
  useIntakeLink,
  uploadIntakeFile,
  submitIntake,
  fetchClientTcBody,
  fetchPublicCoverageNotes,
  useSignatureCanvas,
  type IntakeSubmitPayload,
  type PublicCoverageNote,
} from '../hooks/useClientIntake';
import { generateSignedTcPdf } from '../lib/intakePdf';
import { postEmailSignedAgreement } from '../lib/api';

// Style tokens — copied verbatim from PublicRates so the public-side
// pages stay visually coherent without pulling the authed app's theme.
const BG_PAGE   = '#F5F2EE';
const BG_CARD   = '#FFFFFF';
const BG_DARK   = '#1C1C1C';
const ACCENT    = '#E8692A';
const TEXT      = '#1C1C1C';
const TEXT_MUT  = '#888888';
const TEXT_SEC  = '#475569';
const BORDER    = 'rgba(0,0,0,0.07)';
const FONT      = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const ORANGE_SOFT = 'rgba(232,105,42,0.08)';

const PAYMENT_LINK = 'https://paymnt.io/xx9om3';

interface Props { linkId: string }

const STEPS = [
  { id: 1, key: 'business',  label: 'Business Info' },
  { id: 2, key: 'billing',   label: 'Billing & Alerts' },
  { id: 3, key: 'tc',        label: 'Terms & Conditions' },
  { id: 4, key: 'payment',   label: 'Payment Setup' },
  { id: 5, key: 'documents', label: 'Documents' },
  { id: 6, key: 'review',    label: 'Review & Submit' },
] as const;

type NotifyContact = { name: string; email: string };

interface Draft {
  // Step 1
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  businessAddress: string;
  website: string;
  // Step 2
  billingContactName: string;
  billingEmail: string;
  billingAddress: string;
  notificationContacts: NotifyContact[];
  // Step 3
  insuranceChoice: 'own_policy' | 'stride_coverage' | '';
  /** Only used when insuranceChoice='stride_coverage'. Dollar value
   *  the prospect wants insured; feeds the monthly charge + $300 min. */
  insuranceDeclaredValue: string;
  /** Opt-in — authorises Stride to open & inspect every inbound
   *  shipment for visible shipping damage. Default false; off-by-default
   *  is deliberate because inspection is a chargeable service and
   *  opening packages is something we only do with permission. */
  autoInspect: boolean;
  signatureType: 'typed' | 'drawn';
  typedSignature: string;
  // drawnSignature captured via canvas ref on demand
  sectionInitials: Record<string, string>;
  // Step 4
  paymentAuthorized: boolean;
  // Step 5 — Tax & documents
  /** Prospect's wholesale-customer status. null = haven't answered yet
   *  (forces an explicit choice before they can advance to review). */
  taxExempt: boolean | null;
  /** Resale / Out-of-state / Government / Non-profit / Other. Only meaningful when taxExempt = true. */
  taxExemptReason: string;
  resaleCertFile: File | null;
  /** ISO yyyy-mm-dd. Captured alongside the cert PDF — most state certs
   *  expire after 4 years and the app warns at <60 days. Optional at
   *  intake; admin can fill it in later from Settings → Edit Client. */
  resaleCertExpires: string;
  otherFiles: File[];
}

const EMPTY_DRAFT: Draft = {
  businessName: '', contactName: '', email: '', phone: '', businessAddress: '', website: '',
  billingContactName: '', billingEmail: '', billingAddress: '',
  notificationContacts: [],
  insuranceChoice: '',
  insuranceDeclaredValue: '',
  autoInspect: false,
  signatureType: 'typed',
  typedSignature: '',
  sectionInitials: {},
  paymentAuthorized: false,
  taxExempt: null,
  taxExemptReason: 'Resale',
  resaleCertFile: null,
  resaleCertExpires: '',
  otherFiles: [],
};

export function ClientIntake({ linkId }: Props) {
  const { status, link } = useIntakeLink(linkId);

  const [step, setStep] = useState<number>(1);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  // Captured at submit time so it's available on the success screen
  // after the canvas element unmounts.
  const [capturedSignatureData, setCapturedSignatureData] = useState('');
  const [emailReceiptSending, setEmailReceiptSending] = useState(false);
  const [emailReceiptSent, setEmailReceiptSent] = useState(false);

  // Signature pad + ink flag — MUST be declared before any conditional
  // return below. Prior bug (session 77): these hooks lived after the
  // `if (status === 'loading') return …` guards, so the first render
  // (status=loading) called fewer hooks than later renders (status=valid),
  // triggering React error #310 and rendering a blank page. All hooks
  // up top.
  const sig = useSignatureCanvas();
  const [sigHasInk, setSigHasInk] = useState(false);

  // Pre-fill contact fields from the invitation row if present.
  useEffect(() => {
    if (link?.prospectEmail || link?.prospectName) {
      setDraft(d => ({
        ...d,
        email: d.email || link.prospectEmail || '',
        contactName: d.contactName || link.prospectName || '',
      }));
    }
  }, [link]);

  // Load the T&C HTML + live coverage notes in parallel. The T&C body
  // contains {{COVERAGE_*_NOTE}} tokens that we interpolate at render
  // time from the current coverage_options rows — so a rate change in
  // the Price List flows into the next signed agreement without
  // anyone editing the template.
  const [tcHtml, setTcHtml] = useState<string | null>(null);
  const [tcLoading, setTcLoading] = useState(false);
  const [coverageNotes, setCoverageNotes] = useState<PublicCoverageNote[]>([]);
  useEffect(() => {
    let cancelled = false;
    setTcLoading(true);
    void Promise.all([fetchClientTcBody(), fetchPublicCoverageNotes()]).then(([body, notes]) => {
      if (cancelled) return;
      setTcHtml(body);
      setCoverageNotes(notes);
      setTcLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Scroll-to-top on step change — nice UX on a tall multi-step form.
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [step]);

  // ── Unavailable / loading link states ───────────────────────────────
  if (status === 'loading') {
    return <CenteredMessage>Loading your invitation…</CenteredMessage>;
  }
  if (status === 'invalid' || status === 'expired') {
    return (
      <div style={pageShell}>
        <Header title="Client Onboarding" />
        <div style={{ ...cardWrap, padding: 40, textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: '50%', background: '#FEE2E2', color: '#B91C1C', marginBottom: 16 }}>
            <AlertTriangle size={26} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, color: TEXT, marginBottom: 8 }}>This invitation isn't active</div>
          <div style={{ fontSize: 14, color: TEXT_MUT, lineHeight: 1.6, maxWidth: 440, margin: '0 auto' }}>
            The invitation link may have expired, been revoked, or contain a typo. Please contact your Stride account manager to request a new link.
          </div>
          <a href="mailto:info@stridenw.com" style={{ display: 'inline-block', marginTop: 20, color: ACCENT, textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>
            info@stridenw.com
          </a>
        </div>
      </div>
    );
  }

  // ── Submitted confirmation ─────────────────────────────────────────
  if (submitted) {
    const handleDownload = () => {
      void generateSignedTcPdf({
        businessName:   draft.businessName,
        contactName:    draft.contactName,
        email:          draft.email,
        signedAt:       new Date().toISOString(),
        insuranceChoice: draft.insuranceChoice || '',
        signatureType:  draft.signatureType,
        signatureData:  capturedSignatureData,
        sectionInitials: draft.sectionInitials,
      });
    };

    const handleEmailReceipt = async () => {
      setEmailReceiptSending(true);
      try {
        await postEmailSignedAgreement({
          linkId:       linkId,
          email:        draft.email,
          businessName: draft.businessName,
        });
        setEmailReceiptSent(true);
      } finally {
        setEmailReceiptSending(false);
      }
    };

    return (
      <div style={pageShell}>
        <Header title="Application Received" />
        <div style={{ ...cardWrap, padding: 40, textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: '50%', background: 'rgba(74,138,92,0.12)', color: '#15803D', marginBottom: 16 }}>
            <CheckCircle2 size={30} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 600, color: TEXT, marginBottom: 10 }}>You're all set — thank you!</div>
          <div style={{ fontSize: 14, color: TEXT_MUT, lineHeight: 1.7, maxWidth: 520, margin: '0 auto' }}>
            Your application has been received by our team. We'll review it and email you within 1–2 business days to activate your account and get you set up in the Stride warehouse.
          </div>
          <div style={{ marginTop: 24, padding: '14px 18px', borderRadius: 12, background: ORANGE_SOFT, border: `1px solid ${ACCENT}33`, fontSize: 13, color: TEXT_SEC, textAlign: 'left', maxWidth: 520, margin: '24px auto 0' }}>
            <strong style={{ color: TEXT }}>What happens next?</strong>
            <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
              <li>We verify your business info and payment setup.</li>
              <li>We will send you your online inventory portal access.</li>
              <li>You can begin shipping your orders to us!</li>
            </ol>
          </div>

          {/* Agreement copy actions */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 28 }}>
            <button
              onClick={handleDownload}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '11px 22px', fontSize: 13, fontWeight: 600,
                background: '#fff', color: TEXT,
                border: `1.5px solid rgba(0,0,0,0.15)`, borderRadius: 100,
                cursor: 'pointer', fontFamily: FONT,
              }}
            >
              <Download size={15} /> Download a copy
            </button>
            {!emailReceiptSent ? (
              <button
                onClick={handleEmailReceipt}
                disabled={emailReceiptSending}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '11px 22px', fontSize: 13, fontWeight: 600,
                  background: '#fff', color: TEXT,
                  border: `1.5px solid rgba(0,0,0,0.15)`, borderRadius: 100,
                  cursor: emailReceiptSending ? 'wait' : 'pointer', fontFamily: FONT,
                  opacity: emailReceiptSending ? 0.7 : 1,
                }}
              >
                {emailReceiptSending ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Mail size={15} />}
                {emailReceiptSending ? 'Sending…' : 'Email me a copy'}
              </button>
            ) : (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '11px 22px', fontSize: 13, color: '#15803D', fontFamily: FONT }}>
                <CheckCircle2 size={15} /> Receipt sent to {draft.email}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Navigation helpers ──────────────────────────────────────────────
  const canAdvance = (): boolean => {
    switch (step) {
      case 1: return draft.businessName.trim().length > 0
                  && draft.contactName.trim().length > 0
                  && /^\S+@\S+\.\S+$/.test(draft.email.trim());
      case 2: return true; // all step-2 fields are optional
      case 3: {
        const allInitialed = ['storage','insurance','billing','lien','general']
          .every(k => (draft.sectionInitials[k] || '').trim().length >= 2);
        const hasSig = draft.signatureType === 'typed'
          ? draft.typedSignature.trim().length > 0
          : sigHasInk;
        const hasInsurance = !!draft.insuranceChoice;
        // Stride coverage requires a declared value > 0 — the daily
        // billing job uses it to compute the monthly charge ($300/$100K).
        const declaredOk = draft.insuranceChoice !== 'stride_coverage'
          || (Number(draft.insuranceDeclaredValue) > 0);
        return allInitialed && hasSig && hasInsurance && declaredOk;
      }
      case 4: return draft.paymentAuthorized;
      // Step 5: must answer wholesale Yes/No. If yes, cert PDF is
      // strongly encouraged but not strictly required (prospect may not
      // have the file handy; admin will follow up post-submit).
      case 5: return draft.taxExempt !== null;
      case 6: return canSubmit;
      default: return true;
    }
  };

  const next = () => { if (canAdvance() && step < STEPS.length) setStep(step + 1); };
  const prev = () => { if (step > 1) setStep(step - 1); };

  const canSubmit = (() => {
    // Guardrails for the final submit button. Mirrors step-by-step
    // canAdvance() so a user can't leap to Submit with a half-filled form.
    if (!draft.businessName || !draft.contactName || !draft.email) return false;
    if (!draft.insuranceChoice) return false;
    if (draft.insuranceChoice === 'stride_coverage'
        && !(Number(draft.insuranceDeclaredValue) > 0)) return false;
    const sigOk = draft.signatureType === 'typed'
      ? draft.typedSignature.trim().length > 0
      : sigHasInk;
    if (!sigOk) return false;
    if (!draft.paymentAuthorized) return false;
    const initialsOk = ['storage','insurance','billing','lien','general']
      .every(k => (draft.sectionInitials[k] || '').trim().length >= 2);
    if (!initialsOk) return false;
    return true;
  })();

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Upload files first — the intake row references them by path.
      let resalePath: string | undefined;
      if (draft.resaleCertFile) {
        resalePath = await uploadIntakeFile(linkId, draft.resaleCertFile);
      }
      // "Other" files — concatenate paths into a CSV string on
      // signed_tc_pdf_path for now; the admin review view will split
      // on comma. If the list grows we can break this into a proper
      // table later.
      const otherPaths: string[] = [];
      for (const f of draft.otherFiles) {
        const p = await uploadIntakeFile(linkId, f);
        otherPaths.push(p);
      }

      const signatureData = draft.signatureType === 'typed'
        ? draft.typedSignature.trim()
        : sig.toDataURL();
      // Capture before canvas potentially unmounts on the success screen.
      setCapturedSignatureData(signatureData);

      const payload: IntakeSubmitPayload = {
        linkId,
        businessName:       draft.businessName,
        contactName:        draft.contactName,
        email:              draft.email,
        phone:              draft.phone || undefined,
        businessAddress:    draft.businessAddress || undefined,
        website:            draft.website || undefined,
        billingContactName: draft.billingContactName || undefined,
        billingEmail:       draft.billingEmail || undefined,
        billingAddress:     draft.billingAddress || undefined,
        notificationContacts: draft.notificationContacts.filter(c => c.email.trim().length > 0),
        insuranceChoice:    draft.insuranceChoice as 'own_policy' | 'stride_coverage',
        insuranceDeclaredValue: draft.insuranceChoice === 'stride_coverage' && draft.insuranceDeclaredValue
          ? Number(draft.insuranceDeclaredValue)
          : undefined,
        autoInspect:        draft.autoInspect,
        signatureType:      draft.signatureType,
        signatureData,
        initials:           draft.sectionInitials,
        paymentAuthorized:  draft.paymentAuthorized,
        resaleCertPath:     resalePath,
        // Stash other-doc paths in signed_tc_pdf_path as a CSV for MVP.
        signedTcPdfPath:    otherPaths.length > 0 ? otherPaths.join(',') : undefined,
        taxExempt:          draft.taxExempt ?? undefined,
        taxExemptReason:    draft.taxExempt ? draft.taxExemptReason : undefined,
        resaleCertExpires:  draft.taxExempt && draft.resaleCertExpires ? draft.resaleCertExpires : undefined,
      };
      const result = await submitIntake(payload);
      if ('error' in result) {
        setSubmitError(result.error);
      } else {
        setSubmitted(true);
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={pageShell}>
      <Header
        title="Client Onboarding"
        subtitle={link?.prospectName ? `Welcome, ${link.prospectName}` : undefined}
      />

      {/* Progress */}
      <div style={{ marginBottom: 16 }}>
        <ProgressStrip current={step} />
      </div>

      {/* Step card */}
      <div style={cardWrap}>
        {step === 1 && <StepBusiness draft={draft} setDraft={setDraft} />}
        {step === 2 && <StepBilling  draft={draft} setDraft={setDraft} />}
        {step === 3 && (
          <StepTerms
            draft={draft}
            setDraft={setDraft}
            tcHtml={tcHtml}
            tcLoading={tcLoading}
            coverageNotes={coverageNotes}
            sig={sig}
            sigHasInk={sigHasInk}
            setSigHasInk={setSigHasInk}
          />
        )}
        {step === 4 && <StepPayment draft={draft} setDraft={setDraft} />}
        {step === 5 && <StepDocuments draft={draft} setDraft={setDraft} />}
        {step === 6 && (
          <StepReview
            draft={draft}
            onJumpTo={setStep}
            sigDataUrl={draft.signatureType === 'drawn' ? sig.toDataURL() : ''}
          />
        )}
      </div>

      {/* Footer nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, flexWrap: 'wrap', gap: 10 }}>
        <button
          onClick={prev}
          disabled={step === 1 || submitting}
          style={secondaryBtn(step === 1 || submitting)}
        >
          <ChevronLeft size={14} /> Back
        </button>
        {step < STEPS.length ? (
          <button onClick={next} disabled={!canAdvance()} style={primaryBtn(!canAdvance())}>
            Continue <ChevronRight size={14} />
          </button>
        ) : (
          <button onClick={handleSubmit} disabled={!canSubmit || submitting} style={primaryBtn(!canSubmit || submitting)}>
            {submitting ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Submitting…</> : <>Submit Application <ChevronRight size={14} /></>}
          </button>
        )}
      </div>

      {submitError && (
        <div role="alert" style={{
          marginTop: 12, padding: '10px 14px',
          background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C',
          borderRadius: 10, fontSize: 13,
        }}>
          {submitError}
        </div>
      )}

      <Footer />
    </div>
  );
}

// ─── Progress + layout chrome ────────────────────────────────────────

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header style={{ background: BG_DARK, padding: '0 24px', marginBottom: 24, borderRadius: 20 }}>
      <div style={{ padding: '22px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="https://www.mystridehub.com/stride-logo.png" alt="Stride" style={{ height: 36, width: 36 }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '2px', color: '#fff', lineHeight: 1.1 }}>STRIDE</div>
            <div style={{ fontSize: 9, fontWeight: 400, letterSpacing: '5px', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', lineHeight: 1 }}>LOGISTICS</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', letterSpacing: '0.5px' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>{subtitle}</div>}
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer style={{ marginTop: 40, padding: '20px 0', textAlign: 'center' }}>
      <div style={{ fontSize: 12, color: TEXT_MUT }}>
        Stride Logistics · Kent, WA ·{' '}
        <a href="https://www.stridenw.com" target="_blank" rel="noopener noreferrer" style={{ color: ACCENT, textDecoration: 'none' }}>stridenw.com</a>
        {' '}·{' '}
        <a href="mailto:info@stridenw.com" style={{ color: TEXT_MUT, textDecoration: 'none' }}>info@stridenw.com</a>
      </div>
    </footer>
  );
}

function ProgressStrip({ current }: { current: number }) {
  return (
    <div style={{ background: BG_CARD, borderRadius: 14, border: `1px solid ${BORDER}`, padding: '14px 18px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: TEXT_MUT, textTransform: 'uppercase', marginBottom: 10 }}>
        Step {current} of {STEPS.length} · {STEPS[current - 1].label}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {STEPS.map(s => (
          <div key={s.id} style={{
            flex: 1, height: 6, borderRadius: 100,
            background: s.id <= current ? ACCENT : BORDER,
            transition: 'background 0.25s',
          }} />
        ))}
      </div>
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ...pageShell, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
      <div style={{ color: TEXT_MUT, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
        {children}
      </div>
    </div>
  );
}

// ─── Step components ─────────────────────────────────────────────────

function StepBusiness({ draft, setDraft }: StepProps) {
  return (
    <div>
      <StepTitle kicker="Step 1" title="Tell us about your business" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Business name *" span={2}>
          <Input value={draft.businessName} onChange={v => setDraft(d => ({ ...d, businessName: v }))} placeholder="Acme Furniture Co." />
        </Field>
        <Field label="Contact name *">
          <Input value={draft.contactName} onChange={v => setDraft(d => ({ ...d, contactName: v }))} placeholder="Jane Doe" />
        </Field>
        <Field label="Email *">
          <Input type="email" value={draft.email} onChange={v => setDraft(d => ({ ...d, email: v }))} placeholder="jane@acme.com" />
        </Field>
        <Field label="Phone">
          <Input value={draft.phone} onChange={v => setDraft(d => ({ ...d, phone: v }))} placeholder="(206) 555-1234" />
        </Field>
        <Field label="Website">
          <Input value={draft.website} onChange={v => setDraft(d => ({ ...d, website: v }))} placeholder="acme.com" />
        </Field>
        <Field label="Business address" span={2}>
          <TextArea value={draft.businessAddress} onChange={v => setDraft(d => ({ ...d, businessAddress: v }))} placeholder="Street, City, State, ZIP" rows={2} />
        </Field>
      </div>
    </div>
  );
}

function StepBilling({ draft, setDraft }: StepProps) {
  const add = () => setDraft(d => ({ ...d, notificationContacts: [...d.notificationContacts, { name: '', email: '' }] }));
  const setAt = (i: number, patch: Partial<NotifyContact>) => setDraft(d => ({
    ...d,
    notificationContacts: d.notificationContacts.map((c, idx) => idx === i ? { ...c, ...patch } : c),
  }));
  const removeAt = (i: number) => setDraft(d => ({ ...d, notificationContacts: d.notificationContacts.filter((_, idx) => idx !== i) }));
  return (
    <div>
      <StepTitle kicker="Step 2" title="Billing & warehouse alert emails" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
        <Field label="Billing contact name">
          <Input value={draft.billingContactName} onChange={v => setDraft(d => ({ ...d, billingContactName: v }))} placeholder="Optional — defaults to main contact" />
        </Field>
        <Field label="Billing email">
          <Input type="email" value={draft.billingEmail} onChange={v => setDraft(d => ({ ...d, billingEmail: v }))} placeholder="billing@acme.com" />
        </Field>
        <Field label="Billing address" span={2}>
          <TextArea value={draft.billingAddress} onChange={v => setDraft(d => ({ ...d, billingAddress: v }))} placeholder="If different from business address" rows={2} />
        </Field>
      </div>

      {/* Warehouse alert emails — visually distinct block (orange-soft
          background + accent rule) so prospects don't conflate this
          with the contact email at step 1 or the billing email above.
          These addresses receive the shipment/task/receipt/repair
          activity stream that the operator fires from the app — they
          are NOT for marketing or billing. */}
      <div style={{
        marginTop: 24,
        background: ORANGE_SOFT,
        border: `1px solid ${ACCENT}33`,
        borderRadius: 14,
        padding: 18,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: ACCENT, textTransform: 'uppercase', marginBottom: 4 }}>
          Warehouse Alert Emails
        </div>
        <div style={{ fontSize: 12, color: TEXT_SEC, marginBottom: 12, lineHeight: 1.55 }}>
          These email addresses will receive automated notifications about warehouse activity — receiving confirmations, shipment updates, task completions, and other alerts.
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button onClick={add} style={addRowBtn}>
            <Plus size={12} /> Add alert email
          </button>
        </div>
        {draft.notificationContacts.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: TEXT_MUT, fontSize: 12, background: BG_CARD, borderRadius: 10 }}>
            No additional alert emails — only the main contact above will receive warehouse alerts.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {draft.notificationContacts.map((c, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr auto', gap: 8, alignItems: 'center' }}>
                <Input value={c.name} onChange={v => setAt(i, { name: v })} placeholder="Name (optional)" />
                <Input type="email" value={c.email} onChange={v => setAt(i, { email: v })} placeholder="alerts@company.com" />
                <button onClick={() => removeAt(i)} style={removeBtn} aria-label="Remove">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StepTerms({ draft, setDraft, tcHtml, tcLoading, coverageNotes, sig, sigHasInk, setSigHasInk }: StepProps & {
  tcHtml: string | null;
  tcLoading: boolean;
  coverageNotes: PublicCoverageNote[];
  sig: ReturnType<typeof useSignatureCanvas>;
  sigHasInk: boolean;
  setSigHasInk: (v: boolean) => void;
}) {
  const sections = useMemo(() => parseTcSections(tcHtml ?? ''), [tcHtml]);
  return (
    <div>
      <StepTitle kicker="Step 3" title="Terms & Conditions" />
      <div style={{ fontSize: 13, color: TEXT_SEC, lineHeight: 1.6, marginBottom: 16 }}>
        Please read each section and type your initials to acknowledge. A full signature at the bottom completes the agreement.
      </div>

      {/* Property-in-storage coverage choice. (Handling valuation, the
          per-shipment $0.60/lb-vs-replacement tier selection, is
          explained in §2.A of the T&C but elected at receipt — not here.) */}
      <div style={{ background: ORANGE_SOFT, border: `1px solid ${ACCENT}33`, borderRadius: 14, padding: 18, marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: ACCENT, textTransform: 'uppercase', marginBottom: 4 }}>Property Coverage Choice *</div>
        <div style={{ fontSize: 12, color: TEXT_SEC, marginBottom: 10, lineHeight: 1.5 }}>
          This is for your goods while they sit in our warehouse (fire, water, burglary, acts of God, etc). Pick one. You can read the full terms in §2.B of the agreement below.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <InsuranceCard
            selected={draft.insuranceChoice === 'own_policy'}
            onSelect={() => setDraft(d => ({ ...d, insuranceChoice: 'own_policy' }))}
            title="My own policy"
            body="I will maintain my own insurance covering my stored property and name Stride as additional insured. (We'll ask for a COI after activation.)"
          />
          <InsuranceCard
            selected={draft.insuranceChoice === 'stride_coverage'}
            onSelect={() => setDraft(d => ({ ...d, insuranceChoice: 'stride_coverage' }))}
            title="Add me to Stride's policy"
            body="Stride adds my property to its storage policy. Processing fee: $300/month per $100,000 declared value ($300/month minimum)."
          />
        </div>

        {/* Declared-value input — only shown when Stride coverage is
            selected. Feeds the daily billing cron, which bills
            GREATEST($300, declared/$100K × rate) per month. */}
        {draft.insuranceChoice === 'stride_coverage' && (
          <div style={{ marginTop: 14, padding: 14, background: BG_CARD, border: `1px solid ${BORDER}`, borderRadius: 10 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: TEXT, marginBottom: 6 }}>
              Declared Value (what you want insured) *
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, color: TEXT_SEC }}>$</span>
              <input
                type="number"
                min={0}
                step={1000}
                value={draft.insuranceDeclaredValue}
                onChange={e => setDraft(d => ({ ...d, insuranceDeclaredValue: e.target.value }))}
                placeholder="100000"
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  fontSize: 14,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  outline: 'none',
                }}
              />
            </div>
            <div style={{ fontSize: 12, color: TEXT_MUT, marginTop: 8, lineHeight: 1.5 }}>
              {(() => {
                const declared = Number(draft.insuranceDeclaredValue) || 0;
                const monthly = Math.max(300, Math.round((declared / 100000) * 300 * 100) / 100);
                return declared > 0
                  ? <>Your monthly charge: <strong style={{ color: TEXT }}>${monthly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> (per T&C §2.B — $300 minimum).</>
                  : <>Enter the dollar amount you want insured. Monthly charge: $300 per $100,000 declared, with a $300/month minimum.</>;
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Auto-inspection opt-in. Styled like a T&C disclosure: clickable
          checkbox + a paragraph of prose explaining the authorisation.
          Writes draft.autoInspect; gets copied into the client's
          AUTO_INSPECTION setting at activation (off by default). */}
      <div style={{
        background: BG_CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: 14,
        padding: 18,
        marginBottom: 20,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: TEXT_MUT, textTransform: 'uppercase', marginBottom: 10 }}>
          Automatic Inspection (Optional)
        </div>
        <label style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          cursor: 'pointer',
          padding: 10,
          borderRadius: 10,
          background: draft.autoInspect ? ORANGE_SOFT : 'transparent',
          border: `1px solid ${draft.autoInspect ? `${ACCENT}55` : BORDER}`,
          transition: 'background 0.15s, border-color 0.15s',
        }}>
          <input
            type="checkbox"
            checked={draft.autoInspect}
            onChange={e => setDraft(d => ({ ...d, autoInspect: e.target.checked }))}
            style={{ marginTop: 3, accentColor: ACCENT, width: 16, height: 16, flexShrink: 0 }}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 6 }}>
              Opt in to automatic inspection
            </div>
            <div style={{ fontSize: 12, color: TEXT_SEC, lineHeight: 1.55 }}>
              Stride does not automatically open and inspect inbound shipments for shipping damage unless requested by the client or unless the account has opted in to automatic inspection. By checking this box, you are authorizing Stride to open and inspect all inbound shipments to your account for visible shipping damage upon receipt.
            </div>
          </div>
        </label>
      </div>

      {tcLoading ? (
        <div style={{ padding: 40, textAlign: 'center', color: TEXT_MUT, fontSize: 13 }}>Loading agreement…</div>
      ) : sections.sections.length === 0 ? (
        <div style={{ padding: 16, background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C', borderRadius: 10, fontSize: 13 }}>
          The agreement text couldn't be loaded right now. Please refresh the page, or contact <a href="mailto:info@stridenw.com" style={{ color: ACCENT }}>info@stridenw.com</a>.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {sections.intro && (
            <div
              style={tcProseStyle}
              dangerouslySetInnerHTML={{ __html: replaceTokens(sections.intro, draft, coverageNotes) }}
            />
          )}
          {sections.sections.map(s => (
            <div key={s.key} style={{ background: BG_PAGE, borderRadius: 14, padding: 18, border: `1px solid ${BORDER}` }}>
              <div
                style={tcProseStyle}
                dangerouslySetInnerHTML={{ __html: replaceTokens(s.html, draft, coverageNotes) }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, padding: '10px 14px', background: '#fff', borderRadius: 10, border: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: TEXT_MUT, letterSpacing: '1.5px', textTransform: 'uppercase', minWidth: 70 }}>Initial</div>
                <Input
                  value={draft.sectionInitials[s.key] || ''}
                  onChange={v => setDraft(d => ({ ...d, sectionInitials: { ...d.sectionInitials, [s.key]: v.toUpperCase().slice(0, 4) } }))}
                  placeholder="ABC"
                  style={{ maxWidth: 100, letterSpacing: 4, textAlign: 'center', fontWeight: 700, textTransform: 'uppercase' }}
                />
                <div style={{ fontSize: 11, color: TEXT_MUT, marginLeft: 'auto' }}>
                  Acknowledges §{s.label}
                </div>
              </div>
            </div>
          ))}

          {/* Signature block */}
          <div style={{ background: BG_PAGE, borderRadius: 14, padding: 18, border: `1px solid ${BORDER}` }}>
            <div style={tcProseStyle} dangerouslySetInnerHTML={{ __html: replaceTokens(sections.signature, draft, coverageNotes) }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 14, marginBottom: 10 }}>
              <SigTabBtn active={draft.signatureType === 'typed'} onClick={() => setDraft(d => ({ ...d, signatureType: 'typed' }))}>Type name</SigTabBtn>
              <SigTabBtn active={draft.signatureType === 'drawn'} onClick={() => setDraft(d => ({ ...d, signatureType: 'drawn' }))}>Draw signature</SigTabBtn>
            </div>
            {draft.signatureType === 'typed' ? (
              <Input
                value={draft.typedSignature}
                onChange={v => setDraft(d => ({ ...d, typedSignature: v }))}
                placeholder="Type your full legal name"
                style={{ fontFamily: "'Caveat', 'Brush Script MT', cursive", fontSize: 28, padding: '14px 16px' }}
              />
            ) : (
              <div>
                <canvas
                  ref={sig.canvasRef}
                  width={640}
                  height={180}
                  style={{
                    width: '100%', maxWidth: '100%',
                    height: 180, background: '#fff',
                    border: `1px solid ${BORDER}`, borderRadius: 10,
                    touchAction: 'none', cursor: 'crosshair',
                    display: 'block',
                  }}
                  {...sig.handlers}
                  onMouseUp={() => { sig.handlers.onMouseUp(); setSigHasInk(!sig.isEmpty()); }}
                  onMouseLeave={() => { sig.handlers.onMouseLeave(); setSigHasInk(!sig.isEmpty()); }}
                  onTouchEnd={() => { sig.handlers.onTouchEnd(); setSigHasInk(!sig.isEmpty()); }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: TEXT_MUT }}>Use your mouse, trackpad, or finger to sign.</div>
                  <button
                    onClick={() => { sig.clear(); setSigHasInk(false); }}
                    style={{ fontSize: 11, color: ACCENT, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT, textDecoration: 'underline' }}
                  >
                    Clear
                  </button>
                </div>
                {sigHasInk && (
                  <div style={{ marginTop: 6, fontSize: 11, color: '#15803D', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <CheckCircle2 size={12} /> Signature captured
                  </div>
                )}
              </div>
            )}
            <div style={{ fontSize: 11, color: TEXT_MUT, marginTop: 10 }}>
              Signed: {new Date().toLocaleDateString()} · Electronic signatures are legally binding under the ESIGN Act and Washington's UETA.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StepPayment({ draft, setDraft }: StepProps) {
  return (
    <div>
      <StepTitle kicker="Step 4" title="Set up your payment method" />
      <div style={{ fontSize: 14, color: TEXT_SEC, lineHeight: 1.7, marginBottom: 18 }}>
        Stride uses automatic payment for monthly invoices — after a 15-day review window, the card or bank account on file is charged. Set up your secure payment method with our merchant processor by clicking below. Your full payment info is stored by <strong>Paymnt.io</strong> and never seen by Stride.
      </div>

      <a
        href={PAYMENT_LINK}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 10,
          padding: '14px 24px', borderRadius: 100,
          background: ACCENT, color: '#fff',
          fontSize: 13, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase',
          textDecoration: 'none', boxShadow: '0 8px 24px rgba(232,105,42,0.28)',
        }}
      >
        Set Up Payment Method <ExternalLink size={14} />
      </a>

      <div style={{ background: BG_PAGE, borderRadius: 12, padding: 16, marginTop: 18, border: `1px solid ${BORDER}`, fontSize: 12, color: TEXT_MUT, lineHeight: 1.6 }}>
        <strong style={{ color: TEXT }}>Your payment info is secure.</strong> Stride never sees or stores your full card or bank details. You can update your payment method any time via the Paymnt.io portal.
      </div>

      <div style={{ marginTop: 22 }}>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '12px 14px', background: draft.paymentAuthorized ? ORANGE_SOFT : '#fff', border: `1px solid ${draft.paymentAuthorized ? ACCENT : BORDER}`, borderRadius: 12 }}>
          <input
            type="checkbox"
            checked={draft.paymentAuthorized}
            onChange={e => setDraft(d => ({ ...d, paymentAuthorized: e.target.checked }))}
            style={{ marginTop: 3, accentColor: ACCENT, width: 16, height: 16 }}
          />
          <span style={{ fontSize: 13, color: TEXT, lineHeight: 1.5 }}>
            I have completed the payment authorization setup on Paymnt.io and I authorize Stride Logistics to charge my payment method for monthly invoices per the terms in §3 of the agreement.
          </span>
        </label>
      </div>
    </div>
  );
}

function StepDocuments({ draft, setDraft }: StepProps) {
  const pickResale = (f: File | null) => setDraft(d => ({ ...d, resaleCertFile: f }));
  const pickOthers = (files: FileList | null) => {
    if (!files) return;
    setDraft(d => ({ ...d, otherFiles: [...d.otherFiles, ...Array.from(files)] }));
  };
  const removeOther = (i: number) => setDraft(d => ({ ...d, otherFiles: d.otherFiles.filter((_, idx) => idx !== i) }));
  const setExempt = (next: boolean) => setDraft(d => ({ ...d, taxExempt: next }));
  const setReason = (next: string) => setDraft(d => ({ ...d, taxExemptReason: next }));
  const setExpires = (next: string) => setDraft(d => ({ ...d, resaleCertExpires: next }));

  return (
    <div>
      <StepTitle kicker="Step 5" title="Tax status & documents" />
      <div style={{ fontSize: 13, color: TEXT_SEC, lineHeight: 1.6, marginBottom: 18 }}>
        Most of our clients resell our services to their own customers and are tax-exempt for that reason. Tell us how to handle sales tax for your account.
      </div>

      {/* Wholesale yes/no */}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: TEXT_MUT, textTransform: 'uppercase', marginBottom: 10 }}>
        Tax status
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
        <label style={radioRow(draft.taxExempt === true)}>
          <input
            type="radio"
            name="taxExempt"
            checked={draft.taxExempt === true}
            onChange={() => setExempt(true)}
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Yes — we're a wholesale customer (resale exemption)</div>
            <div style={{ fontSize: 11, color: TEXT_MUT, marginTop: 2 }}>
              You're a reseller who provides our services to your own clients. Upload your state-issued resale certificate below.
            </div>
          </div>
        </label>
        <label style={radioRow(draft.taxExempt === false)}>
          <input
            type="radio"
            name="taxExempt"
            checked={draft.taxExempt === false}
            onChange={() => setExempt(false)}
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>No — we're the end customer (tax applies)</div>
            <div style={{ fontSize: 11, color: TEXT_MUT, marginTop: 2 }}>
              Sales tax will be added to applicable services per WA state law.
            </div>
          </div>
        </label>
      </div>

      {/* Wholesale-only sub-section: cert + expiry */}
      {draft.taxExempt === true && (
        <div style={{ background: BG_PAGE, borderRadius: 10, padding: 14, marginBottom: 18 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: TEXT_MUT, textTransform: 'uppercase', marginBottom: 6 }}>
              Exemption reason
            </div>
            <select
              value={draft.taxExemptReason}
              onChange={e => setReason(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', fontSize: 13,
                border: `1px solid ${BORDER}`, borderRadius: 8, fontFamily: 'inherit', background: '#fff',
              }}
            >
              {['Resale', 'Out-of-state', 'Government', 'Non-profit', 'Other'].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <FileUploadBlock
            label="Resale Certificate"
            description="PDF or image of your state-issued certificate. Required to legally claim wholesale exemption."
            file={draft.resaleCertFile}
            onPick={pickResale}
          />

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: TEXT_MUT, textTransform: 'uppercase', marginBottom: 6 }}>
              Cert expires (if known)
            </div>
            <input
              type="date"
              value={draft.resaleCertExpires}
              onChange={e => setExpires(e.target.value)}
              style={{
                padding: '10px 12px', fontSize: 13,
                border: `1px solid ${BORDER}`, borderRadius: 8, fontFamily: 'inherit', background: '#fff',
                maxWidth: 220,
              }}
            />
            <div style={{ fontSize: 11, color: TEXT_MUT, marginTop: 4 }}>
              Most state certs are valid for 4 years. Optional — leave blank if you're not sure.
            </div>
          </div>
        </div>
      )}

      {/* Other docs (always available) */}
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: TEXT_MUT, textTransform: 'uppercase', marginBottom: 8 }}>Other documents (optional)</div>
        <div style={{ fontSize: 12, color: TEXT_MUT, marginBottom: 10 }}>
          Anything else relevant to your account — insurance certificate, W-9, etc.
        </div>
        <label style={otherUploadBtn}>
          <Upload size={14} /> Upload file
          <input type="file" multiple style={{ display: 'none' }} onChange={e => pickOthers(e.target.files)} />
        </label>
        {draft.otherFiles.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {draft.otherFiles.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: BG_PAGE, borderRadius: 10, fontSize: 12 }}>
                <FileText size={13} color={TEXT_MUT} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <span style={{ color: TEXT_MUT, fontSize: 11 }}>{(f.size / 1024).toFixed(0)} KB</span>
                <button onClick={() => removeOther(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B45A5A' }}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const radioRow = (selected: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
  border: `1px solid ${selected ? '#E85D2D' : BORDER}`,
  borderRadius: 10, cursor: 'pointer',
  background: selected ? '#FFF8F4' : '#fff',
});

function StepReview({ draft, onJumpTo, sigDataUrl }: { draft: Draft; onJumpTo: (step: number) => void; sigDataUrl: string }) {
  const declared = Number(draft.insuranceDeclaredValue) || 0;
  const declaredMonthly = Math.max(300, Math.round((declared / 100000) * 300 * 100) / 100);
  const insuranceLabel = draft.insuranceChoice === 'own_policy'
    ? "Client's own policy"
    : draft.insuranceChoice === 'stride_coverage'
      ? `Added to Stride policy — $${declared.toLocaleString()} declared · $${declaredMonthly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo`
      : '—';
  return (
    <div>
      <StepTitle kicker="Step 6" title="Review & submit" />
      <div style={{ fontSize: 13, color: TEXT_SEC, lineHeight: 1.6, marginBottom: 18 }}>
        One last look before you submit. Click any section to jump back and edit.
      </div>

      <ReviewCard title="Business Info" onEdit={() => onJumpTo(1)}>
        <KV k="Business name" v={draft.businessName} />
        <KV k="Contact" v={`${draft.contactName} — ${draft.email}`} />
        {draft.phone   && <KV k="Phone"   v={draft.phone} />}
        {draft.website && <KV k="Website" v={draft.website} />}
        {draft.businessAddress && <KV k="Address" v={draft.businessAddress} />}
      </ReviewCard>

      <ReviewCard title="Billing & Alerts" onEdit={() => onJumpTo(2)}>
        {draft.billingContactName && <KV k="Billing contact" v={draft.billingContactName} />}
        {draft.billingEmail       && <KV k="Billing email"   v={draft.billingEmail} />}
        {draft.billingAddress     && <KV k="Billing address" v={draft.billingAddress} />}
        {draft.notificationContacts.length > 0 ? (
          <KV k="Warehouse alerts" v={draft.notificationContacts.filter(c => c.email).map(c => c.name ? `${c.name} <${c.email}>` : c.email).join(', ')} />
        ) : (
          <KV k="Warehouse alerts" v="Main contact only" />
        )}
      </ReviewCard>

      <ReviewCard title="Terms & Signature" onEdit={() => onJumpTo(3)}>
        <KV k="Insurance" v={insuranceLabel} />
        <KV k="Auto-inspection" v={draft.autoInspect ? 'Opted in — Stride will inspect every inbound shipment' : 'Off — inspections by request only'} />
        <KV k="Sections initialed" v={['storage','insurance','billing','lien','general'].map(k => `${k}:${(draft.sectionInitials[k] || '—')}`).join(' · ')} />
        {draft.signatureType === 'typed' ? (
          <KV k="Signature" v={<span style={{ fontFamily: "'Caveat', cursive", fontSize: 22 }}>{draft.typedSignature || '—'}</span>} />
        ) : sigDataUrl ? (
          <KV k="Signature" v={<img alt="signature" src={sigDataUrl} style={{ maxHeight: 64, border: `1px solid ${BORDER}`, borderRadius: 6, padding: 4, background: '#fff' }} />} />
        ) : (
          <KV k="Signature" v="—" />
        )}
      </ReviewCard>

      <ReviewCard title="Payment" onEdit={() => onJumpTo(4)}>
        <KV k="Authorized" v={draft.paymentAuthorized ? 'Yes — Paymnt.io setup confirmed' : 'Not confirmed'} />
      </ReviewCard>

      <ReviewCard title="Tax & Documents" onEdit={() => onJumpTo(5)}>
        <KV k="Tax status" v={
          draft.taxExempt === true ? `Wholesale exempt (${draft.taxExemptReason})`
          : draft.taxExempt === false ? 'End customer — tax applies'
          : '—'
        } />
        {draft.taxExempt === true && (
          <>
            <KV k="Resale cert" v={draft.resaleCertFile?.name || '— (will follow up)'} />
            {draft.resaleCertExpires && <KV k="Cert expires" v={draft.resaleCertExpires} />}
          </>
        )}
        <KV k="Other files" v={draft.otherFiles.length > 0 ? draft.otherFiles.map(f => f.name).join(', ') : '—'} />
      </ReviewCard>
    </div>
  );
}

// ─── Leaf UI primitives ──────────────────────────────────────────────

interface StepProps {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
}

function StepTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: ACCENT, textTransform: 'uppercase', marginBottom: 6 }}>{kicker}</div>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, color: TEXT }}>{title}</h1>
    </div>
  );
}

function Field({ label, children, span }: { label: string; children: React.ReactNode; span?: 1 | 2 }) {
  return (
    <div style={{ gridColumn: span === 2 ? 'span 2' : undefined }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: TEXT_MUT, textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = 'text', style }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; style?: React.CSSProperties;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: '10px 12px', fontSize: 14, fontFamily: FONT,
        background: '#fff',
        border: `1px solid ${BORDER}`, borderRadius: 10, outline: 'none',
        color: TEXT,
        ...style,
      }}
    />
  );
}

function TextArea({ value, onChange, placeholder, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{
        width: '100%', boxSizing: 'border-box',
        padding: '10px 12px', fontSize: 14, fontFamily: FONT,
        background: '#fff', resize: 'vertical',
        border: `1px solid ${BORDER}`, borderRadius: 10, outline: 'none',
        color: TEXT,
      }}
    />
  );
}

function InsuranceCard({ selected, onSelect, title, body }: { selected: boolean; onSelect: () => void; title: string; body: string }) {
  return (
    <button
      onClick={onSelect}
      style={{
        textAlign: 'left', cursor: 'pointer', fontFamily: FONT,
        padding: 14, borderRadius: 12,
        background: selected ? '#fff' : BG_CARD,
        border: `2px solid ${selected ? ACCENT : BORDER}`,
        transition: 'all 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
          background: selected ? ACCENT : 'transparent',
          border: `2px solid ${selected ? ACCENT : TEXT_MUT}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {selected && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{title}</div>
      </div>
      <div style={{ fontSize: 12, color: TEXT_SEC, marginTop: 8, lineHeight: 1.5 }}>{body}</div>
    </button>
  );
}

function SigTabBtn({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '7px 14px', fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase',
        borderRadius: 100, border: `1px solid ${active ? ACCENT : BORDER}`,
        background: active ? ACCENT : '#fff',
        color: active ? '#fff' : TEXT_SEC,
        cursor: 'pointer', fontFamily: FONT,
      }}
    >
      {children}
    </button>
  );
}

function FileUploadBlock({ label, description, file, onPick }: { label: string; description: string; file: File | null; onPick: (f: File | null) => void }) {
  return (
    <div style={{ border: `1px dashed ${BORDER}`, borderRadius: 12, padding: 18, background: BG_PAGE }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 12, color: TEXT_MUT, marginBottom: 12 }}>{description}</div>
      {file ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#fff', borderRadius: 10, fontSize: 13 }}>
          <FileText size={14} color={ACCENT} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
          <span style={{ color: TEXT_MUT, fontSize: 11 }}>{(file.size / 1024).toFixed(0)} KB</span>
          <button onClick={() => onPick(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B45A5A' }}><Trash2 size={13} /></button>
        </div>
      ) : (
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '10px 18px', borderRadius: 100,
          background: '#fff', border: `1px solid ${BORDER}`,
          color: TEXT, fontSize: 12, fontWeight: 600, letterSpacing: '1px',
          cursor: 'pointer',
        }}>
          <Upload size={13} /> Choose file
          <input type="file" style={{ display: 'none' }} accept=".pdf,.png,.jpg,.jpeg,.heic"
                 onChange={e => onPick(e.target.files?.[0] ?? null)} />
        </label>
      )}
    </div>
  );
}

function ReviewCard({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, padding: 16, marginBottom: 12, background: BG_CARD }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>{title}</div>
        <button onClick={onEdit} style={editBtn}>
          <Edit3 size={11} /> Edit
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {children}
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, fontSize: 13 }}>
      <div style={{ color: TEXT_MUT, fontWeight: 500 }}>{k}</div>
      <div style={{ color: TEXT }}>{v || <span style={{ color: TEXT_MUT }}>—</span>}</div>
    </div>
  );
}

// ─── Utilities ───────────────────────────────────────────────────────

function replaceTokens(html: string, draft: Draft, coverageNotes: PublicCoverageNote[] = []): string {
  // Build a lookup of coverage-option id → note so the T&C tokens
  // resolve to whatever the Price List has *right now*. Ids we know
  // about ship with dedicated tokens; anything missing from the table
  // renders an em-dash rather than a literal `{{TOKEN}}` that would
  // confuse the prospect.
  const byId = new Map(coverageNotes.map(c => [c.id, c.note || '']));
  const noteFor = (id: string): string => byId.get(id) || '—';
  return html
    .replace(/\{\{BUSINESS_NAME\}\}/g, escapeHtml(draft.businessName || '[Business Name]'))
    .replace(/\{\{SIGNED_DATE\}\}/g, escapeHtml(new Date().toLocaleDateString()))
    .replace(/\{\{COVERAGE_STANDARD_NOTE\}\}/g, escapeHtml(noteFor('standard')))
    .replace(/\{\{COVERAGE_FND_NOTE\}\}/g, escapeHtml(noteFor('fnd')))
    .replace(/\{\{COVERAGE_FWD_NOTE\}\}/g, escapeHtml(noteFor('fwd')))
    .replace(/\{\{COVERAGE_STORAGE_NOTE\}\}/g, escapeHtml(noteFor('storage_added')));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface TcParseResult {
  intro: string;
  signature: string;
  sections: { key: string; label: string; html: string }[];
}
function parseTcSections(html: string): TcParseResult {
  if (!html || typeof DOMParser === 'undefined') {
    return { intro: '', signature: '', sections: [] };
  }
  // Use a detached document so the prose doesn't inherit page styles.
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const body = doc.body;
  const intro = body.querySelector('section[data-tc-intro]')?.innerHTML ?? '';
  const signature = body.querySelector('section[data-tc-signature]')?.innerHTML ?? '';
  const sections: TcParseResult['sections'] = [];
  body.querySelectorAll('section[data-tc-section]').forEach(el => {
    const key = el.getAttribute('data-tc-section') || '';
    const labelRaw = el.getAttribute('data-tc-label') || key;
    // decode HTML entities in the label (data-tc-label contained &amp; etc)
    const tmp = document.createElement('div');
    tmp.innerHTML = labelRaw;
    const label = tmp.textContent || labelRaw;
    sections.push({ key, label, html: el.innerHTML });
  });
  return { intro, signature, sections };
}

// ─── Styles ──────────────────────────────────────────────────────────

const pageShell: React.CSSProperties = {
  fontFamily: FONT, minHeight: '100vh', background: BG_PAGE,
  padding: 24, maxWidth: 880, margin: '0 auto',
};
const cardWrap: React.CSSProperties = {
  background: BG_CARD, borderRadius: 20, border: `1px solid ${BORDER}`,
  boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
  padding: 28,
};
const tcProseStyle: React.CSSProperties = {
  fontSize: 13, color: TEXT_SEC, lineHeight: 1.65,
};
const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '12px 22px', fontSize: 12, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase',
  background: disabled ? '#C9C2B8' : ACCENT, color: '#fff',
  border: 'none', borderRadius: 100, cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: FONT,
  boxShadow: disabled ? 'none' : '0 4px 14px rgba(232,105,42,0.24)',
});
const secondaryBtn = (disabled: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '12px 22px', fontSize: 12, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase',
  background: '#fff', color: disabled ? TEXT_MUT : TEXT_SEC,
  border: `1px solid ${BORDER}`, borderRadius: 100,
  cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: FONT,
});
const addRowBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '6px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase',
  background: ORANGE_SOFT, color: ACCENT,
  border: `1px solid ${ACCENT}55`, borderRadius: 100, cursor: 'pointer', fontFamily: FONT,
};
const removeBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: '#B45A5A', padding: 8,
};
const editBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '5px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
  background: '#fff', color: TEXT_SEC, border: `1px solid ${BORDER}`, borderRadius: 100,
  cursor: 'pointer', fontFamily: FONT,
};
const otherUploadBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '10px 18px', borderRadius: 100,
  background: '#fff', border: `1px solid ${BORDER}`,
  color: TEXT, fontSize: 12, fontWeight: 600, letterSpacing: '1px',
  cursor: 'pointer', fontFamily: FONT,
};

export default ClientIntake;
