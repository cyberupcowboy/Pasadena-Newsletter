# Pasadena Community Brief Architecture

## Goal
Create a hyperlocal community intelligence and newsletter platform centered on Pasadena, Maryland, with supporting coverage for Anne Arundel County, Maryland, and major national headlines.

## Editorial pipeline

1. Collect source item.
2. Normalize and deduplicate.
3. Score Pasadena relevance, source trust, and urgency.
4. Classify category and location.
5. Generate an AI headline and concise summary.
6. Place item into editorial review.
7. Human approves or rejects.
8. Approved items can be published to newsletter, website, and prepared for Facebook distribution.

## Initial content areas

- Pasadena local news
- Anne Arundel County news
- Maryland headlines
- Major national headlines
- Community events
- Yard sales
- Community notices
- Real estate highlights
- Local businesses
- Waterfront, boating, fishing, parks, and DNR information

## Current backend

Supabase project: `Pasadena Community Brief`

The repository stores schema, configuration, prompts, workflows, and application code. Secrets, API keys, service-role credentials, and live production data must never be committed.

## Security baseline

- Row Level Security enabled for every public table.
- Public `anon` and `authenticated` table access currently revoked.
- No public write paths until submission and admin workflows are deliberately designed.
- AI-generated content requires human editorial approval in the initial release.

## Planned application components

- Source collectors / n8n workflows
- OpenAI relevance and summarization pipeline
- Supabase persistence
- Editorial approval console
- Community submission form
- Newsletter generator
- Facebook post generator
- Searchable public website
- Advertiser and lead-generation features after audience trust is established
