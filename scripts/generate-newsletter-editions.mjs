const SUPABASE_URL = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_SECRET_KEY = requiredEnv('SUPABASE_SECRET_KEY');
const PASADENA = { lat: 39.1073, lon: -76.5711 };

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
function headers(extra = {}) {
  const h = { apikey: SUPABASE_SECRET_KEY, 'Content-Type': 'application/json', ...extra };
  if (!SUPABASE_SECRET_KEY.startsWith('sb_secret_')) h.Authorization = `Bearer ${SUPABASE_SECRET_KEY}`;
  return h;
}
async function get(table, params) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) throw new Error(`Supabase GET ${table}: ${response.status} ${await response.text()}`);
  return response.json();
}
async function upsertEdition(row) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/newsletter_editions`);
  url.searchParams.set('on_conflict', 'edition_type,issue_date');
  const response = await fetch(url, {
    method: 'POST', headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error(`Newsletter upsert failed: ${response.status} ${await response.text()}`);
}
function localDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((p) => [p.type,p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function localWeekday() { return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long'}).format(new Date()); }
function dateLabel(value) { return new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value)); }

async function weatherLine() {
  try {
    const point = await fetch(`https://api.weather.gov/points/${PASADENA.lat},${PASADENA.lon}`, { headers: { 'User-Agent': 'ThePasadenaCurrent/1.0 contact@pasadenacurrent.local' } }).then((r) => r.json());
    const url = point?.properties?.forecastHourly;
    if (!url) return null;
    const forecast = await fetch(url, { headers: { 'User-Agent': 'ThePasadenaCurrent/1.0 contact@pasadenacurrent.local' } }).then((r) => r.json());
    const p = forecast?.properties?.periods?.[0];
    return p ? `${p.temperature}°${p.temperatureUnit || 'F'} · ${p.shortForecast} · wind ${p.windDirection || ''} ${p.windSpeed || ''}`.trim() : null;
  } catch { return null; }
}

async function loadData() {
  const now = new Date().toISOString();
  const horizon = new Date(); horizon.setDate(horizon.getDate()+8);
  const [stories, traffic, events, voices, weather] = await Promise.all([
    get('published_stories',{ select:'story_id,headline,summary,category,content_scope,approved_at,source_url', content_scope:'eq.local', order:'approved_at.desc', limit:'20' }),
    get('traffic_events',{ select:'description,incident_type,traffic_alert,start_at', active:'eq.true', order:'traffic_alert.desc,start_at.desc', limit:'8' }),
    get('events',{ select:'title,venue_name,starts_at,source_url,category', starts_at:`gte.${now}`, order:'starts_at.asc', limit:'30' }),
    get('published_community_submissions',{ select:'headline,byline,submission_type,published_at', order:'published_at.desc', limit:'8' }),
    weatherLine(),
  ]);
  return { stories, traffic, events: events.filter((e) => new Date(e.starts_at) < horizon), voices, weather };
}

function morningDraft(data) {
  const top = data.stories.slice(0,5);
  const lines = [
    'THE PASADENA CURRENT — PASADENA MORNING BRIEF',
    localDate(),
    '',
    '5 THINGS TO KNOW',
    ...top.flatMap((s,i) => [`${i+1}. ${s.headline}`, s.summary || '', `Current brief: https://cyberupcowboy.github.io/Pasadena-Newsletter/story/?id=${s.story_id}`, '']),
    'RIGHT NOW',
    `Weather: ${data.weather || 'Check the National Weather Service from The Current homepage.'}`,
    `Traffic: ${data.traffic.length ? `${data.traffic.length} active CHART items; ${data.traffic.filter((x)=>x.traffic_alert).length} marked as traffic alerts.` : 'No active CHART disruptions in the feed.'}`,
    'Schools: Check AACPS status, schedules and bus information before departure.',
    '',
    'HAPPENING TODAY / NEXT',
    ...(data.events.slice(0,5).map((e) => `• ${dateLabel(e.starts_at)} — ${e.title}${e.venue_name ? ` · ${e.venue_name}` : ''}`)),
    '',
    'FROM THE COMMUNITY',
    ...(data.voices.slice(0,1).map((v) => `• ${v.headline} — ${v.byline}`)),
    '',
    'Read the local current: https://cyberupcowboy.github.io/Pasadena-Newsletter/',
  ];
  return lines.join('\n');
}

function weekAheadDraft(data) {
  const lines = [
    'THE PASADENA CURRENT — SUNDAY WEEK AHEAD',
    localDate(),
    '',
    'WHAT TO WATCH',
    ...data.stories.slice(0,5).map((s) => `• ${s.headline} — ${s.summary || ''}`),
    '',
    'ON THE CALENDAR',
    ...(data.events.slice(0,12).map((e) => `• ${dateLabel(e.starts_at)} — ${e.title}${e.venue_name ? ` · ${e.venue_name}` : ''}`)),
    '',
    'PLAN AHEAD',
    '• Check The Current for updated traffic, weather, tides, school status and public meetings as the week develops.',
    '',
    'Open the community dashboard: https://cyberupcowboy.github.io/Pasadena-Newsletter/',
  ];
  return lines.join('\n');
}

async function main() {
  const data = await loadData();
  const issueDate = localDate();
  const morning = morningDraft(data);
  await upsertEdition({ edition_type:'morning', issue_date:issueDate, subject:`Pasadena Morning Brief — ${issueDate}`, body:morning, status:'draft', generated_at:new Date().toISOString() });
  console.log('Stored Morning Brief draft.');
  if (localWeekday() === 'Sunday' || process.env.FORCE_WEEK_AHEAD === 'true') {
    const weekly = weekAheadDraft(data);
    await upsertEdition({ edition_type:'week_ahead', issue_date:issueDate, subject:`Pasadena Week Ahead — ${issueDate}`, body:weekly, status:'draft', generated_at:new Date().toISOString() });
    console.log('Stored Sunday Week Ahead draft.');
  }
}
await main();
