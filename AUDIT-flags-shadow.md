# Audit — Feature Flags, Shadow Verification, GAS Traffic

**Date:** 2026-05-24
**Scope:** Stride GS App, Supabase project `uqplppugeickmamycpuz`.
**Source of truth for code findings:** canonical clone `C:\dev\Stride-GS-app` @ `source` (`8ceaa0d8`, 2026-05-24).

---

## Executive note on data-collection scope

This audit has **two halves**.

- **Code-side findings (sections 1, 5):** complete. Read directly from the canonical clone.
- **Database-side findings (sections 2, 3, 4):** **not executed**. The builder environment used for this audit has no Supabase MCP and no `SUPABASE_ACCESS_TOKEN` — confirmed by the `feedback_supabase_deploy_token.md` operator note. The four `SELECT` queries in the audit brief MUST be run by an operator with service-role access (Supabase SQL Editor or `psql` with the service connection string) and the results pasted into the placeholder blocks below.

Two of the audit-brief queries also have **schema mismatches against current production**; corrected versions appear inline below the originals. Running the originals as-written returns an error.

---

## 1. Feature Flags State

**Query (as specified, runs as-is):**

```sql
SELECT * FROM feature_flags ORDER BY action_key;
```

**⚠ Column name caveat:** the table's primary lookup column is `function_key`, not `action_key`. The migration that creates the table (`supabase/migrations/20260509000001_migration_parity_substrate.sql`) defines:

```
function_key, active_backend, shadow_backend, parity_enabled,
tenant_scope, total_checks, mismatch_count, mismatch_count_7d,
last_parity_check, created_at, ...
```

If `action_key` does not exist, the operator should rewrite the `ORDER BY` to `function_key`. `SELECT *` will still succeed; only the ORDER BY clause will fail as-written.

**Operator action — paste full row dump here:**

```
TODO(operator): paste results of
  SELECT * FROM feature_flags ORDER BY function_key;
```

**Cross-reference (from `stride-gs-app/MIGRATION_STATUS.md`, last edited 2026-05-20):** doc claims 25 flag rows seeded at P1.1; live shadow firing wired for 20/33 GAS actions in PR #480 (2026-05-20); 100% shadow-coverage milestone declared 2026-05-19 (PR #461, commit `f4cef110`). Verify row count from the SELECT matches that figure (≥ 25 expected; if 33, that confirms the post-#480 seeding ran).

---

## 2. Shadow Health (parity_results 7d rollup)

**Query (as specified — WILL ERROR, see correction below):**

```sql
SELECT function_key,
  COUNT(*) FILTER (WHERE match = true) as matches,
  COUNT(*) FILTER (WHERE match = false AND details::text LIKE '%Failed to send%') as transport_failures,
  COUNT(*) FILTER (WHERE match = false AND details::text NOT LIKE '%Failed to send%') as real_mismatches,
  MAX(created_at) as last_seen
FROM parity_results
GROUP BY function_key
ORDER BY function_key;
```

**⚠ Schema mismatch:** the table column is `mismatch_details`, not `details`. Confirmed at `supabase/migrations/20260509000001_migration_parity_substrate.sql:154`. The query above raises `column "details" does not exist`.

**Corrected query:**

```sql
SELECT function_key,
  COUNT(*) FILTER (WHERE match = true) AS matches,
  COUNT(*) FILTER (
    WHERE match = false
      AND mismatch_details::text LIKE '%Failed to send%'
  ) AS transport_failures,
  COUNT(*) FILTER (
    WHERE match = false
      AND (mismatch_details IS NULL OR mismatch_details::text NOT LIKE '%Failed to send%')
  ) AS real_mismatches,
  MAX(created_at) AS last_seen,
  COUNT(*) AS total_rows
FROM parity_results
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY function_key
ORDER BY function_key;
```

(The original omits a window predicate; adding `WHERE created_at > NOW() - INTERVAL '7 days'` matches the "shadow health, recent" intent and aligns with how `feature_flags.mismatch_count_7d` is rolled up by the trigger in `20260511220000_parity_results_rollup_trigger.sql`.)

**Operator action — paste results here:**

```
TODO(operator): paste results of corrected query above.
```

**Notes on classifying the buckets when reading the result (per code in `stride-gs-app/src/lib/shadowRunner.ts:166-172` and `src/lib/fireShadow.ts:100`):**

- `transport_failures` as defined here counts **both**:
  - genuine network failures (rare) AND
  - **shadow EF returning HTTP 400 on `result.ok === false`** (see section 5). The latter dominates the bucket. Treat the "transport_failures" count as a **lower bound on shadow-rejected-input events**, not as a network-health metric.
- `real_mismatches` here is "shadow ran, returned 200, but hash diverged from GAS." For shadows still in `handler_drafted`/`shadow_live` phase this is the load-bearing parity signal.
- A row with `matches=0, transport_failures>0` and recent `last_seen` means the shadow is firing but **every call is being recorded as a rejection** — i.e. the function is dark even though the dashboard column moves.

---

## 3. GAS Traffic — top 40 actions in last 7 days

**Query (as specified — WILL ERROR, see correction below):**

```sql
SELECT action, COUNT(*) as calls, MAX(created_at) as last_call
FROM gas_call_log
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY action
ORDER BY calls DESC
LIMIT 40;
```

**⚠ Schema mismatch:** `gas_call_log`'s timestamp column is `called_at`, not `created_at`. Confirmed at `supabase/migrations/20260509000001_migration_parity_substrate.sql:201` and exercised throughout `supabase/functions/replay-shadow/index.ts`.

**Corrected query:**

```sql
SELECT action,
       COUNT(*)        AS calls,
       MAX(called_at)  AS last_call
FROM gas_call_log
WHERE called_at > NOW() - INTERVAL '7 days'
GROUP BY action
ORDER BY calls DESC
LIMIT 40;
```

**Operator action — paste results here:**

```
TODO(operator): paste results of corrected query above.
```

**Reference set to compare results against (from `replay-shadow.SHADOW_REGISTRY` + `src/lib/shadowRegistry.ts` — actual on-disk shadow Edge Functions):**

```
cancel-repair-shadow            request-repair-quote-shadow
complete-repair-shadow          respond-repair-quote-shadow
complete-task-shadow            send-repair-quote-shadow
start-repair-shadow             start-task-shadow
update-item-shadow
```

(9 shadow EFs registered on disk; `replay-shadow/index.ts` itself is the harness, not a shadow.)

Any `action` in the top-40 with **no corresponding `*-shadow` directory** is a tracked-but-unshadowed GAS write. Useful for the PM to see relative dark-volume.

---

## 4. Untracked GAS Actions

**Query (as specified):**

```sql
SELECT action, call_count, last_seen_at FROM untracked_gas_actions ORDER BY call_count DESC LIMIT 30;
```

**⚠ Table existence not confirmed in source.** Grep across the canonical clone returns **zero references** to `untracked_gas_actions` (checked `stride-gs-app/supabase/migrations/`, `stride-gs-app/supabase/functions/`, `AppScripts/`, and `stride-gs-app/src/`). Possibilities:

- (a) it's a view defined in a migration not yet committed,
- (b) it's a view created ad-hoc in the Supabase SQL editor and never captured in source,
- (c) it doesn't exist and the query will return `relation "untracked_gas_actions" does not exist`.

**Operator action:**

1. First confirm existence:

   ```sql
   SELECT to_regclass('public.untracked_gas_actions');
   ```

   - If `NULL`: the table/view doesn't exist. Note that in this section and skip.
   - If non-null: run the LIMIT 30 query and paste below.

2. Paste results here:

```
TODO(operator): existence check result + (if exists) top-30 rows.
```

If the table does exist, also worth running:

```sql
SELECT pg_get_viewdef('public.untracked_gas_actions'::regclass);
```

…to recover the definition for source-of-truth capture.

---

## 5. Shadow HTTP 400 Bug — status

**State: PRESENT and uniform across the entire shadow fleet.**

### Finding

Every audit-shape shadow Edge Function on disk uses the same response pattern:

```ts
return new Response(JSON.stringify(result), {
  status: result.ok ? 200 : 400,
  headers: { 'Content-Type': 'application/json' },
});
```

Verified at:

```
supabase/functions/update-item-shadow/index.ts:183
supabase/functions/cancel-repair-shadow/index.ts:75
supabase/functions/complete-repair-shadow/index.ts:60
supabase/functions/complete-task-shadow/index.ts:85
supabase/functions/request-repair-quote-shadow/index.ts:80
supabase/functions/respond-repair-quote-shadow/index.ts:63
supabase/functions/send-repair-quote-shadow/index.ts:59
supabase/functions/start-repair-shadow/index.ts:66
supabase/functions/start-task-shadow/index.ts:69
```

— i.e. **9/9 shadow EFs** return HTTP 400 (a transport-level error code) whenever the shadow's business-logic validation rejects the payload (`result.ok === false`). A separate `400` is also returned for malformed JSON bodies; that one is appropriate.

The malformed-JSON path is fine. The `result.ok ? 200 : 400` path is the bug.

### Why it matters — call-site behavior

`fireShadow` (the live-traffic shadow invoker at `stride-gs-app/src/lib/fireShadow.ts:94-104`) calls:

```ts
const { data, error } = await supabase.functions.invoke<…>(spec.ef, { body: payload });
if (error) throw new Error(error.message);
…
```

Supabase JS v2's `.functions.invoke()` treats any HTTP response with `status >= 400` as a `FunctionsHttpError` — it populates `error` with a generic message and **does NOT surface the response JSON body** through `data`. So when a shadow rejects input with HTTP 400 + JSON `{ ok: false, error: "Invalid status: Foo" }`:

1. `data` is null; `error.message` is a generic string (commonly `"Edge Function returned a non-2xx status code"` or, in older SDK versions / network-stack edge cases, `"Failed to send a request to the Edge Function"` — same code path on the client).
2. fireShadow throws that string.
3. `shadowRunner.ts:166-172` catches the throw and records the row with `sb.hash = 'ERROR'`, `mismatch_details.sb = "Shadow invoke threw: <msg>"`, `mismatch_details.reason = 'shadow_threw'`.
4. `match=false` is written; `mismatch_count_7d` ticks up.
5. The original `{ ok:false, error:"…" }` body — which was the only useful diagnostic — is **lost**.

### Why it matters — replay-harness behavior

`replay-shadow/index.ts:349-370` already special-cases this for the historical-replay path:

```ts
if (!shadowJson.ok || !shadowJson.changes) {
  // Shadow rejected the input. … That's a REAL parity mismatch —
  // shadow's validation is stricter than GAS's. Classify as `mismatch`.
```

…but **only because `replay-shadow` invokes the shadow via raw `fetch()`, which lets it call `.json()` on the 400 body**. The live `fireShadow` path goes through `supabase.functions.invoke()` and gets the body stripped. So replay produces interpretable rows; live traffic does not.

### Net effect on the operator's audit query

The "transport_failures" bucket in the audit-brief query 2 (`mismatch_details::text LIKE '%Failed to send%'`) is **conflating**:

- shadow EF returning HTTP 400 for input it deemed invalid (most volume), **and**
- actual fetch transport failures (rare; only when the EF is genuinely down).

There is no way at the SQL layer today to distinguish them. The substring filter catches both.

### Scope of the fix (not implemented per the audit brief — flagging only)

- **Either** flip all 9 shadow EFs to `status: 200` for the `result.ok === false` case (validation rejection is business logic, not transport),
- **Or** change `fireShadow` to bypass `supabase.functions.invoke()` and call the EF via raw `fetch()` so it can read the 400 body, mirroring what `replay-shadow` already does.

Both paths preserve the upstream `match=false` accounting; they only restore the diagnostic body that's currently being thrown away. **No change attempted in this audit per the task brief.**

---

## Appendix — current shadow + SB-handler inventory on disk

Captured 2026-05-24 from `C:\dev\Stride-GS-app\stride-gs-app\supabase\functions\`:

**Shadow EFs (audit-shape parity only, no real write):**
`cancel-repair-shadow`, `complete-repair-shadow`, `complete-task-shadow`, `request-repair-quote-shadow`, `respond-repair-quote-shadow`, `send-repair-quote-shadow`, `start-repair-shadow`, `start-task-shadow`, `update-item-shadow`. (9 total.)

**SB-primary handlers (`-sb` — real Supabase write path, routed when `feature_flags.active_backend='supabase'`):**
`batch-create-tasks-sb`, `cancel-repair-sb`, `commit-storage-charges-sb`, `complete-repair-sb`, `complete-shipment-sb`, `create-invoice-sb`, `create-stax-invoices-sb`, `create-will-call-sb`, `generate-unbilled-report-sb`, `import-iif-sb`, `onboard-client-sb`, `process-wc-release-sb`, `qbo-create-invoice-sb`, `reissue-invoice-sb`, `release-items-sb`, `request-repair-quote-sb`, `respond-repair-quote-sb`, `run-stax-charges-sb`, `send-repair-quote-sb`, `send-shipment-email-sb`, `send-task-complete-email-sb`, `send-will-call-emails-sb`, `start-repair-sb`, `transfer-items-sb`, `update-item-sb`, `update-repair-sb`, `update-task-sb`, `void-invoice-sb`. (28 total.)

**Harness / replay:** `replay-shadow` (manually invoked historical-corpus runner per `MIGRATION_STATUS.md` P1.7).

---

## Appendix — recent migration-related commits (for context)

```
8ceaa0d8 fix(create-invoice-sb): outer try/catch + log all error paths so 500s are visible (#515)
706f962d [MIGRATION-P2/MIG-016] SB-primary routing layer + update-item-sb real handler (#502)
b7af9e39 feat(migration): 4 new SB-primary handlers + tasks reverse-writethrough
98fa312d [MIGRATION-P1.9] Wire live audit-shape shadow firing into apiPost (20 GAS actions) (#480)
412e4d53 fix: code-review folds — narrow update-item strip, mirror request-quote shadow string, drop completeRepair p.result fallback, defensive try/catch
f4cef110 docs: MIGRATION_STATUS + BUILD_STATUS — 2026-05-19 100% shadow coverage (#461)
4d954227 feat(migration): Parity Dashboard observation surface (#451)
21db0df8 [MIGRATION-P3/P5] code-review fixes: per-entry entity_type in replay-shadow … + remove stricter-than-GAS validation from all 5 shadows
6bbf753a [MIGRATION-P3/P5] feature_flags parity-on for 5 ops shadows (active stays gas)
22119437 [MIGRATION-P6] register payment shadows: feature_flags parity-on + SHADOW_REGISTRY (active stays gas)
2fd6453c [MIGRATION-P4a] feature_flags: parity-on for createInvoice/voidInvoice, seed generateUnbilledReport
```

These date the current `feature_flags` / shadow surface and let the PM correlate the row dump in section 1 against the timeline.
