const SOURCE_NAME = 'Anne Arundel County Public Library';
const LIST_URL = 'https://www.aacpl.net/events/list';
const MAX_PAGES = Number(process.env.MAX_PAGES ?? '3');

const SUPABASE_URL = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY');

const LOCAL_VENUES = [
  { match: /Mountain Road(?:\s+-[^\n]+)?\s+Library/i, name: 'Mountain Road Library', relevance: 100 },
  { match: /Riviera Beach(?:\s+-[^\n]+)?(?:\s+at)?\s+Riviera Beach Library/i, name: 'Riviera Beach Library', relevance: 100 },
  { match: /Pasadena Senior Center/i, name: 'Pasadena Senior Center', relevance: 95 },
];

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
  return htmlDecode(html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim());
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

async function upsertEvent(row) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/events`);
  url.searchParams.set('on_conflict', 'source_id,title,starts_at,venue_name');
  const response = await fetch(url, {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error(`Supabase UPSERT events failed: ${response.status} ${await response.text()}`);
}

async function getSourceRecord() {
  const rows = await supabaseGet('sources', { name: `eq.${SOURCE_NAME}`, select: 'id', limit: '1' });
  if (!rows[0]) throw new Error(`Source not found in Supabase: ${SOURCE_NAME}`);
  return rows[0];
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'PasadenaCurrent/0.1 (+https://github.com/cyberupcowboy/Pasadena-Newsletter)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) throw new Error(`Fetch failed for ${url}: ${response.status}`);
  return response.text();
}

function isDstEastern(year, month, day) {
  const nthSunday = (m, n) => {
    const first = new Date(Date.UTC(year, m - 1, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + (n - 1) * 7;
  };
  const secondSundayMarch = nthSunday(3, 2);
  const firstSundayNovember = nthSunday(11, 1);
  if (month < 3 || month > 11) return false;
  if (month > 3 && month < 11) return true;
  if (month === 3) return day >= secondSundayMarch;
  return day < firstSundayNovember;
}

function toEasternIso(year, month, day, hour, minute) {
  let h = hour;
  const suffixMatch = String(hour).match?.(/./);
  void suffixMatch;
  const offset = isDstEastern(year, month, day) ? '-04:00' : '-05:00';
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${String(h).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00${offset}`;
}

function parseClock(raw) {
  const match = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const ap = match[3].toLowerCase();
  if (hour === 12) hour = 0;
  if (ap === 'pm') hour += 12;
  return { hour, minute };
}

function parseDateRange(text) {
  const monthNames = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
  let match = text.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))(?:\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)))?/i);
  if (match) {
    const month = monthNames[match[1].toLowerCase()];
    const day = Number(match[2]);
    const year = Number(match[3]);
    const start = parseClock(match[4]);
    const end = match[5] ? parseClock(match[5]) : null;
    if (!start) return null;
    return {
      startsAt: toEasternIso(year, month, day, start.hour, start.minute),
      endsAt: end ? toEasternIso(year, month, day, end.hour, end.minute) : null,
    };
  }

  match = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*@\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))(?:\s+(?:to|[-–])\s+(?:(\d{1,2})\/(\d{1,2})\/(\d{4})\s*@\s*)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)))?/i);
  if (!match) return null;
  const startMonth = Number(match[1]);
  const startDay = Number(match[2]);
  const startYear = Number(match[3]);
  const start = parseClock(match[4]);
  const endMonth = Number(match[5] ?? startMonth);
  const endDay = Number(match[6] ?? startDay);
  const endYear = Number(match[7] ?? startYear);
  const end = match[8] ? parseClock(match[8]) : null;
  if (!start) return null;
  return {
    startsAt: toEasternIso(startYear, startMonth, startDay, start.hour, start.minute),
    endsAt: end ? toEasternIso(endYear, endMonth, endDay, end.hour, end.minute) : null,
  };
}

function headingBlocks(html) {
  const headings = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  const blocks = [];
  for (let i = 0; i < headings.length; i += 1) {
    const start = headings[i].index ?? 0;
    const end = headings[i + 1]?.index ?? Math.min(html.length, start + 12000);
    blocks.push({ heading: headings[i][1], html: html.slice(start, end) });
  }
  return blocks;
}

function venueFor(text) {
  for (const venue of LOCAL_VENUES) if (venue.match.test(text)) return venue;
  return null;
}

function detailUrl(blockHtml) {
  const links = [...blockHtml.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const candidate = links.find((href) => /\/events?\//i.test(href) && !/\/events\/(list|month|week|day|upcoming)(?:[/?#]|$)/i.test(href));
  return candidate ? new URL(candidate, 'https://www.aacpl.net').toString() : LIST_URL;
}

async function main() {
  const source = await getSourceRecord();
  const found = new Map();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = page === 0 ? LIST_URL : `${LIST_URL}?page=${page}`;
    const html = await fetchText(url);
    for (const block of headingBlocks(html)) {
      const title = stripHtml(block.heading).replace(/\s+/g, ' ').trim();
      const text = stripHtml(block.html);
      const venue = venueFor(text);
      if (!title || !venue) continue;
      const range = parseDateRange(text);
      if (!range) {
        console.warn(`Could not parse date for local AACPL event: ${title}`);
        continue;
      }
      if (new Date(range.startsAt).getTime() < Date.now() - 6 * 60 * 60 * 1000) continue;
      const key = `${title}|${range.startsAt}|${venue.name}`;
      if (!found.has(key)) {
        found.set(key, {
          source_id: source.id,
          title,
          description: text.slice(0, 3000),
          venue_name: venue.name,
          address: venue.name === 'Mountain Road Library' ? '4730 Mountain Road, Pasadena, MD 21122' : null,
          starts_at: range.startsAt,
          ends_at: range.endsAt,
          source_url: detailUrl(block.html),
          category: 'events',
          pasadena_relevance: venue.relevance,
          editorial_status: 'approved',
        });
      }
    }
  }

  let upserted = 0;
  for (const row of found.values()) {
    await upsertEvent(row);
    upserted += 1;
    console.log(`Upserted AACPL event: ${row.title} @ ${row.venue_name} ${row.starts_at}`);
  }
  console.log(JSON.stringify({ upserted, candidates: found.size }));
}

await main();
