import { readFile } from 'node:fs/promises';

const OPENAI_API_KEY = requiredEnv('OPENAI_API_KEY');
const SUPABASE_URL = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY');
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.6-luna';
const MAX_ITEMS = Number(process.env.MAX_ITEMS ?? '30');
const moderationPrompt = await readFile(new URL('../prompts/comment-moderation.md', import.meta.url), 'utf8');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function headers(extra = {}) {
  const result = { apikey: SUPABASE_SECRET_KEY, 'Content-Type': 'application/json', ...extra };
  if (!SUPABASE_SECRET_KEY.startsWith('sb_secret_')) result.Authorization = `Bearer ${SUPABASE_SECRET_KEY}`;
  return result;
}

async function getPending() {
  const url = new URL(`${SUPABASE_URL}/rest/v1/community_comments`);
  url.searchParams.set('moderation_status', 'eq.pending');
  url.searchParams.set('select', 'id,story_id,community_submission_id,display_name,body,created_at');
  url.searchParams.set('order', 'created_at.asc');
  url.searchParams.set('limit', String(MAX_ITEMS));
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) throw new Error(`Supabase comment load failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function patchComment(id, patch) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/community_comments`);
  url.searchParams.set('id', `eq.${id}`);
  const response = await fetch(url, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error(`Supabase comment update failed: ${response.status} ${await response.text()}`);
}

const flags = ['threat','incitement','doxxing','targeted_harassment','discriminatory_slur','serious_allegation','private_person','profanity','graphic_content','spam','political_opinion','none'];
const schema = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['approve','review','reject'] },
    risk_score: { type: 'integer', minimum: 0, maximum: 100 },
    flags: { type: 'array', items: { type: 'string', enum: flags } },
    reason: { type: 'string', maxLength: 600 },
  },
  required: ['action','risk_score','flags','reason'],
  additionalProperties: false,
};

async function moderate(comment) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: 'system', content: moderationPrompt },
        { role: 'user', content: `DISPLAY NAME: ${comment.display_name}\nCOMMENT:\n${String(comment.body || '').slice(0, 6000)}\n\nReturn only the structured moderation assessment.` },
      ],
      text: { format: { type: 'json_schema', name: 'comment_moderation', strict: true, schema } },
      max_output_tokens: 800,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI moderation request failed: ${response.status} ${await response.text()}`);
  const data = await response.json();
  const outputText = data.output?.flatMap((item) => item.content ?? []).find((part) => part.type === 'output_text')?.text;
  if (!outputText) throw new Error('OpenAI moderation response did not contain output_text');
  return JSON.parse(outputText);
}

async function main() {
  const comments = await getPending();
  console.log(`Found ${comments.length} pending comments.`);
  let processed = 0;
  let failed = 0;

  for (const comment of comments) {
    try {
      const assessment = await moderate(comment);
      const moderationStatus = assessment.action === 'approve' ? 'approved' : assessment.action === 'reject' ? 'rejected' : 'review';
      await patchComment(comment.id, {
        moderation_status: moderationStatus,
        ai_risk_score: assessment.risk_score,
        ai_risk_flags: assessment.flags,
        ai_moderation_reason: assessment.reason.trim(),
        ai_processed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      processed += 1;
      console.log(`Moderated ${comment.id}: ${moderationStatus} risk=${assessment.risk_score}`);
    } catch (error) {
      failed += 1;
      console.error(`Failed ${comment.id}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(JSON.stringify({ eligible: comments.length, processed, failed }));
  if (failed > 0 && processed === 0) process.exitCode = 1;
}

await main();
