import { readFile } from 'node:fs/promises';

const SOURCE_NAME = 'Anne Arundel County Police';
const SOURCE_LIST_URL = 'https://www.aacounty.org/police-department/about-us/news';
const SOURCE_BASE_URL = 'https://www.aacounty.org';
const MAX_ITEMS = Number(process.env.MAX_ITEMS ?? '10');
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.6-luna';

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
  return value
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
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html;
  return htmlDecode(
    main
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim(),
  );
}

function extractTitle(html) {
  const title = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?? 'Untitled source item';
  return stripHtml(title).replace(/\s+/g, ' ').trim();
}

function extractStoryLinks(html) {
  const seen = new Set();
  const links = [];
  const regex = /href=["']([^"']*\/police-department\/about-us\/news\/[^"'#?]+)["']/gi;
  for (const match of html.matchAll(regex)) {
    const url = new URL(match[1], SOURCE_BASE_URL).toString();
    if (!seen.has(url)) {
      seen.add(url);
      links.push(url);
    }
  }
  return links.slice(0, MAX_ITEMS);
}

function sourceDateFromUrl(url) {
  const slug = new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '';
  const months = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
  };
  const match = slug.match(/(january|february|march|april|may|june|july|august|september|october|november|december)-(\d{1,2})-(\d{4})/i);
  if (!match) return null;
  const month = months[match[1].toLowerCase()];
  const day = match[2].padStart(2, '0');
  return `${match[3]}-${month}-${day}T12:00:00Z`;
}

function supabaseHeaders(extra = {}) {
  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    'Content-Type': 'application/json',
    ...extra,
  };
  // Legacy service_role keys are JWTs; modern sb_secret keys must not be used as Bearer JWTs.
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

async function supabaseInsert(table, row) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  if (table === 'stories') url.searchParams.set('on_conflict', 'source_url');
  const response = await fetch(url, {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error(`Supabase INSERT ${table} failed: ${response.status} ${await response.text()}`);
}

async function getSourceRecord() {
  const rows = await supabaseGet('sources', {
    name: `eq.${SOURCE_NAME}`,
    select: 'id,trust_score',
    limit: '1',
  });
  if (!rows[0]) throw new Error(`Source not found in Supabase: ${SOURCE_NAME}`);
  return rows[0];
}

async function storyExists(sourceUrl) {
  const rows = await supabaseGet('stories', {
    source_url: `eq.${sourceUrl}`,
    select: 'id',
    limit: '1',
  });
  return rows.length > 0;
}

const storySchema = {
  type: 'object',
  properties: {
    ai_headline: { type: 'string' },
    ai_summary: { type: 'string' },
    category: {
      type: 'string',
      enum: ['crime', 'public_safety', 'traffic', 'government', 'schools', 'events', 'weather', 'business', 'real_estate', 'boating', 'community', 'other'],
    },
    pasadena_relevance: { type: 'integer', minimum: 0, maximum: 100 },
    urgency: { type: 'integer', minimum: 0, maximum: 100 },
    location_text: { type: 'string' },
    relevance_reason: { type: 'string' },
    should_review: { type: 'boolean' },
  },
  required: ['ai_headline', 'ai_summary', 'category', 'pasadena_relevance', 'urgency', 'location_text', 'relevance_reason', 'should_review'],
  additionalProperties: false,
};

async function triageStory({ title, text, url }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: 'system', content: triagePrompt },
        {
          role: 'user',
          content: `SOURCE: ${SOURCE_NAME}\nURL: ${url}\nTITLE: ${title}\n\nSOURCE TEXT:\n${text.slice(0, 14000)}`,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'pasadena_story_triage',
          strict: true,
          schema: storySchema,
        },
      },
      max_output_tokens: 800,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const outputText = data.output
    ?.flatMap((item) => item.content ?? [])
    .find((part) => part.type === 'output_text')
    ?.text;

  if (!outputText) throw new Error('OpenAI response did not contain output_text');
  return JSON.parse(outputText);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'PasadenaCommunityBrief/0.1 (+https://github.com/cyberupcowboy/Pasadena-Newsletter)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) throw new Error(`Fetch failed for ${url}: ${response.status}`);
  return response.text();
}

async function main() {
  const source = await getSourceRecord();
  const listHtml = await fetchText(SOURCE_LIST_URL);
  const links = extractStoryLinks(listHtml);

  console.log(`Found ${links.length} candidate police-news items.`);

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const url of links) {
    try {
      if (await storyExists(url)) {
        skipped += 1;
        continue;
      }

      const html = await fetchText(url);
      const title = extractTitle(html);
      const text = stripHtml(html);
      if (text.length < 100) throw new Error('Extracted source text is unexpectedly short');

      const triage = await triageStory({ title, text, url });

      await supabaseInsert('stories', {
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
        published_at: sourceDateFromUrl(url),
        editorial_status: triage.should_review ? 'review' : 'new',
        ai_model: OPENAI_MODEL,
        ai_processed_at: new Date().toISOString(),
        relevance_reason: triage.relevance_reason,
      });

      inserted += 1;
      console.log(`Inserted: ${title} [relevance=${triage.pasadena_relevance}, urgency=${triage.urgency}]`);
    } catch (error) {
      failed += 1;
      console.error(`Failed ${url}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(JSON.stringify({ inserted, skipped, failed, candidates: links.length }));
  if (failed > 0 && inserted === 0 && skipped === 0) process.exitCode = 1;
}

await main();
