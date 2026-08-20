import { readFile } from 'node:fs/promises';

const OPENAI_API_KEY = requiredEnv('OPENAI_API_KEY');
const SUPABASE_URL = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY');
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.6-luna';
const MAX_ITEMS = Number(process.env.MAX_ITEMS ?? '10');

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
  url.searchParams.set('moderation_status', 'eq.pending');
  const response = await fetch(url, {
    method: 'PATCH',
    headers: supabaseHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`Supabase update failed: ${response.status} ${await response.text()}`);
}

const schema = {
  type: 'object',
  properties: {
    cleaned_title: { type: 'string', maxLength: 140 },
    cleaned_description: { type: 'string' },
    editor_note: { type: 'string' },
    risk_level: { type: 'integer', minimum: 0, maximum: 100 },
    risk_flags: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'allegation',
          'unverifiable_claim',
          'private_person',
          'personal_information',
          'minor',
          'medical_information',
          'political_opinion',
          'business_complaint',
          'profanity',
          'harassment',
          'threat',
          'graphic_content',
          'source_needed',
          'other',
        ],
      },
    },
  },
  required: ['cleaned_title', 'cleaned_description', 'editor_note', 'risk_level', 'risk_flags'],
  additionalProperties: false,
};

async function cleanSubmission(submission) {
  const userContent = [
    `SUBMISSION TYPE: ${submission.submission_type}`,
    `ORIGINAL TITLE: ${submission.title}`,
    `LOCATION/ADDRESS SUPPLIED: ${submission.address || '(none)'}`,
    `SOURCE LINK SUPPLIED: ${submission.source_url || '(none)'}`,
    '',
    'ORIGINAL SUBMISSION:',
    submission.description || '',
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
        { role: 'user', content: userContent.slice(0, 16000) },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'community_copy_desk',
          strict: true,
          schema,
        },
      },
      max_output_tokens: 1800,
    }),
  });

  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  const data = await response.json();
  const outputText = data.output
    ?.flatMap((item) => item.content ?? [])
    .find((part) => part.type === 'output_text')
    ?.text;
  if (!outputText) throw new Error('OpenAI response did not contain output_text');
  return JSON.parse(outputText);
}

async function main() {
  const submissions = await supabaseGet('community_submissions', {
    moderation_status: 'eq.pending',
    select: 'id,submission_type,title,description,address,source_url,created_at',
    order: 'created_at.asc',
    limit: String(MAX_ITEMS),
  });

  console.log(`Found ${submissions.length} pending community submissions.`);
  let processed = 0;
  let failed = 0;

  for (const submission of submissions) {
    try {
      const edited = await cleanSubmission(submission);
      await updateSubmission(submission.id, {
        ai_cleaned_title: edited.cleaned_title.trim(),
        ai_cleaned_description: edited.cleaned_description.trim(),
        ai_editor_notes: edited.editor_note.trim(),
        ai_risk_level: edited.risk_level,
        ai_risk_flags: edited.risk_flags,
        ai_model: OPENAI_MODEL,
        ai_processed_at: new Date().toISOString(),
        moderation_status: 'review',
      });
      processed += 1;
      console.log(`Prepared ${submission.id} for human review [risk=${edited.risk_level}]`);
    } catch (error) {
      failed += 1;
      console.error(`Failed ${submission.id}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(JSON.stringify({ processed, failed, pending: submissions.length }));
  if (failed > 0 && processed === 0) process.exitCode = 1;
}

await main();
