import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.6-luna';
const OPENAI_API_KEY = requiredEnv('OPENAI_API_KEY');
const SUPABASE_URL = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY');
const triagePrompt = await readFile(new URL('../prompts/story-triage.md', import.meta.url), 'utf8');

const LOCAL_TERMS = /(pasadena|21122|magothy|mountain\s+road|lake\s+shore|riviera\s+beach|bodkin|fort\s+smallwood|chesapeake\s+(?:high|bay)|northeast\s+high|jacobsville|hog\s+neck|duvall\s+highway)/i;

const SOURCE_CONFIGS = [
  {
    name: 'Anne Arundel County Health Department',
    listUrls: [
      'https://www.aahealth.org/environmental-health/rabies-prevention/rabies-alerts',
      'https://www.aahealth.org/environmental-health/recreational-water-quality/closings-and-advisories',
      'https://www.aahealth.org/news',
    ],
    maxCandidates: 28,
    minRelevance: 70,
    urgencyOverride: 85,
    maxAgeDays: 60,
    context: 'Official Anne Arundel County health alerts. Prioritize Pasadena rabies alerts, Magothy/Pasadena recreational-water advisories, local environmental-health alerts, and true countywide emergencies. Generic product recalls, administrative pages, service directories, grant pages, and county navigation pages are not Pasadena local news and should score below the storage threshold unless the source explicitly establishes a direct Pasadena impact.',
    accept(url, anchorText) {
      const parsed = new URL(url);
      if (parsed.hostname !== 'www.aahealth.org') return false;
      const path = parsed.pathname.replace(/\/$/, '');
      const indexes = new Set([
        '/news',
        '/environmental-health/rabies-prevention/rabies-alerts',
        '/environmental-health/recreational-water-quality/closings-and-advisories',
      ]);
      if (indexes.has(path)) return false;
      if (/^\/(about-us|services|locations|contact-us|jobs)(?:\/|$)/i.test(path)) return false;
      if (/\/(privacy|ada|employment|statistics-and-reports|personnel-roster|grant-opportunities)$/i.test(path)) return false;
      return anchorText.trim().length >= 18 && path.split('/').filter(Boolean).length >= 2;
    },
    priority(url, text) {
      let score = LOCAL_TERMS.test(`${url} ${text}`) ? 120 : 0;
      if (/(rabies|advisory|swimming|water|bacteria|west nile|measles|heat|outbreak)/i.test(text)) score += 40;
      if (/recall/i.test(text)) score -= 30;
      return score;
    },
  },
  {
    name: 'Eye On Annapolis',
    listUrls: [
      'https://www.eyeonannapolis.net/?s=Pasadena',
      'https://www.eyeonannapolis.net/',
    ],
    maxCandidates: 30,
    minRelevance: 55,
    urgencyOverride: 85,
    maxAgeDays: 45,
    context: 'Independent Anne Arundel County local media. Keep stories with meaningful Pasadena-area value: Pasadena neighborhoods, Mountain Road, local businesses, schools, Fort Smallwood, the Magothy/Bodkin, waterfront events, development, health, infrastructure, or issues directly affecting residents. Annapolis-only, sports-only, advertorial, gambling, generic lifestyle, and weakly local material should score low.',
    accept(url) {
      const parsed = new URL(url);
      if (!/(^|\.)eyeonannapolis\.net$/i.test(parsed.hostname)) return false;
      return /^\/20\d{2}\/\d{2}\/[^/]+\/?$/i.test(parsed.pathname);
    },
    priority(url, text) {
      return LOCAL_TERMS.test(`${url} ${text}`) ? 150 : 0;
    },
  },
  {
    name: 'Anne Arundel County Public Schools',
    listUrls: [
      'https://www.aacps.org/o/chesapeakehs/live-feed',
      'https://www.aacps.org/o/northeasths/live-feed',
    ],
    maxCandidates: 20,
    minRelevance: 70,
    urgencyOverride: 90,
    maxAgeDays: 90,
    preferAnchorTitle: true,
    context: 'Official AACPS material discovered through the Chesapeake High and Northeast High feeds serving Pasadena. Prioritize news directly involving Pasadena schools and their clusters, calendars, boundaries, transportation, facilities, events, schedules, student opportunities, and district decisions with direct family impact. Routine county labor/administrative news without a distinct effect on Pasadena families should score below 70.',
    accept(url) {
      const parsed = new URL(url);
      if (parsed.hostname !== 'www.aacps.org') return false;
      return /(?:^|\/)article\/\d+\/?$/i.test(parsed.pathname);
    },
    priority(url, text) {
      return LOCAL_TERMS.test(`${url} ${text}`) ? 120 : 0;
    },
  },
];

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
  return htmlDecode(String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function articleText(html) {
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  return stripHtml(article ?? main ?? html);
}

function extractTitle(html) {
  const raw = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?? html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?? '';
  return stripHtml(raw).replace(/\s+/g, ' ').trim();
}

function extractAnchors(html, baseUrl, config) {
  const best = new Map();
  let order = 0;
  for (const match of String(html).matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    order += 1;
    try {
      const url = new URL(htmlDecode(match[1]), baseUrl);
      if (!/^https?:$/.test(url.protocol)) continue;
      url.hash = '';
      const text = stripHtml(match[2]).replace(/\s+/g, ' ').trim();
      if (!config.accept(url.toString(), text)) continue;
      const priority = config.priority?.(url.toString(), text) ?? 0;
      const existing = best.get(url.toString());
      if (!existing || priority > existing.priority || text.length > existing.text.length) {
        best.set(url.toString(), { url: url.toString(), text, priority, order, discoveredFrom: baseUrl });
      }
    } catch {
      // Ignore malformed source links.
    }
  }
  return [...best.values()];
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

async function getSourceRecord(name) {
  const rows = await supabaseGet('sources', { name: `eq.${name}`, select: 'id,trust_score', limit: '1' });
  if (!rows[0]) throw new Error(`Source not found in Supabase: ${name}`);
  return rows[0];
}

async function storyExists(sourceUrl) {
  const rows = await supabaseGet('stories', { source_url: `eq.${sourceUrl}`, select: 'id', limit: '1' });
  return rows.length > 0;
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'PasadenaCurrent/0.3 (+https://github.com/cyberupcowboy/Pasadena-Newsletter)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) throw new Error(`Fetch failed for ${url}: ${response.status}`);
  return response.text();
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

async function triageStory({ config, title, text, url, discoveredFrom }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: 'system', content: `${triagePrompt}\n\nSOURCE-SPECIFIC CONTEXT:\n${config.context}` },
        { role: 'user', content: `SOURCE: ${config.name}\nDISCOVERED FROM: ${discoveredFrom}\nURL: ${url}\nTITLE: ${title}\n\nSOURCE TEXT:\n${text.slice(0, 14000)}` },
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

function publishedAtFromHtmlOrText(html, text) {
  const rawCandidates = [
    html.match(/["']datePublished["']\s*:\s*["']([^"']+)["']/i)?.[1],
    html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1],
  ];
  for (const raw of rawCandidates) {
    if (!raw) continue;
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const numeric = text.match(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(20\d{2})\b/);
  if (numeric) return `${numeric[3]}-${numeric[1].padStart(2, '0')}-${numeric[2].padStart(2, '0')}T12:00:00Z`;

  const named = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/i);
  if (named) {
    const parsed = new Date(`${named[1]} ${named[2]}, ${named[3]} 12:00:00 UTC`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

function isFresh(publishedAt, maxAgeDays) {
  if (!publishedAt) return true;
  const age = Date.now() - new Date(publishedAt).getTime();
  return age <= maxAgeDays * 24 * 60 * 60 * 1000;
}

function externalId(url) {
  return `local:${createHash('sha256').update(url).digest('hex').slice(0, 24)}`;
}

async function candidatesFor(config) {
  const found = new Map();
  for (const listUrl of config.listUrls) {
    const html = await fetchText(listUrl);
    for (const candidate of extractAnchors(html, listUrl, config)) {
      const existing = found.get(candidate.url);
      if (!existing || candidate.priority > existing.priority) found.set(candidate.url, candidate);
    }
  }
  return [...found.values()]
    .sort((a, b) => b.priority - a.priority || a.order - b.order)
    .slice(0, config.maxCandidates);
}

async function ingestSource(config) {
  const source = await getSourceRecord(config.name);
  const candidates = await candidatesFor(config);
  console.log(`${config.name}: found ${candidates.length} candidate links.`);

  let inserted = 0, skipped = 0, filtered = 0, stale = 0, failed = 0;

  for (const candidate of candidates) {
    try {
      if (await storyExists(candidate.url)) { skipped += 1; continue; }
      const html = await fetchText(candidate.url);
      const text = articleText(html);
      if (text.length < 120) throw new Error('Extracted source text is unexpectedly short');

      const extractedTitle = extractTitle(html);
      const title = config.preferAnchorTitle && candidate.text.length >= 12
        ? candidate.text
        : (extractedTitle || candidate.text || 'Untitled local item');
      const publishedAt = publishedAtFromHtmlOrText(html, text);
      if (!isFresh(publishedAt, config.maxAgeDays)) {
        stale += 1;
        continue;
      }

      const triage = await triageStory({ config, title, text, url: candidate.url, discoveredFrom: candidate.discoveredFrom });
      if (triage.pasadena_relevance < config.minRelevance && triage.urgency < config.urgencyOverride) {
        filtered += 1;
        console.log(`Filtered ${config.name}: ${title} [relevance=${triage.pasadena_relevance}, urgency=${triage.urgency}]`);
        continue;
      }

      await supabaseInsertStory({
        source_id: source.id,
        external_id: externalId(candidate.url),
        source_url: candidate.url,
        source_title: title,
        original_text: text.slice(0, 16000),
        ai_headline: triage.ai_headline,
        ai_summary: triage.ai_summary,
        category: triage.category,
        pasadena_relevance: triage.pasadena_relevance,
        trust_score: source.trust_score,
        urgency: triage.urgency,
        location_text: triage.location_text || null,
        published_at: publishedAt,
        editorial_status: triage.should_review ? 'review' : 'new',
        ai_model: OPENAI_MODEL,
        ai_processed_at: new Date().toISOString(),
        relevance_reason: triage.relevance_reason,
      });
      inserted += 1;
      console.log(`Inserted ${config.name}: ${title} [relevance=${triage.pasadena_relevance}, urgency=${triage.urgency}]`);
    } catch (error) {
      failed += 1;
      console.error(`Failed ${config.name} ${candidate.url}:`, error instanceof Error ? error.message : error);
    }
  }

  return { source: config.name, candidates: candidates.length, inserted, skipped, filtered, stale, failed };
}

const results = [];
for (const config of SOURCE_CONFIGS) {
  try {
    results.push(await ingestSource(config));
  } catch (error) {
    results.push({ source: config.name, fatal: error instanceof Error ? error.message : String(error) });
  }
}

console.log(JSON.stringify(results));
if (results.every((result) => result.fatal)) process.exitCode = 1;
