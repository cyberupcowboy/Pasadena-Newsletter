import { createHash } from 'node:crypto';

const SOURCE_NAME = 'Maryland CHART';
const INCIDENTS_XML_URL = 'https://chart.maryland.gov/DataFeeds/GetIncidentXml';
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

function decodeXml(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function tagValue(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null;
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

async function fetchXml() {
  const response = await fetch(INCIDENTS_XML_URL, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'PasadenaCurrent/0.2 (+https://github.com/cyberupcowboy/Pasadena-Newsletter)',
      Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.5',
    },
  });
  if (!response.ok) throw new Error(`CHART incident feed failed: ${response.status} ${response.statusText}`);
  const text = await response.text();
  if (!/<Incident(?:\s|>)/i.test(text) && !/<Incidents(?:\s|>)/i.test(text)) {
    throw new Error('CHART incident feed did not look like incident XML');
  }
  return text;
}

function parseIncidents(xml) {
  const events = [];
  for (const match of String(xml).matchAll(/<Incident(?:\s[^>]*)?>[\s\S]*?<\/Incident>/gi)) {
    const block = match[0];
    events.push({
      id: tagValue(block, 'id'),
      trackingNumber: tagValue(block, 'trackingNumber'),
      closed: tagValue(block, 'closed'),
      county: tagValue(block, 'county'),
      description: tagValue(block, 'description') || tagValue(block, 'name'),
      incidentType: tagValue(block, 'incidentType'),
      direction: tagValue(block, 'direction'),
      lanesStatus: tagValue(block, 'lanesStatus') || tagValue(block, 'lanesClosed'),
      trafficAlert: tagValue(block, 'trafficAlert'),
      trafficAlertTextMsg: tagValue(block, 'trafficAlertTextMsg') || tagValue(block, 'publicComments'),
      lat: tagValue(block, 'lat'),
      lon: tagValue(block, 'lon'),
      startDateTime: tagValue(block, 'startDateTime') || tagValue(block, 'createTime'),
    });
  }
  return events;
}

function milesBetween(lat1, lon1, lat2, lon2) {
  const rad = (n) => n * Math.PI / 180;
  const earthMiles = 3958.7613;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isTrue(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

function localTrafficEvent(event) {
  if (isTrue(event.closed)) return false;
  const text = [event.description, event.trafficAlertTextMsg].filter(Boolean).join(' ');
  const explicitLocal = /(pasadena|mountain\s+road|md[- ]?177|route\s+177|fort\s+smallwood|md[- ]?173|lake\s+shore|hog\s+neck|solley|edwin\s+raynor|jumpers\s+hole|route\s+100|md[- ]?100|route\s+10|md[- ]?10|duvall\s+highway|rivi[eè]ra\s+beach|bodkin)/i.test(text);
  if (explicitLocal) return true;
  if (!/anne arundel/i.test(String(event.county ?? ''))) return false;
  const lat = Number(event.lat);
  const lon = Number(event.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) && milesBetween(PASADENA_LAT, PASADENA_LON, lat, lon) <= MAX_RADIUS_MILES;
}

function stableEventId(event) {
  const raw = event.id || event.trackingNumber;
  if (raw) return `chart:${raw}`;
  const fingerprint = JSON.stringify([event.description, event.startDateTime, event.lat, event.lon]);
  return `chart:${createHash('sha256').update(fingerprint).digest('hex').slice(0, 24)}`;
}

function isoOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function main() {
  const source = await getSourceRecord();
  const xml = await fetchXml();
  const statewide = parseIncidents(xml);
  const local = statewide.filter(localTrafficEvent);

  // Only expire the previous snapshot after the official feed was successfully fetched and parsed.
  await patchActiveFalse();

  const seenAt = new Date().toISOString();
  for (const event of local) {
    const lat = Number(event.lat);
    const lon = Number(event.lon);
    await upsertTraffic({
      source_event_id: stableEventId(event),
      source_id: source.id,
      description: event.description || 'Traffic event',
      incident_type: event.incidentType || null,
      county: event.county || null,
      direction: event.direction || null,
      lanes_status: event.lanesStatus || null,
      traffic_alert: isTrue(event.trafficAlert),
      traffic_alert_text: event.trafficAlertTextMsg || null,
      latitude: Number.isFinite(lat) ? lat : null,
      longitude: Number.isFinite(lon) ? lon : null,
      start_at: isoOrNull(event.startDateTime),
      last_seen_at: seenAt,
      source_url: PUBLIC_INCIDENTS_URL,
      active: true,
    });
  }

  console.log(JSON.stringify({ feed: INCIDENTS_XML_URL, statewide_records: statewide.length, local_active: local.length, radius_miles: MAX_RADIUS_MILES }));
}

await main();
