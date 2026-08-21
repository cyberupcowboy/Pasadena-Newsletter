import { readFile } from 'node:fs/promises';

const OPENAI_API_KEY = requiredEnv('OPENAI_API_KEY');
const SUPABASE_URL = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY');
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.6-luna';
const MAX_ITEMS = Number(process.env.MAX_ITEMS ?? '10');
const AI_REVIEW_VERSION = 2;

const copyDeskPrompt = await readFile(new URL('../prompts/community-copy-desk.md', import.meta.url), 'utf8');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function supabaseHeaders(extra = {}) {
  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    'Content-Type': 'application/json',
    ...extra,
  };
  if (!SUPABASE_SECRET_KEY.startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${SUPABASE_SECRET_KEY}`;
  }
  return headers;
}

async function supabaseGet(table, params) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: supabaseHeaders() });
  if (!response.ok) throw new Error(`Supabase GET ${table} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function updateSubmission(id, patch) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/community_submissions`);
  url.searchParams.set('id', `eq.${id}`);
  const response = await fetch(url, {
    method: 'PATCH',
    headers: supabaseHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`Supabase update failed: ${response.status} ${await response.text()}`);
}

const verdicts = [
  'supported_by_sources',
  'contradicted_by_sources',
  'disputed',
  'unverified',
  'opinion_or_personal_account',
  'not_checked',
];

const riskFlags = [
  'allegation',
  'unverifiable_claim',
  'disputed_claim',
  'private_person',
  'personal_information',
  'minor',
  'medical_information',
  'political_opinion',
  'business_complaint',
  'profanity',
  'harassment',
  'threat',
  'discriminatory_language',
  'graphic_content',
  'source_needed',
  'privacy_risk',
  'defamation_risk',
  'incitement_risk',
  'other',
];

const schema = {
  type: 'object',
  properties: {
    cleaned_title: { type: 'string', maxLength: 140 },
    cleaned_description: { type: 'string' },
    editor_note: { type: 'string' },
    risk_level: { type: 'integer', minimum: 0, maximum: 100 },
    risk_flags: {
      type: 'array',
      items: { type: 'string', enum: riskFlags },
    },
    fact_check_summary: { type: 'string' },
    fact_checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          verdict: { type: 'string', enum: verdicts },
          explanation: { type: 'string' },
          needs_editor_verification: { type: 'boolean' },
        },
        required: ['claim', 'verdict', 'explanation', 'needs_editor_verification'],
        additionalProperties: false,
      },
    },
    civility_assessment: { type: 'string' },
    harm_assessment: { type: 'string' },
    editorial_recommendation: {
      type: 'string',
      enum: ['publishable', 'publishable_with_edits', 'hold_for_verification', 'do_not_publish'],
    },
  },
  required: [
    'cleaned_title',
    'cleaned_description',
    'editor_note',
    'risk_level',
    'risk_flags',
    'fact_check_summary',
    'fact_checks',
    'civility_assessment',
    'harm_assessment',
    'editorial_recommendation',
  ],
  additionalProperties: false,
};

function collectWebSources(responseData) {
  const found = new Map();

  function visit(node) {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;

    if (typeof node.url === 'string' && /^https?:\/\//i.test(node.url)) {
      const url = node.url.trim();
      if (!found.has(url)) {
        found.set(url, {
          url,
          title: typeof node.title === 'string' && node.title.trim() ? node.title.trim() : null,
        });
      }
    }

    Object.values(node).forEach(visit);
  }

  for (const item of responseData.output ?? []) {
    if (item?.type === 'web_search_call') visit(item);
  }

  return [...found.values()].slice(0, 16);
}

async function reviewSubmission(submission) {
  const userContent = [
    `SUBMISSION TYPE: ${submission.submission_type}`,
    `ORIGINAL TITLE: ${submission.title}`,
    `LOCATION/ADDRESS SUPPLIED: ${submission.address || '(none)'}`,
    `SOURCE LINK SUPPLIED: ${submission.source_url || '(none)'}`,
    '',
    'ORIGINAL SUBMISSION:',
    submission.description || '',
    '',
    'Return the requested editorial review as structured JSON. Use web search when material factual claims are publicly checkable. Preserve political or civic viewpoints while separating opinion from factual claims.',
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: 'system', content: copyDeskPrompt },
        { role: 'user', content: userContent.slice(0, 18000) },
      ],
      tools: [
        { type: 'web_search', search_context_size: 'medium' },
      ],
      tool_choice: 'auto',
      include: ['web_search_call.action.sources'],
      text: {
        format: {
          type: 'json_schema',
          name: 'community_editorial_review',
          strict: true,
          schema,
        },
      },
      max_output_tokens: 3200,
    }),
  });

  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  const data = await response.json();
  const outputText = data.output
    ?.flatMap((item) => item.content ?? [])
    .find((part) => part.type === 'output_text')
    ?.text;
  if (!outputText) throw new Error('OpenAI response did not contain output_text');

  return {
    review: JSON.parse(outputText),
    sources: collectWebSources(data),
  };
}

function uniqueById(items) {
  const map = new Map();
  for (const item of items) if (item?.id && !map.has(item.id)) map.set(item.id, item);
  return [...map.values()];
}

async function loadEligibleSubmissions() {
  const fields = 'id,submission_type,title,description,address,source_url,created_at,moderation_status,ai_processed_at,ai_reprocess_requested_at,ai_review_version';

  const pending = await supabaseGet('community_submissions', {
    moderation_status: 'eq.pending',
    select: fields,
    order: 'created_at.asc',
    limit: String(MAX_ITEMS),
  });

  const requested = await supabaseGet('community_submissions', {
    moderation_status: 'eq.review',
    ai_reprocess_requested_at: 'not.is.null',
    select: fields,
    order: 'ai_reprocess_requested_at.asc',
    limit: String(MAX_ITEMS),
  });

  // Repair legacy items that were approved before the AI review gate existed.
  const legacyApproved = await supabaseGet('community_submissions', {
    moderation_status: 'in.(approved,published)',
    ai_processed_at: 'is.null',
    select: fields,
    order: 'created_at.asc',
    limit: String(MAX_ITEMS),
  });

  return uniqueById([...pending, ...requested, ...legacyApproved]).slice(0, MAX_ITEMS);
}

async function main() {
  const submissions = await loadEligibleSubmissions();
  console.log(`Found ${submissions.length} community submissions needing AI editorial review.`);

  let processed = 0;
  let failed = 0;

  for (const submission of submissions) {
    try {
      const { review, sources } = await reviewSubmission(submission);
      await updateSubmission(submission.id, {
        ai_cleaned_title: review.cleaned_title.trim(),
        ai_cleaned_description: review.cleaned_description.trim(),
        ai_editor_notes: review.editor_note.trim(),
        ai_risk_level: review.risk_level,
        ai_risk_flags: review.risk_flags,
        ai_fact_check_summary: review.fact_check_summary.trim(),
        ai_fact_checks: review.fact_checks,
        ai_fact_check_sources: sources,
        ai_civility_assessment: review.civility_assessment.trim(),
        ai_harm_assessment: review.harm_assessment.trim(),
        ai_editorial_recommendation: review.editorial_recommendation,
        ai_model: OPENAI_MODEL,
        ai_processed_at: new Date().toISOString(),
        ai_reprocess_requested_at: null,
        ai_review_version: AI_REVIEW_VERSION,
        moderation_status: 'review',
      });
      processed += 1;
      console.log(`Prepared ${submission.id} for human review [recommendation=${review.editorial_recommendation}, risk=${review.risk_level}, sources=${sources.length}]`);
    } catch (error) {
      failed += 1;
      console.error(`Failed ${submission.id}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(JSON.stringify({ processed, failed, eligible: submissions.length, review_version: AI_REVIEW_VERSION }));
  if (failed > 0 && processed === 0) process.exitCode = 1;
}

await main();
