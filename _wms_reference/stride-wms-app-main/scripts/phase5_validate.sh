#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

PROJECT_REF="${PROJECT_REF:-}"
APP_URL="${APP_URL:-}"
STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-}"
STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-}"
TENANT_ID="${TENANT_ID:-}"
DB_PASSWORD="${DB_PASSWORD:-}"

SKIP_DB_PUSH=false
SKIP_DEPLOY=false
SKIP_SECRETS=false
DRY_RUN=false
SUPABASE_CLI=()

EXPECTED_BRANCH="cursor/locked-decision-ledger-cbef"

usage() {
  cat <<'EOF'
Phase 5 deploy/validation helper (non-interactive steps).

Usage:
  bash scripts/phase5_validate.sh [options]

Options:
  --project-ref <ref>           Supabase project ref
  --app-url <url>               App base URL (for Stripe portal return URL)
  --stripe-secret-key <key>     Stripe secret key
  --stripe-webhook-secret <key> Stripe webhook signing secret
  --tenant-id <uuid>            Optional tenant id used in printed SQL checks
  --db-password <password>      Optional remote DB password for non-interactive db push
  --skip-db-push                Skip migration push step
  --skip-deploy                 Skip edge function deploy step
  --skip-secrets                Skip secrets update step
  --dry-run                     Print commands without executing
  -h, --help                    Show this help

Environment variable equivalents:
  PROJECT_REF, APP_URL, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, TENANT_ID, DB_PASSWORD

Examples:
  bash scripts/phase5_validate.sh --project-ref abc123 --app-url https://app.example.com \
    --stripe-secret-key sk_test_xxx --stripe-webhook-secret whsec_xxx

  PROJECT_REF=abc123 APP_URL=https://app.example.com STRIPE_SECRET_KEY=sk_test_xxx \
    STRIPE_WEBHOOK_SECRET=whsec_xxx bash scripts/phase5_validate.sh
EOF
}

log() {
  printf "[phase5] %s\n" "$*"
}

warn() {
  printf "[phase5][warn] %s\n" "$*" >&2
}

die() {
  printf "[phase5][error] %s\n" "$*" >&2
  exit 1
}

require_cmd() {
  local cmd="$1"
  command -v "${cmd}" >/dev/null 2>&1 || die "Missing required command: ${cmd}"
}

run_cmd() {
  if [[ "${DRY_RUN}" == "true" ]]; then
    printf "[phase5][dry-run] "
    printf "%q " "$@"
    printf "\n"
  else
    "$@"
  fi
}

resolve_supabase_cli() {
  if command -v supabase >/dev/null 2>&1; then
    SUPABASE_CLI=(supabase)
    return
  fi

  if command -v npx >/dev/null 2>&1; then
    SUPABASE_CLI=(npx --yes supabase)
    return
  fi

  if [[ "${DRY_RUN}" == "true" ]]; then
    warn "Supabase CLI not found; dry-run will still print commands."
    SUPABASE_CLI=(supabase)
    return
  fi

  die "Missing required command: supabase (or npx fallback)"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-ref)
      PROJECT_REF="${2:-}"
      shift 2
      ;;
    --app-url)
      APP_URL="${2:-}"
      shift 2
      ;;
    --stripe-secret-key)
      STRIPE_SECRET_KEY="${2:-}"
      shift 2
      ;;
    --stripe-webhook-secret)
      STRIPE_WEBHOOK_SECRET="${2:-}"
      shift 2
      ;;
    --tenant-id)
      TENANT_ID="${2:-}"
      shift 2
      ;;
    --db-password)
      DB_PASSWORD="${2:-}"
      shift 2
      ;;
    --skip-db-push)
      SKIP_DB_PUSH=true
      shift
      ;;
    --skip-deploy)
      SKIP_DEPLOY=true
      shift
      ;;
    --skip-secrets)
      SKIP_SECRETS=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1 (use --help)"
      ;;
  esac
done

require_cmd git
resolve_supabase_cli

if [[ -z "${PROJECT_REF}" ]]; then
  die "PROJECT_REF is required (use --project-ref or env var)."
fi

if [[ "${SKIP_DB_PUSH}" == "false" && "${DRY_RUN}" == "false" && -z "${DB_PASSWORD}" ]]; then
  warn "DB_PASSWORD not set. supabase db push may prompt interactively."
fi

if [[ "${SKIP_SECRETS}" == "false" ]]; then
  [[ -n "${APP_URL}" ]] || die "APP_URL is required unless --skip-secrets is set."
  [[ -n "${STRIPE_SECRET_KEY}" ]] || die "STRIPE_SECRET_KEY is required unless --skip-secrets is set."
  [[ -n "${STRIPE_WEBHOOK_SECRET}" ]] || die "STRIPE_WEBHOOK_SECRET is required unless --skip-secrets is set."
fi

CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || true)"
if [[ "${CURRENT_BRANCH}" != "${EXPECTED_BRANCH}" ]]; then
  warn "Current branch is '${CURRENT_BRANCH}', expected '${EXPECTED_BRANCH}'. Continuing anyway."
else
  log "On expected branch '${EXPECTED_BRANCH}'."
fi

log "Repository root: ${REPO_ROOT}"
log "Project ref: ${PROJECT_REF}"
log "Dry run: ${DRY_RUN}"
log "Supabase CLI: ${SUPABASE_CLI[*]}"

if [[ "${SKIP_DB_PUSH}" == "false" ]]; then
  log "Linking project for db push..."
  if [[ -n "${DB_PASSWORD}" ]]; then
    run_cmd "${SUPABASE_CLI[@]}" link --project-ref "${PROJECT_REF}" --password "${DB_PASSWORD}"
  else
    run_cmd "${SUPABASE_CLI[@]}" link --project-ref "${PROJECT_REF}"
  fi

  log "Applying DB migrations (supabase db push)..."
  if [[ -n "${DB_PASSWORD}" ]]; then
    run_cmd "${SUPABASE_CLI[@]}" db push --linked --password "${DB_PASSWORD}"
  else
    run_cmd "${SUPABASE_CLI[@]}" db push --linked
  fi
else
  log "Skipping DB push (--skip-db-push)."
fi

if [[ "${SKIP_DEPLOY}" == "false" ]]; then
  log "Deploying stripe-webhook (no JWT verify)..."
  run_cmd "${SUPABASE_CLI[@]}" functions deploy stripe-webhook --project-ref "${PROJECT_REF}" --no-verify-jwt

  log "Deploying create-stripe-checkout-session (JWT verify enabled)..."
  run_cmd "${SUPABASE_CLI[@]}" functions deploy create-stripe-checkout-session --project-ref "${PROJECT_REF}"

  log "Deploying create-stripe-portal-session (JWT verify enabled)..."
  run_cmd "${SUPABASE_CLI[@]}" functions deploy create-stripe-portal-session --project-ref "${PROJECT_REF}"
else
  log "Skipping function deploy (--skip-deploy)."
fi

if [[ "${SKIP_SECRETS}" == "false" ]]; then
  log "Updating function secrets..."
  run_cmd "${SUPABASE_CLI[@]}" secrets set "STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}" "STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}" "APP_URL=${APP_URL}" --project-ref "${PROJECT_REF}"
else
  log "Skipping secret updates (--skip-secrets)."
fi

cat <<EOF

[phase5] Completed non-interactive deployment steps.

Manual validation steps (interactive):
1) Start Stripe forwarding:
   stripe login
   stripe listen --forward-to "https://${PROJECT_REF}.functions.supabase.co/stripe-webhook"

2) Run checkout/payment failure/recovery tests:
   See docs/PHASE5_STRIPE_CLI_VALIDATION_CHECKLIST.md

3) SQL spot check:
$(if [[ -n "${TENANT_ID}" ]]; then
    cat <<SQL
select tenant_id, stripe_customer_id, stripe_subscription_id, status, grace_until, last_payment_failed_at, updated_at
from public.tenant_subscriptions
where tenant_id = '${TENANT_ID}';
SQL
  else
    cat <<'SQL'
select tenant_id, stripe_customer_id, stripe_subscription_id, status, grace_until, last_payment_failed_at, updated_at
from public.tenant_subscriptions
where tenant_id = '<TENANT_ID>';
SQL
  fi)

4) After verification, keep ledger flow:
   - Update docs/LOCKED_DECISION_IMPLEMENTATION_LOG.md with verified evidence
   - Lock DL-2026-02-14-051 through DL-2026-02-14-062

EOF

