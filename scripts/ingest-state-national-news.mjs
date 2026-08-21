import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const OPENAI_API_KEY = requiredEnv('OPENAI_API_KEY');
const SUPABASE_URL = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY');
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.6-luna';
const STATE_ITEMS = Number(process.env.STATE_ITEMS ?? '5');
const NATIONAL_ITEMS = Number(process.env.NATIONAL_ITEMS ?? '6');
const DESK_SCOPE = String(process.env.DESK_SCOPE ?? 'both').toLowerCase();
const prompt = await readFile(new URL('../prompts/state-national-news.md', import.meta.url), 'utf8');

const SOURCE_CONFIGS = [
  { name: 'Maryland Matters', hosts: ['marylandmatters.org'], scopes: ['state'] },
  { name: 'WBAL-TV 11', hosts: ['wbaltv.com'], scopes: ['state'] },
  { name: 'FOX45 Baltimore', hosts: ['foxbaltimore.com'], scopes: ['state'] },
  { name: 'WTOP News', hosts: ['wtop.com'], scopes: ['state'] },
  { name: 'Associated Press', hosts: ['apnews.com'], scopes: ['national'] },
  { name: 'Reuters', hosts: ['reuters.com'], scopes: ['national'] },
  { name: 'NPR', hosts: ['npr.org'], scopes: ['national'] },
  { name: 'Fox News', hosts: ['foxnews.com'], scopes: ['national'] },
  { name: 'CNN', hosts: ['cnn.com'], scopes: ['national'] },
  { name: 'The Hill', hosts: ['thehill.com'], scopes: ['national'] },
];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function supabaseHeaders(extra = {}) {
  const headers = { apikey: SUPABASE_SECRET_KEY, 'Content-Type': 'application/json', ...extra };
  if (!SUPABASE_SECRET_KEY.startsWith('sb_secret_')) headers.Authorization = `Bearer ${SUPABASE_SECRET_KEY}`;
  return headers;
}

async function supabaseGet(table, params) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: supabaseHeaders() });
  if (!response.ok) throw new Error(`Supabase GET ${table} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function insertStory(row) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/stories`);
  url.searchParams.set('on_conflict', 'source_url');
  const response = await fetch(url, {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error(`Supabase INSERT stories failed: ${response.status} ${await response.text()}`);
}

function canonicalHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString();
  } catch {
    return '';
  }
}

function sourceConfigForUrl(url, scope) {
  const host = canonicalHost(url);
  return SOURCE_CONFIGS.find((source) => source.scopes.includes(scope) && source.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) ?? null;
}

async function sourceRecord(name) {
  const rows = await supabaseGet('sources', { name: `eq.${name}`, select: 'id,trust_score', limit: '1' });
  return rows[0] ?? null;
}

function collectWebSources(responseData) {
  const found = new Map();
  function visit(node) {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.url === 'string' && /^https?:\/\//i.test(node.url)) {
      const normalized = normalizeUrl(node.url);
      if (normalized && !found.has(normalized)) found.set(normalized, node.url);
    }
    Object.values(node).forEach(visit);
  }
  for (const item of responseData.output ?? []) if (item?.type === 'web_search_call') visit(item);
  return found;
}

function sourceWasSearched(url, searchedSources) {
  const normalized = normalizeUrl(url);
  if (!normalized) return false;
  if (searchedSources.has(normalized)) return true;
  const wanted = new URL(normalized);
  for (const candidate of searchedSources.keys()) {
    const parsed = new URL(candidate);
    if (parsed.hostname === wanted.hostname && (parsed.pathname === wanted.pathname || parsed.pathname.startsWith(`${wanted.pathname}/`) || wanted.pathname.startsWith(`${parsed.pathname}/`))) return true;
  }
  return false;
}

const itemSchema = {
  type: 'object',
  properties: {
    source_url: { type: 'string' },
    source_title: { type: 'string' },
    ai_headline: { type: 'string' },
    ai_summary: { type: 'string' },
    category: { type: 'string', enum: ['politics','government','economy','courts','public_safety','business','environment','technology','world','other'] },
    published_at: { type: 'string' },
    location_text: { type: 'string' },
    urgency: { type: 'integer', minimum: 0, maximum: 100 },
    political_content: { type: 'boolean' },
    political_slant: { type: 'string', enum: ['left','center','right','mixed','unclear','not_political'] },
    political_slant_confidence: { type: 'integer', minimum: 0, maximum: 100 },
    political_slant_reason: { type: 'string' },
  },
  required: ['source_url','source_title','ai_headline','ai_summary','category','published_at','location_text','urgency','political_content','political_slant','political_slant_confidence','political_slant_reason'],
  additionalProperties: false,
};

const schema = {
  type: 'object',
  properties: {
    items: { type: 'array', items: itemSchema, maxItems: 8 },
  },
  required: ['items'],
  additionalProperties: false,
};

async function recentCoverage(scope) {
  const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  return supabaseGet('stories', {
    content_scope: `eq.${scope}`,
    ingested_at: `gte.${cutoff}`,
    select: 'source_url,ai_headline,source_title',
    order: 'ingested_at.desc',
    limit: '40',
  });
}

function deskRequest(scope, maxItems, recent) {
  const allowed = SOURCE_CONFIGS.filter((source) => source.scopes.includes(scope));
  const scopeText = scope === 'state'
    ? 'MARYLAND STATE DESK: statewide Maryland government, courts, elections, economy, major policy, infrastructure and public-interest developments.'
    : 'U.S. NATIONAL DESK: major United States government, elections, economy, courts, foreign policy, national public-safety and public-interest developments.';
  const recentText = recent.length
    ? recent.map((item) => `- ${item.ai_headline || item.source_title || '(untitled)'} | ${item.source_url}`).join('\n')
    : '- None yet.';

  return [
    scopeText,
    `CURRENT UTC TIME: ${new Date().toISOString()}`,
    `RETURN AT MOST ${maxItems} DISTINCT STORIES.`,
    'ALLOWED PUBLISHERS / DOMAINS:',
    ...allowed.map((source) => `- ${source.name}: ${source.hosts.join(', ')}`),
    '',
    'RECENTLY COVERED BY THE CURRENT — avoid repeating these developments unless there is a material new development:',
    recentText,
    '',
    'Search the web. Return only actual article URLs you used in web search. Analyze political framing at the STORY level, not from publisher reputation. Return structured JSON only.',
  ].join('\n');
}

async function discoverDesk(scope, maxItems) {
  const recent = await recentCoverage(scope);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: 'system', content: prompt },
        { role: 'user', content: deskRequest(scope, maxItems, recent) },
      ],
      tools: [{ type: 'web_search', search_context_size: 'high' }],
      tool_choice: 'auto',
      include: ['web_search_call.action.sources'],
      text: { format: { type: 'json_schema', name: `${scope}_news_desk`, strict: true, schema } },
      max_output_tokens: 5200,
    }),
  });

  if (!response.ok) throw new Error(`OpenAI ${scope} desk request failed: ${response.status} ${await response.text()}`);
  const data = await response.json();
  const outputText = data.output?.flatMap((item) => item.content ?? []).find((part) => part.type === 'output_text')?.text;
  if (!outputText) throw new Error(`OpenAI ${scope} desk response did not contain output_text`);
  const parsed = JSON.parse(outputText);
  return { items: parsed.items ?? [], searchedSources: collectWebSources(data) };
}

function isoOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const futureTolerance = Date.now() + 6 * 60 * 60 * 1000;
  if (parsed.getTime() > futureTolerance) return null;
  return parsed.toISOString();
}

async function ingestDesk(scope, maxItems) {
  const { items, searchedSources } = await discoverDesk(scope, maxItems);
  let inserted = 0;
  let skipped = 0;
  let rejected = 0;

  for (const item of items.slice(0, maxItems)) {
    try {
      const config = sourceConfigForUrl(item.source_url, scope);
      if (!config || !sourceWasSearched(item.source_url, searchedSources)) {
        rejected += 1;
        console.warn(`Rejected unverified or disallowed ${scope} URL: ${item.source_url}`);
        continue;
      }

      const sourceUrl = normalizeUrl(item.source_url);
      if (!sourceUrl) { rejected += 1; continue; }
      const existing = await supabaseGet('stories', { source_url: `eq.${sourceUrl}`, select: 'id', limit: '1' });
      if (existing.length) { skipped += 1; continue; }

      const source = await sourceRecord(config.name);
      if (!source) throw new Error(`Source record missing: ${config.name}`);

      const politicalContent = Boolean(item.political_content);
      const slant = politicalContent ? item.political_slant : 'not_political';
      const publishedAt = isoOrNull(item.published_at);

      await insertStory({
        source_id: source.id,
        external_id: createHash('sha256').update(sourceUrl).digest('hex').slice(0, 32),
        source_url: sourceUrl,
        source_title: String(item.source_title || '').slice(0, 500),
        original_text: null,
        ai_headline: String(item.ai_headline || item.source_title || 'Untitled story').slice(0, 180),
        ai_summary: String(item.ai_summary || '').slice(0, 3000),
        category: item.category,
        pasadena_relevance: scope === 'state' ? 25 : 8,
        trust_score: source.trust_score,
        urgency: item.urgency,
        location_text: item.location_text || (scope === 'state' ? 'Maryland' : 'United States'),
        published_at: publishedAt,
        editorial_status: 'review',
        ai_model: OPENAI_MODEL,
        ai_processed_at: new Date().toISOString(),
        relevance_reason: scope === 'state' ? 'Selected for the Maryland state desk.' : 'Selected for the U.S. national desk.',
        content_scope: scope,
        political_content: politicalContent,
        political_slant: slant,
        political_slant_confidence: item.political_slant_confidence,
        political_slant_reason: item.political_slant_reason,
      });
      inserted += 1;
      console.log(`Inserted ${scope}: ${item.ai_headline} [framing=${slant}, confidence=${item.political_slant_confidence}]`);
    } catch (error) {
      rejected += 1;
      console.error(`Failed ${scope} item ${item.source_url}:`, error instanceof Error ? error.message : error);
    }
  }

  const result = { scope, candidates: items.length, inserted, skipped, rejected };
  console.log(JSON.stringify(result));
  if (inserted + skipped === 0) process.exitCode = 1;
  return result;
}

async function main() {
  if (!['state', 'national', 'both'].includes(DESK_SCOPE)) throw new Error(`Invalid DESK_SCOPE: ${DESK_SCOPE}`);
  const results = [];
  if (DESK_SCOPE === 'state' || DESK_SCOPE === 'both') results.push(await ingestDesk('state', STATE_ITEMS));
  if (DESK_SCOPE === 'national' || DESK_SCOPE === 'both') results.push(await ingestDesk('national', NATIONAL_ITEMS));
  console.log(JSON.stringify({ desks: results }));
}

await main();
