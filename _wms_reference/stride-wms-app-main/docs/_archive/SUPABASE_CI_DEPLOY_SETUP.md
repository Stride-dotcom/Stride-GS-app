# Supabase CI Deploy Setup

This repository includes a GitHub Actions workflow:

- `.github/workflows/supabase-deploy.yml`

It deploys on push to `main` and can also be run manually from Actions.
It also includes an hourly scheduled "catch-up" run that applies any pending
migrations (useful if a push-triggered run fails and no new commits are pushed).

## Required GitHub Actions secrets

Add these in:
`GitHub repo -> Settings -> Secrets and variables -> Actions`

1. `SUPABASE_ACCESS_TOKEN`
   - Create from Supabase dashboard account settings (personal access token).
2. `SUPABASE_PROJECT_REF`
   - Supabase project reference ID (e.g. `abcdefghijklmnopqrst`).
3. `SUPABASE_DB_PASSWORD`
   - Database password from project settings.

## What the workflow does

1. Links to your Supabase project.
2. Detects whether migrations need to run by comparing:
   - **Local migration versions** from `supabase/migrations/*.sql`
   - **Remote applied migration versions** fetched via the Supabase **Management API** (HTTPS)

   This is more reliable than a `git diff` check because it can “self-heal” if a previous deploy failed
   (i.e., it will still detect and apply pending migrations even if no new commit is pushed).
3. Creates **local stub files** (in the CI workspace only) for migrations that exist on the remote
   database but are missing from the repo, so `supabase db push` does not fail due to “remote versions
   not found locally”.
4. If there are pending migrations (or if a manual run explicitly requests it), runs:
   - `supabase db push` (with retries)
   - then prints migration status to the GitHub Actions job summary
5. Deploys changed functions from `supabase/functions/*` on push to `main` (or manually when requested).

## When it runs

- **push** to `main`: checks pending migrations and applies them if needed; deploys changed functions.
- **schedule** (hourly): checks pending migrations and applies them if needed (functions are skipped).
- **workflow_dispatch**: lets you force running migrations and/or function deploys.

## IPv6 note

GitHub-hosted runners can intermittently fail to connect to the Supabase database over IPv6
(`network is unreachable`). The workflow disables IPv6 on the runner to prefer IPv4 connectivity.

## Manual run options

When using **Run workflow**, you can choose:

- `run_db_push`: run migrations or skip
- `deploy_functions`: deploy functions or skip
- `deploy_mode`:
  - `changed` (default): deploy only functions changed in the pushed range
  - `all`: deploy all function directories

## Notes

- Some Supabase projects have migration history versions that are not present in the repo’s `supabase/migrations/`.
  The workflow creates stub files (in CI only) for already-applied remote migrations so `db push` can proceed.
