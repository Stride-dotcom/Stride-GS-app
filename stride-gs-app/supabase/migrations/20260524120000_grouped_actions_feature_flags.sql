-- 2026-05-24 — Feature flag rows for the 12 grouped SB Edge Functions
-- introduced in feat/migration/p7-remaining-handlers.
--
-- Project context: stride-gs-app/MIGRATION_STATUS.md.
--
-- Each grouped EF (marketing-actions-sb, claims-actions-sb, etc) handles
-- many GAS apiPost actions but is gated by ONE feature_flags row keyed
-- by the grouped flagKey (matches src/lib/apiRouter.ts GAS_TO_SB_MAP).
-- Operator flips the row to active_backend='supabase' → every grouped
-- action under that EF routes to SB. Per-action granularity is achieved
-- later by splitting an action out into its own -sb EF (and adding a
-- separate feature_flags row).
--
-- All rows seed at active_backend='gas' so this migration is a no-op for
-- live traffic. The Settings → Migration tab surfaces them so the
-- operator can flip per-grouped-area when ready.

INSERT INTO public.feature_flags (function_key, active_backend, parity_enabled, notes)
VALUES
  ('marketingActions',  'gas', false, 'P7 — marketing-actions-sb proxies 18 marketing actions to GAS.'),
  ('claimActions',      'gas', false, 'P7 — claims-actions-sb proxies 12 claim lifecycle actions to GAS.'),
  ('staxActions',       'gas', false, 'P7 — stax-actions-sb proxies 21 Stax payment admin actions to GAS.'),
  ('qbActions',         'gas', false, 'P7 — qb-actions-sb proxies QuickBooks admin actions to GAS.'),
  ('repairExtras',      'gas', false, 'P7 — repair-extras-sb: correctRepairResult, reopenRepair, voidRepairQuote.'),
  ('wcExtras',          'gas', false, 'P7 — wc-extras-sb: generateWcDoc, batchCancel/Schedule WillCalls.'),
  ('taskBatchOps',      'gas', false, 'P7 — task-batch-ops-sb: batch reassign/quote/split + work-order PDF.'),
  ('billingExtras',     'gas', false, 'P7 — billing-extras-sb: markBillingActivityResolved, resendInvoiceEmail, previewStorageCharges, etc.'),
  ('locationActions',   'gas', false, 'P7 — location-actions-sb: updateLocation, deleteLocation.'),
  ('adminUsers',        'gas', false, 'P7 — admin-users-sb: adminSetUserPassword, ensureAuthUser, sendWelcomeEmail, etc.'),
  ('emailTemplates',    'gas', false, 'P7 — email-templates-sb: updateEmailTemplate, syncTemplatesToClients.'),
  ('clientSetup',       'gas', false, 'P7 — client-setup-sb: finishClientSetup, updateClient, syncSettings, etc.')
ON CONFLICT (function_key) DO NOTHING;
