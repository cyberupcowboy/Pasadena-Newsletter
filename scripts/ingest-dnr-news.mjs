import { readFile } from 'node:fs/promises';

const SOURCE_NAME = 'Maryland Department of Natural Resources';
const SOURCE_BASE_URL = 'https://news.maryland.gov';
const CATEGORY_URLS = [
  'https://news.maryland.gov/dnr/category/boating/',
  'https://news.maryland.gov/dnr/category/the-bay/',
  'https://news.maryland.gov/dnr/tag/weekly-fishing-report/',
];
const MAX_ITEMS = Number(process.env.MAX_ITEMS ?? '20');
const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS ?? '21');
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.6-luna';
const MIN_RELEVANCE_TO_STORE = Number(process.env.MIN_RELEVANCE_TO_STORE ?? '45');

const OPENAI_API_KEY = requiredEnv('OPENAI_API_KEY');
const SUPABASE_URL = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY');
const triagePrompt = await readFile(new URL('../prompts/story-triage.md', import.meta.url), 'utf8');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function htmlDecode(value) {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripHtml(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    ?? html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    ?? html;
  return htmlDecode(main
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim());
}

function extractTitle(html) {
  const raw = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?? 'Untitled DNR item';
  return stripHtml(raw).replace(/\s+/g, ' ').trim();
}

function extractLinks(html) {
  const seen = new Set();
  const links = [];
  const regex = /href=["'](https?:\/\/news\.maryland\.gov\/dnr\/\d{4}\/\d{2}\/\d{2}\/[^"'#?]+\/?)["']/gi;
  for (const match of html.matchAll(regex)) {
    const url = new URL(match[1], SOURCE_BASE_URL).toString();
    if (!seen.has(url)) {
      seen.add(url);
      links.push(url);
    }
  }
  return links;
}

function publishedAtFromUrl(url) {
  const match = new URL(url).pathname.match(/\/dnr\/(\d{4})\/(\d{2})\/(\d{2})\//);
  return match ? `${match[1]}-${match[2]}-${match[3]}T12:00:00Z` : null;
}

function isFreshUrl(url) {
  const publishedAt = publishedAtFromUrl(url);
  if (!publishedAt) return false;
  return Date.now() - new Date(publishedAt).getTime() <= MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
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

async function supabaseInsertStory(row) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/stories`);
  url.searchParams.set('on_conflict', 'source_url');
  const response = await fetch(url, {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error(`Supabase INSERT stories failed: ${response.status} ${await response.text()}`);
}

async function getSourceRecord() {
  const rows = await supabaseGet('sources', { name: `eq.${SOURCE_NAME}`, select: 'id,trust_score', limit: '1' });
  if (!rows[0]) throw new Error(`Source not found in Supabase: ${SOURCE_NAME}`);
  return rows[0];
}

async function storyExists(sourceUrl) {
  const rows = await supabaseGet('stories', { source_url: `eq.${sourceUrl}`, select: 'id', limit: '1' });
  return rows.length > 0;
}

const storySchema = {
  type: 'object',
  properties: {
    ai_headline: { type: 'string' },
    ai_summary: { type: 'string' },
    category: { type: 'string', enum: ['crime','public_safety','traffic','government','schools','events','weather','business','real_estate','boating','community','other'] },
    pasadena_relevance: { type: 'integer', minimum: 0, maximum: 100 },
    urgency: { type: 'integer', minimum: 0, maximum: 100 },
    location_text: { type: 'string' },
    relevance_reason: { type: 'string' },
    should_review: { type: 'boolean' },
  },
  required: ['ai_headline','ai_summary','category','pasadena_relevance','urgency','location_text','relevance_reason','should_review'],
  additionalProperties: false,
};

async function triageStory({ title, text, url }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: 'system',
          content: `${triagePrompt}\n\nFor DNR material, emphasize current Pasadena/Magothy/Bodkin/Chesapeake boating, fishing, water-quality, access, navigation, and safety value. Do not elevate routine statewide archival material merely because Pasadena residents may boat.`,
        },
        { role: 'user', content: `SOURCE: ${SOURCE_NAME}\nURL: ${url}\nTITLE: ${title}\n\nSOURCE TEXT:\n${text.slice(0, 14000)}` },
      ],
      text: { format: { type: 'json_schema', name: 'pasadena_story_triage', strict: true, schema: storySchema } },
      max_output_tokens: 800,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  const data = await response.json();
  const outputText = data.output?.flatMap((item) => item.content ?? []).find((part) => part.type === 'output_text')?.text;
  if (!outputText) throw new Error('OpenAI response did not contain output_text');
  return JSON.parse(outputText);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'PasadenaCurrent/0.3 (+https://github.com/cyberupcowboy/Pasadena-Newsletter)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) throw new Error(`Fetch failed for ${url}: ${response.status}`);
  return response.text();
}

async function main() {
  const source = await getSourceRecord();
  const allLinks = [];
  const seen = new Set();
  for (const categoryUrl of CATEGORY_URLS) {
    const html = await fetchText(categoryUrl);
    for (const link of extractLinks(html)) {
      if (!seen.has(link) && isFreshUrl(link)) {
        seen.add(link);
        allLinks.push(link);
      }
    }
  }

  const links = allLinks.slice(0, MAX_ITEMS);
  console.log(`Found ${links.length} fresh candidate DNR items within ${MAX_AGE_DAYS} days.`);

  let inserted = 0, skipped = 0, filtered = 0, failed = 0;
  for (const url of links) {
    try {
      if (await storyExists(url)) { skipped += 1; continue; }
      const html = await fetchText(url);
      const title = extractTitle(html);
      const text = stripHtml(html);
      if (text.length < 100) throw new Error('Extracted source text is unexpectedly short');
      const triage = await triageStory({ title, text, url });
      if (triage.pasadena_relevance < MIN_RELEVANCE_TO_STORE && triage.urgency < 80) {
        filtered += 1;
        continue;
      }
      await supabaseInsertStory({
        source_id: source.id,
        external_id: new URL(url).pathname.split('/').filter(Boolean).at(-1),
        source_url: url,
        source_title: title,
        original_text: text.slice(0, 20000),
        ai_headline: triage.ai_headline,
        ai_summary: triage.ai_summary,
        category: triage.category,
        pasadena_relevance: triage.pasadena_relevance,
        trust_score: source.trust_score,
        urgency: triage.urgency,
        location_text: triage.location_text || null,
        published_at: publishedAtFromUrl(url),
        editorial_status: triage.should_review ? 'review' : 'new',
        ai_model: OPENAI_MODEL,
        ai_processed_at: new Date().toISOString(),
        relevance_reason: triage.relevance_reason,
      });
      inserted += 1;
      console.log(`Inserted DNR: ${title} [relevance=${triage.pasadena_relevance}, urgency=${triage.urgency}]`);
    } catch (error) {
      failed += 1;
      console.error(`Failed ${url}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(JSON.stringify({ inserted, skipped, filtered, failed, candidates: links.length, max_age_days: MAX_AGE_DAYS }));
  if (failed > 0 && inserted === 0 && skipped === 0 && filtered === 0) process.exitCode = 1;
}

await main();
