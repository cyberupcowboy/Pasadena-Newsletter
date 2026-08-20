# Phase 2 — AACO Police News Ingestion

## What this workflow does

The first automated source is the Anne Arundel County Police News page:

`https://www.aacounty.org/police-department/about-us/news`

The worker:

1. Fetches the current police news listing.
2. Finds the newest individual police-news pages.
3. Checks Supabase for an existing `source_url` and skips duplicates.
4. Extracts the source page text.
5. Sends the item to the OpenAI Responses API using Structured Outputs.
6. Receives a neutral headline, summary, category, Pasadena relevance score, urgency score, location, relevance rationale, and review decision.
7. Writes the item to `public.stories` in Supabase.
8. Leaves publish decisions to a human editorial review step.

The scheduled GitHub Actions workflow runs every two hours at minute 17 and can also be run manually after it is enabled on the default branch.

## Required GitHub Actions secrets

In the repository, open **Settings → Secrets and variables → Actions → New repository secret** and add these two values.

### `OPENAI_API_KEY`

Use the OpenAI project API key created for Pasadena Community Brief. Never commit this value to the repository.

### `SUPABASE_SECRET_KEY`

In the Pasadena Community Brief Supabase project, create or copy a **Secret key** from **Settings → API Keys** and store it as this GitHub Actions secret.

Prefer a modern `sb_secret_...` key rather than the legacy `service_role` JWT. This key is backend-only and bypasses Row Level Security, so never expose it in frontend code, logs, issues, chat, or committed files.

The Supabase project URL is non-secret runtime configuration and is already set in the workflow:

`https://eedpedkvymohcubdaoey.supabase.co`

## Model

V1 uses `gpt-5.6-luna` for high-volume triage and summarization. The model name is set in the GitHub Actions workflow and can be changed without changing the application contract.

## Editorial behavior

The AI does not publish content. It assigns items to:

- `review` when the item is sufficiently local or urgent.
- `new` when it is collected but does not meet the initial review threshold.

A human approval layer remains required before Facebook, newsletter, or website publication.

## Security notes

- GitHub Actions receives secrets only through the repository secret store.
- The script never prints secret values.
- Modern Supabase secret keys are sent in the `apikey` header, not as JWT bearer tokens.
- RLS remains enabled on all public tables.
- No anonymous database write policy is introduced for this ingestion path.
