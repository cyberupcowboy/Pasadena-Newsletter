import { createHash } from 'node:crypto';

const SOURCE_NAME = 'Maryland CHART';
const DATA_FEEDS_URL = 'https://chart.maryland.gov/DataFeeds/GetDataFeeds';
const PUBLIC_INCIDENTS_URL = 'https://chart.maryland.gov/Incidents/GetIncidents';
const PASADENA_LAT = 39.1073;
const PASADENA_LON = -76.5711;
const MAX_RADIUS_MILES = Number(process.env.TRAFFIC_RADIUS_MILES ?? '15');

const SUPABASE_URL = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY');

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

async function patchActiveFalse() {
  const url = new URL(`${SUPABASE_URL}/rest/v1/traffic_events`);
  url.searchParams.set('active', 'eq.true');
  const response = await fetch(url, {
    method: 'PATCH',
    headers: supabaseHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ active: false }),
  });
  if (!response.ok) throw new Error(`Supabase traffic deactivate failed: ${response.status} ${await response.text()}`);
}

async function upsertTraffic(row) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/traffic_events`);
  url.searchParams.set('on_conflict', 'source_event_id');
  const response = await fetch(url, {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error(`Supabase traffic upsert failed: ${response.status} ${await response.text()}`);
}

async function getSourceRecord() {
  const rows = await supabaseGet('sources', { name: `eq.${SOURCE_NAME}`, select: 'id', limit: '1' });
  if (!rows[0]) throw new Error(`Source not found in Supabase: ${SOURCE_NAME}`);
  return rows[0];
}

async function fetchRaw(url, accept = '*/*') {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'PasadenaCurrent/0.1 (+https://github.com/cyberupcowboy/Pasadena-Newsletter)',
      Accept: accept,
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response;
}

function discoverJsonUrls(html) {
  const found = new Set();
  const absoluteOrRelative = /(?:href|url|data-url|onclick)[^>\n]*?["']([^"']*Json[^"']*)["']/gi;
  for (const match of html.matchAll(absoluteOrRelative)) {
    const raw = match[1].replace(/&amp;/g, '&');
    try { found.add(new URL(raw, DATA_FEEDS_URL).toString()); } catch { /* ignore */ }
  }
  const pathOnly = /(\/DataFeeds\/[A-Za-z0-9_-]*Json)/gi;
  for (const match of html.matchAll(pathOnly)) found.add(new URL(match[1], DATA_FEEDS_URL).toString());

  const fallbacks = [
    '/DataFeeds/GetTrafficEventsJson',
    '/DataFeeds/GetIncidentsJson',
    '/DataFeeds/GetTrafficIncidentsJson',
    '/DataFeeds/GetRoadClosuresJson',
  ];
  fallbacks.forEach((path) => found.add(new URL(path, DATA_FEEDS_URL).toString()));

  return [...found].filter((url) => {
    const path = new URL(url).pathname.toLowerCase();
    if (!/(traffic|incident|event|closure)/.test(path)) return false;
    return !/(camera|speed|weather|sign|travel|snow)/.test(path);
  });
}

function scoreArray(array) {
  if (!Array.isArray(array) || !array.length) return 0;
  const sample = array.find((x) => x && typeof x === 'object' && !Array.isArray(x));
  if (!sample) return 0;
  let score = 0;
  for (const key of ['id','county','description','name','lat','lon','startDateTime','incidentType']) if (key in sample) score += 1;
  return score;
}

function findBestEventArray(value) {
  let best = null;
  let bestScore = 0;
  const visit = (node, depth = 0) => {
    if (depth > 5 || node == null) return;
    if (Array.isArray(node)) {
      const score = scoreArray(node);
      if (score > bestScore) { best = node; bestScore = score; }
      node.slice(0, 5).forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof node === 'object') Object.values(node).forEach((item) => visit(item, depth + 1));
  };
  visit(value);
  return bestScore >= 3 ? best : null;
}

function milesBetween(lat1, lon1, lat2, lon2) {
  const rad = (n) => n * Math.PI / 180;
  const earthMiles = 3958.7613;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function firstValue(event, names) {
  for (const name of names) if (event?.[name] !== undefined && event?.[name] !== null && event?.[name] !== '') return event[name];
  return null;
}

function localTrafficEvent(event) {
  if (event.closed === true || String(event.closed).toLowerCase() === 'true') return false;
  const county = String(firstValue(event, ['county','countyName','County']) ?? '');
  const text = [
    firstValue(event, ['description','name','trafficAlertTextMsg','publicComments']),
    firstValue(event, ['route','routeNumber','location']),
  ].filter(Boolean).join(' ');

  const explicitLocal = /(pasadena|mountain\s+road|md[- ]?177|route\s+177|fort\s+smallwood|lake\s+shore|hog\s+neck|solley|edwin\s+raynor|jumpers\s+hole|route\s+100|md[- ]?100|route\s+10|md[- ]?10)/i.test(text);
  if (explicitLocal) return true;
  if (!/anne arundel/i.test(county)) return false;

  const lat = Number(firstValue(event, ['lat','latitude','Latitude']));
  const lon = Number(firstValue(event, ['lon','lng','longitude','Longitude']));
  return Number.isFinite(lat) && Number.isFinite(lon) && milesBetween(PASADENA_LAT, PASADENA_LON, lat, lon) <= MAX_RADIUS_MILES;
}

function stableEventId(event) {
  const raw = firstValue(event, ['id','trackingNumber','eventId','eventID']);
  if (raw !== null) return `chart:${raw}`;
  const fingerprint = JSON.stringify([
    firstValue(event, ['description','name']),
    firstValue(event, ['startDateTime','createTime']),
    firstValue(event, ['lat','latitude']),
    firstValue(event, ['lon','longitude']),
  ]);
  return `chart:${createHash('sha256').update(fingerprint).digest('hex').slice(0, 24)}`;
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function loadChartEvents() {
  const feedPage = await (await fetchRaw(DATA_FEEDS_URL, 'text/html')).text();
  const candidates = discoverJsonUrls(feedPage);
  console.log(`CHART JSON candidates: ${candidates.join(', ')}`);

  const combined = new Map();
  let successfulFeeds = 0;
  const failures = [];

  for (const url of candidates) {
    try {
      const response = await fetchRaw(url, 'application/json,text/plain;q=0.9,*/*;q=0.8');
      const text = await response.text();
      const json = JSON.parse(text);
      const events = findBestEventArray(json);
      if (!events) throw new Error('JSON did not contain a recognizable traffic-event array');
      successfulFeeds += 1;
      for (const event of events) {
        if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
        combined.set(stableEventId(event), event);
      }
      console.log(`Loaded ${events.length} CHART records from ${url}`);
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (!successfulFeeds) throw new Error(`No CHART JSON traffic feed succeeded. ${failures.join(' | ')}`);
  return [...combined.values()];
}

async function main() {
  const source = await getSourceRecord();
  const chartEvents = await loadChartEvents();
  const local = chartEvents.filter(localTrafficEvent);

  // Only expire the prior snapshot after at least one official CHART feed was fetched successfully.
  await patchActiveFalse();

  const seenAt = new Date().toISOString();
  for (const event of local) {
    const lat = Number(firstValue(event, ['lat','latitude','Latitude']));
    const lon = Number(firstValue(event, ['lon','lng','longitude','Longitude']));
    const description = String(firstValue(event, ['description','name']) ?? 'Traffic event').trim();
    await upsertTraffic({
      source_event_id: stableEventId(event),
      source_id: source.id,
      description,
      incident_type: firstValue(event, ['incidentType','eventType','typeDescription'])?.toString() ?? null,
      county: firstValue(event, ['county','countyName','County'])?.toString() ?? null,
      direction: firstValue(event, ['direction'])?.toString() ?? null,
      lanes_status: firstValue(event, ['lanesStatus','lanesClosed'])?.toString() ?? null,
      traffic_alert: Boolean(firstValue(event, ['trafficAlert'])),
      traffic_alert_text: firstValue(event, ['trafficAlertTextMsg','publicComments'])?.toString() ?? null,
      latitude: Number.isFinite(lat) ? lat : null,
      longitude: Number.isFinite(lon) ? lon : null,
      start_at: isoOrNull(firstValue(event, ['startDateTime','createTime'])),
      last_seen_at: seenAt,
      source_url: PUBLIC_INCIDENTS_URL,
      active: true,
    });
  }

  console.log(JSON.stringify({ official_records: chartEvents.length, local_active: local.length, radius_miles: MAX_RADIUS_MILES }));
}

await main();
