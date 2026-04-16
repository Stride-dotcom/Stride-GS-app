# SALA PHASE 15 — STORAGE / MEDIA / FILE SYSTEM DEEP AUDIT (Stride WMS)

Governed by: `SALA_PROMPT_STANDARD_v1.0.md`  
Template: `/docs/systems/SALA_TEMPLATE_v1.2.md`  
Role: Lead Systems Architect

## TARGET OUTPUT FILE (ONLY FILE YOU MAY EDIT)
- `/docs/systems/storage-media/SYSTEM_MASTER.md`

---

## OPERATING CONSTRAINTS (MANDATORY)
- Perform **static repository inspection only** (documentation-only).
- Edit **only** the target output file above.
- If the target file is missing, create it using the SALA template structure.
- Do **not** modify any other files.
- Do **not** execute migrations, tests, RPC calls, edge functions, SQL consoles, storage API calls, or live URL generation.
- Do **not** assume runtime behavior; mark unknowns as `[Unverified]`.
- No speculation: every substantive claim must include evidence.
- If governing/template files are missing, continue best-effort and record as `[Risk]`.

### Evidence priority (highest → lowest)
1. DB migrations (including storage policy migrations)
2. SQL policies/functions/RPCs
3. Edge functions / server logic
4. Generated `types.ts` / schema artifacts
5. Frontend code (hooks/components/pages)
6. UI literals (lowest authority)

### Versioning rules
- If target file is new → **Doc Version 1.0**.
- If target file exists → increment **MINOR** version (X.Y → X.Y+1).
- Add a Change Log entry.
- Determine version dynamically (never hardcode from this prompt).

### Conflict authority
`DB migration > SQL policy/function > edge function > types.ts > backend constant > UI literal`

---

## AUDIT OBJECTIVE
Produce a cross-system storage/media architecture audit that verifies and evidences:
- All storage buckets used by the app
- Upload/download flows (client vs server vs edge function)
- Signed URL generation paths and constraints
- Public bucket exposure and policy posture
- Tenant/account isolation enforcement for files
- Object path conventions and scoping strategy
- Evidence/media usage by system (Receiving, Claims, Shipments, Tasks, Portal, etc.)
- Retention/deletion behavior (if present)
- PII leakage risks via filenames/paths/URLs
- Bypass risks (direct storage calls vs controlled wrappers)
- Drift risks (divergent helpers for signed URLs/uploads)

Scope: **storage/media posture only** (not feature behavior).

---

## DISCOVERY REQUIREMENTS (DR-1 → DR-16)

### DR-1 STORAGE/MEDIA ARCHITECTURE OVERVIEW
Document:
- High-level storage model (Supabase buckets + paths)
- Trust boundaries (client vs server vs edge)
- Where authorization is enforced (storage policies vs app checks vs RPC)
- Explicit assumptions

### DR-2 BUCKET INVENTORY (CANONICAL)
Enumerate all buckets referenced in repo:
- Bucket name
- Intended purpose
- Read/write posture (public/private/signed URL)
- Systems using it

### DR-3 OBJECT PATH CONVENTIONS & SCOPING
Document implemented path patterns:
- `tenant_id`, `account_id`, entity ID prefixes
- Filename sanitization rules (if any)
- Mark inconsistent scoping as `[Risk]`

### DR-4 UPLOAD FLOWS (BY ENTRY POINT)
Trace canonical flows by media type:
- Shipment photos
- Receiving photos/docs
- Claim evidence
- Signatures
- Task photos/docs (if present)
- Portal uploads

Pattern:
`UI component → hook/service → storage call or RPC/edge proxy → object key/path → DB linkage (if any) → UI feedback`

### DR-5 DOWNLOAD / VIEW FLOWS
Trace read/view flows:
- Public URL usage
- Signed URL generation locations
- Caching rules
- Expiration durations (if statically visible)

### DR-6 SIGNED URL GENERATION SURFACE (CRITICAL)
For every signed-URL generator (frontend/server/RPC/edge), document:
- Required inputs (bucket, path, role context)
- Auth checks present/absent
- TTL/expiry (if statically discoverable)
- Multiple inconsistent implementations → `[Risk]`

### DR-7 STORAGE POLICY ENFORCEMENT (SQL/RLS)
Document:
- Storage policy migration files
- Policy names + operations (`SELECT/INSERT/UPDATE/DELETE`)
- Tenant/account scoping clauses
- Permissive patterns (e.g., broad authenticated read)
- Missing tenant/account boundaries → `[Critical Risk]`

### DR-8 DB LINKAGE TABLES FOR MEDIA
Document media linkage tables (if present), including:
- FK relationships
- Tenant/account keys
- Delete behavior (cascade/orphan)
- RLS posture references

### DR-9 MEDIA SECURITY & PRIVACY RISKS
Evaluate with evidence:
- PII in object keys/filenames
- Public buckets/URLs
- Predictable enumeratable paths
- Long-lived signed URLs lacking scoping

Label findings as `[Risk]` or `[Critical Risk]`.

### DR-10 SERVICE ROLE / PRIVILEGED ACCESS
Search for:
- Service role usage in edge/server storage operations
- Env var exposure patterns
- Any client-side privileged capability (`[Critical Risk]`)

### DR-11 DIRECT STORAGE CALLS VS WRAPPERS (BYPASS)
Identify:
- Direct storage usage in pages/components
- Centralized wrappers/helpers
- Bypass of checks/logging → `[Risk]`

### DR-12 RETENTION / DELETION / LIFECYCLE
Document:
- Retention policy evidence
- Deletion flows (entity delete/void/archive)
- Orphan cleanup jobs/scripts

If absent: mark `[N/A]` with search proof or `[Unverified]` if likely external.

### DR-13 CROSS-SYSTEM MEDIA COVERAGE MATRIX
Create matrix:
`System → Media types → Buckets → DB linkage tables → URL type (public/signed) → Policy posture`

Unknowns must be `[Unverified]` or `[N/A]`.

### DR-14 CLIENT PORTAL MEDIA BOUNDARIES
Document:
- Portal upload/view/download capabilities
- Enforcement posture (RLS-only vs explicit account scoping)
- Cross-account risk in shared tenant bucket paths
- UI-only filtering boundaries → `[Risk]`

### DR-15 ERROR HANDLING & UX STATES (STATIC)
For major upload/download flows, document visible handling for:
`400/401/403/404/413/500`

If not statically visible, mark `[Unverified]` with evidence.

### DR-16 HARDENING RECOMMENDATIONS (DOC-ONLY)
Provide prioritized recommendations (High/Med/Low):
- Policy tightening
- Path scoping standardization
- Signed URL helper consolidation
- Logging/audit hooks
- Safe defaults for future buckets/entities

No code changes beyond target doc.

---

## EVIDENCE STANDARD (STRICT)
For every non-trivial claim, include at least one primary source:
- Migration file path(s)
- SQL policy/function reference
- Edge/server file path
- Frontend file path + symbol/function
- Line range(s) or exact static-search proof snippet

Every substantive finding must include one status label:
- `Confirmed`
- `[Unverified]`
- `[Risk]`
- `[Critical Risk]`
- `[N/A]`

No `Confirmed` claim without direct static evidence.

---

## COMPLETION CHECKLIST (REQUIRED INSIDE EXECUTION SUMMARY)
Include this checklist immediately before Execution Summary close:
- [ ] DR-1 evidence complete
- [ ] DR-2 evidence complete
- [ ] DR-3 evidence complete
- [ ] DR-4 evidence complete
- [ ] DR-5 evidence complete
- [ ] DR-6 evidence complete
- [ ] DR-7 evidence complete
- [ ] DR-8 evidence complete
- [ ] DR-9 evidence complete
- [ ] DR-10 evidence complete
- [ ] DR-11 evidence complete
- [ ] DR-12 evidence complete
- [ ] DR-13 evidence complete
- [ ] DR-14 evidence complete
- [ ] DR-15 evidence complete
- [ ] DR-16 evidence complete

For each unchecked item, include a one-line reason + missing evidence type.

---

## RESPONSE FORMAT (STRICT)
Return exactly two sections and nothing else:
1. **Concise Change Summary** (max 15 bullets)
2. **Execution Summary** in exactly one fenced code block

Execution Summary block requirements:
- Must be complete and copy/paste ready
- Max 60 lines
- Must include completion checklist status
- Must explicitly list:
  - Buckets discovered
  - Policies found (with file references)
  - Signed URL generation surfaces
  - `[Critical Risk]` findings (if any)
- Must be the **final content** in the response (nothing after the code block)

Do **not** output full document contents.  
Do **not** claim runtime verification.  
Static inspection only.
