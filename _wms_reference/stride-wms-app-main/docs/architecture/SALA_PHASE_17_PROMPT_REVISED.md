SALA PHASE 17 — ARCHITECTURAL RISK REGISTER CONSOLIDATION (Stride WMS)

Governed by: SALA_PROMPT_STANDARD_v1.0.md  
Role: Lead Systems Architect

TARGET OUTPUT FILE
- /docs/architecture/ARCH_RISK_REGISTER.md

═══════════════════════════════════════════════════
MISSION
═══════════════════════════════════════════════════

Consolidate all architectural risks, drift flags, and unresolved findings from merged SALA `SYSTEM_MASTER` documents into a single canonical risk register.

This is a documentation extraction/classification task only.

═══════════════════════════════════════════════════
OPERATING CONSTRAINTS (MANDATORY)
═══════════════════════════════════════════════════

- Static documentation review only (no runtime validation).
- Modify ONLY `/docs/architecture/ARCH_RISK_REGISTER.md`.
- If the target file does not exist, create it.
- Do NOT modify any `SYSTEM_MASTER` file.
- Do NOT execute migrations, builds, tests, RPC calls, or edge functions.
- Do NOT invent new risks; extract only documented findings/evidence.
- Every entry must include source document + DR section reference.
- If evidence is ambiguous, mark as `Evidence Gap` (do not escalate severity).

Versioning rules:
- New target file → Doc Version `1.0`.
- Existing target file → increment minor version (e.g., `1.2` → `1.3`).
- Add dated changelog entry summarizing this consolidation pass.

═══════════════════════════════════════════════════
SOURCE DOCUMENTS (MANDATORY INPUT SET)
═══════════════════════════════════════════════════

Scan all of the following if present:

- /docs/systems/shipments/SYSTEM_MASTER.md
- /docs/systems/inventory/SYSTEM_MASTER.md
- /docs/systems/receiving-dock-intake/SYSTEM_MASTER.md
- /docs/systems/tasks/SYSTEM_MASTER.md
- /docs/systems/routing/SYSTEM_MASTER.md
- /docs/systems/claims/SYSTEM_MASTER.md
- /docs/systems/billing/SYSTEM_MASTER.md
- /docs/systems/capacity-heatmap/SYSTEM_MASTER.md
- /docs/systems/alerts/SYSTEM_MASTER.md
- /docs/systems/client-portal/SYSTEM_MASTER.md
- /docs/systems/security/SYSTEM_MASTER.md
- /docs/systems/storage-media/SYSTEM_MASTER.md
- /docs/systems/quotes/SYSTEM_MASTER.md
- Any additional merged SALA `SYSTEM_MASTER` documents in `/docs/systems/**/SYSTEM_MASTER.md`.

If any expected file is missing, list it explicitly in Execution Summary under `Missing Inputs`.

═══════════════════════════════════════════════════
EXTRACTION RULES
═══════════════════════════════════════════════════

Extract only items explicitly labeled or directly evidenced as:

- `[Critical Risk]`
- `[Risk]`
- `[Unverified]`
- `[Dead]`
- Drift inconsistencies
- Missing enforcement
- Incomplete policy coverage
- Bypass risks
- Status machine inconsistencies
- Transactionality gaps
- Idempotency gaps
- Direct insert violations
- RLS gaps
- Storage exposure risks
- Default service charge type gaps

Exclude:
- Confirmed-safe findings
- Informational-only notes
- Cosmetic refactors
- Recommendations without evidence

═══════════════════════════════════════════════════
RISK CLASSIFICATION MODEL (MANDATORY)
═══════════════════════════════════════════════════

For each risk, assign:

Severity:
- Critical | High | Medium | Low

Impact Domain (multi-select):
- Revenue Integrity
- Tenant Isolation
- Account Isolation
- Data Loss
- Billing Accuracy
- Repair Workflow
- Security Exposure
- Storage Exposure
- Performance
- Operational Drift

Source:
- SYSTEM_MASTER path
- DR section number

Confidence:
- Confirmed Risk (explicitly labeled)
- Derived Risk (supported by explicit documented evidence)
- Evidence Gap (previously labeled `[Unverified]` or incomplete evidence)

Remediation Complexity:
- Small (isolated change)
- Medium (multi-file/system)
- Large (cross-system or architectural)

Normalization rules:
- Preserve original risk wording in `Source Evidence`.
- When consolidating duplicates, keep one canonical risk row and append all source references.
- Do not increase severity beyond highest explicit source severity unless multiple sources justify it; if adjusted, record rationale in one sentence.

═══════════════════════════════════════════════════
OUTPUT STRUCTURE (MANDATORY)
═══════════════════════════════════════════════════

1) Executive Risk Summary
- Total risks by severity
- Top 5 Critical/High risks (with system + DR refs)
- Systems with highest risk density

2) Canonical Risk Register Table
Columns:
- Risk ID
- Severity
- Impact Domain
- System(s)
- DR Reference(s)
- Description
- Source Evidence (quoted or paraphrased with exact refs)
- Confidence
- Remediation Complexity

3) Cross-System Drift Map
- Repeated drift patterns (e.g., RLS drift across N systems)
- Structural risk classes

4) Prioritized Remediation Order
- Phase 1: Immediate stabilization
- Phase 2: Revenue hardening
- Phase 3: Structural cleanup
- Phase 4: Refactor candidates

5) Architectural Maturity Assessment
- Tenant Isolation Score (1–5 + justification)
- Revenue Integrity Score
- Storage Safety Score
- Transactional Consistency Score
- Overall Risk Posture

═══════════════════════════════════════════════════
EVIDENCE & SAFETY GATES (MANDATORY)
═══════════════════════════════════════════════════

Each risk row must include:
- SYSTEM_MASTER path
- DR section number
- Citation to exact labeled risk/evidence text

Hard guards:
- No uncited risk rows.
- No severity escalation without explicit rationale tied to source evidence.
- No claims of runtime verification.
- No edits outside target output file.

═══════════════════════════════════════════════════
COMPLETION CHECKLIST (MANDATORY)
═══════════════════════════════════════════════════

Place immediately before Execution Summary:

- [ ] All available SYSTEM_MASTER files scanned
- [ ] Missing inputs listed (if any)
- [ ] All labeled risks extracted
- [ ] Duplicate risks consolidated
- [ ] Severity classification applied
- [ ] Impact domains assigned
- [ ] Remediation complexity assigned
- [ ] Prioritization sequence created
- [ ] Executive summary completed
- [ ] Maturity assessment completed

Unchecked items must include reason.

═══════════════════════════════════════════════════
RESPONSE FORMAT (STRICT)
═══════════════════════════════════════════════════

Return only:

1) Concise change summary (max 15 bullets)
2) Complete `Execution Summary` in exactly ONE fenced code block:
   - Include: scanned files count, missing inputs, extracted risks count, deduped count, output file path, version decision, and checklist status.
   - Copy/paste ready.
   - No truncation.
   - Maximum 80 lines.
   - Must be final content in response.

Do NOT return full document contents.
Do NOT claim runtime verification.
Static document consolidation only.
