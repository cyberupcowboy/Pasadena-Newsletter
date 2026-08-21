import { supabase, formatDateTime } from './lib/current.js';

const PASADENA = { lat: 39.1073, lon: -76.5711 };
const ANNAPOLIS_TIDE_STATION = '8575512';
const MARINE_ZONE = 'ANZ532';

const els = {
  nowUpdated: document.querySelector('#nowUpdated'),
  weatherCard: document.querySelector('#weatherNow'),
  alertCard: document.querySelector('#weatherAlerts'),
  trafficCard: document.querySelector('#trafficNow'),
  schoolCard: document.querySelector('#schoolNow'),
  tideCard: document.querySelector('#tideNow'),
  bayCard: document.querySelector('#bayNow'),
  happeningList: document.querySelector('#happeningTodayList'),
  talkingList: document.querySelector('#talkingList'),
  alertForm: document.querySelector('#quickAlertForm'),
  alertEmail: document.querySelector('#quickAlertEmail'),
  alertMessage: document.querySelector('#quickAlertMessage'),
};

function setCard(card, { icon, label, value, detail = '', href = null, alert = false }) {
  if (!card) return;
  card.dataset.alert = String(Boolean(alert));
  card.replaceChildren();

  const inner = href ? document.createElement('a') : document.createElement('div');
  if (href) inner.href = href;

  const iconEl = document.createElement('span');
  iconEl.className = 'now-icon';
  iconEl.textContent = icon;

  const labelEl = document.createElement('span');
  labelEl.className = 'now-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('strong');
  valueEl.className = 'now-value';
  valueEl.textContent = value;

  const detailEl = document.createElement('span');
  detailEl.className = 'now-detail';
  detailEl.textContent = detail;

  inner.append(iconEl, labelEl, valueEl, detailEl);
  card.append(inner);
}

async function jsonFetch(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/geo+json, application/json' },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function loadWeather() {
  try {
    const point = await jsonFetch(`https://api.weather.gov/points/${PASADENA.lat},${PASADENA.lon}`);
    const hourlyUrl = point?.properties?.forecastHourly;
    if (!hourlyUrl) throw new Error('No hourly forecast endpoint');
    const hourly = await jsonFetch(hourlyUrl);
    const period = hourly?.properties?.periods?.[0];
    if (!period) throw new Error('No current forecast period');

    setCard(els.weatherCard, {
      icon: '☀️',
      label: 'Weather',
      value: `${period.temperature}°${period.temperatureUnit || 'F'} · ${period.shortForecast}`,
      detail: `${period.windDirection || ''} ${period.windSpeed || ''}`.trim(),
      href: 'https://forecast.weather.gov/MapClick.php?lat=39.1073&lon=-76.5711',
    });
    return period;
  } catch {
    setCard(els.weatherCard, {
      icon: '🌤️', label: 'Weather', value: 'Forecast temporarily unavailable', detail: 'Open the National Weather Service',
      href: 'https://forecast.weather.gov/MapClick.php?lat=39.1073&lon=-76.5711',
    });
    return null;
  }
}

async function loadWeatherAlerts() {
  try {
    const data = await jsonFetch(`https://api.weather.gov/alerts/active?point=${PASADENA.lat},${PASADENA.lon}`);
    const alerts = Array.isArray(data?.features) ? data.features : [];
    const top = alerts[0]?.properties;
    setCard(els.alertCard, alerts.length ? {
      icon: '⚠️', label: 'Weather alerts', value: top?.event || `${alerts.length} active alert${alerts.length === 1 ? '' : 's'}`,
      detail: top?.headline || 'National Weather Service alert',
      href: top?.['@id'] || 'https://www.weather.gov/lwx/', alert: true,
    } : {
      icon: '✅', label: 'Weather alerts', value: 'No active local alerts', detail: 'National Weather Service', href: 'https://www.weather.gov/lwx/',
    });
    return alerts;
  } catch {
    setCard(els.alertCard, {
      icon: '⚠️', label: 'Weather alerts', value: 'Alert check unavailable', detail: 'Check NWS Baltimore/Washington', href: 'https://www.weather.gov/lwx/',
    });
    return [];
  }
}

async function loadTraffic() {
  const { data, error } = await supabase
    .from('traffic_events')
    .select('source_event_id,description,incident_type,traffic_alert,source_url,start_at')
    .eq('active', true)
    .order('traffic_alert', { ascending: false })
    .order('start_at', { ascending: false, nullsFirst: false })
    .limit(20);

  if (error) {
    setCard(els.trafficCard, { icon: '🚗', label: 'Traffic', value: 'Road feed unavailable', detail: 'Check Maryland CHART', href: 'https://chart.maryland.gov/' });
    return [];
  }

  const items = data || [];
  const alerts = items.filter((item) => item.traffic_alert).length;
  setCard(els.trafficCard, items.length ? {
    icon: '🚧', label: 'Traffic', value: `${items.length} active road item${items.length === 1 ? '' : 's'}`,
    detail: alerts ? `${alerts} marked as traffic alert${alerts === 1 ? '' : 's'}` : 'Pasadena-area CHART feed',
    href: '#roadSection', alert: alerts > 0,
  } : {
    icon: '🚗', label: 'Traffic', value: 'No active CHART disruptions', detail: 'Pasadena-area roads', href: '#roadSection',
  });
  return items;
}

function loadSchoolStatus() {
  const now = new Date();
  const start = new Date('2026-08-24T00:00:00-04:00');
  if (now < start) {
    setCard(els.schoolCard, {
      icon: '🚌', label: 'AACPS', value: 'Classes resume Monday, Aug. 24', detail: 'Check bus routes before the first day', href: 'https://www.aacps.org/',
    });
  } else {
    setCard(els.schoolCard, {
      icon: '🏫', label: 'AACPS', value: 'School-day information', detail: 'Closings, schedules and bus updates', href: 'https://www.aacps.org/',
    });
  }
}

async function loadTides() {
  const params = new URLSearchParams({
    product: 'predictions',
    application: 'PasadenaCurrent',
    date: 'today',
    range: '36',
    datum: 'MLLW',
    station: ANNAPOLIS_TIDE_STATION,
    time_zone: 'lst_ldt',
    units: 'english',
    interval: 'hilo',
    format: 'json',
  });
  try {
    const data = await jsonFetch(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params}`);
    const predictions = Array.isArray(data?.predictions) ? data.predictions : [];
    const now = Date.now();
    const next = predictions.find((item) => new Date(item.t.replace(' ', 'T')).getTime() >= now) || predictions[0];
    if (!next) throw new Error('No tide prediction');
    setCard(els.tideCard, {
      icon: next.type === 'H' ? '🌊' : '⚓',
      label: 'Tides · Annapolis',
      value: `${next.type === 'H' ? 'High' : 'Low'} ${Number(next.v).toFixed(1)} ft`,
      detail: formatDateTime(next.t.replace(' ', 'T')),
      href: `https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=${ANNAPOLIS_TIDE_STATION}`,
    });
    return predictions;
  } catch {
    setCard(els.tideCard, {
      icon: '🌊', label: 'Tides', value: 'Tide check unavailable', detail: 'NOAA Annapolis station',
      href: `https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=${ANNAPOLIS_TIDE_STATION}`,
    });
    return [];
  }
}

async function loadMarine() {
  try {
    const data = await jsonFetch(`https://api.weather.gov/zones/forecast/${MARINE_ZONE}/forecast`);
    const periods = data?.properties?.periods || [];
    const first = periods[0];
    if (!first) throw new Error('No marine forecast');
    setCard(els.bayCard, {
      icon: '⛵', label: 'On the Bay', value: first.name || 'Marine forecast', detail: first.detailedForecast || first.shortForecast || '',
      href: 'https://forecast.weather.gov/MapClick.php?zoneid=ANZ532',
    });
    return first;
  } catch {
    setCard(els.bayCard, {
      icon: '⛵', label: 'On the Bay', value: 'Marine forecast', detail: 'Chesapeake Bay · Sandy Point to North Beach',
      href: 'https://forecast.weather.gov/MapClick.php?zoneid=ANZ532',
    });
    return null;
  }
}

function dayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function fetchTodayEvents() {
  const { start, end } = dayBounds();
  const { data } = await supabase
    .from('events')
    .select('id,title,description,venue_name,starts_at,ends_at,source_url,category')
    .gte('starts_at', start)
    .lt('starts_at', end)
    .order('starts_at', { ascending: true })
    .limit(12);
  return data || [];
}

async function fetchRecentSignals() {
  const [storyResult, voiceResult] = await Promise.all([
    supabase.from('published_stories')
      .select('story_id,headline,summary,category,location_text,approved_at,pasadena_relevance')
      .eq('content_scope', 'local')
      .order('approved_at', { ascending: false, nullsFirst: false })
      .limit(15),
    supabase.from('published_community_submissions')
      .select('submission_id,headline,submission_type,location_text,published_at')
      .order('published_at', { ascending: false })
      .limit(8),
  ]);
  return { stories: storyResult.data || [], voices: voiceResult.data || [] };
}

function renderHappening({ events, traffic, weatherAlerts }) {
  if (!els.happeningList) return;
  const items = [];

  for (const alert of weatherAlerts.slice(0, 1)) {
    const p = alert.properties || {};
    items.push({ time: 'Alert', title: p.event || 'Weather alert', detail: p.headline || '', href: p['@id'] || 'https://www.weather.gov/lwx/' });
  }
  for (const event of events.slice(0, 4)) {
    const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(event.starts_at));
    items.push({ time, title: event.title, detail: event.venue_name || 'Pasadena area', href: event.source_url || './events/' });
  }
  for (const road of traffic.filter((item) => item.traffic_alert).slice(0, 2)) {
    items.push({ time: 'Road', title: road.description, detail: road.incident_type || 'Traffic alert', href: road.source_url || '#roadSection' });
  }

  if (!items.length) {
    items.push({ time: 'Today', title: 'No major local disruptions are posted right now.', detail: 'The Current will keep checking roads, weather and events.', href: './events/' });
  }

  els.happeningList.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const item of items.slice(0, 7)) {
    const row = document.createElement('article');
    row.className = 'happening-item';
    const time = document.createElement('span');
    time.className = 'happening-time';
    time.textContent = item.time;
    const copy = document.createElement('a');
    copy.href = item.href;
    if (/^https?:/.test(item.href)) { copy.target = '_blank'; copy.rel = 'noopener noreferrer'; }
    const title = document.createElement('h3'); title.textContent = item.title;
    const detail = document.createElement('p'); detail.textContent = item.detail;
    copy.append(title, detail);
    row.append(time, copy);
    fragment.append(row);
  }
  els.happeningList.append(fragment);
}

function renderTalking({ stories, voices, events, traffic }) {
  if (!els.talkingList) return;
  const signals = [];
  const seen = new Set();
  const add = (icon, title, source, href = null) => {
    const key = title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    if (!key || seen.has(key)) return;
    seen.add(key);
    signals.push({ icon, title, source, href });
  };

  traffic.filter((x) => x.traffic_alert).slice(0, 1).forEach((x) => add('🚧', x.description, 'Road activity', x.source_url));
  events.slice(0, 2).forEach((x) => add('📅', x.title, 'Happening today', x.source_url || './events/'));
  stories.slice(0, 4).forEach((x) => add(
    x.category === 'schools' ? '🏫' : x.category === 'government' ? '🏛️' : x.category === 'public_safety' ? '🚒' : x.category === 'water' ? '🦀' : '📰',
    x.headline,
    'Local reporting',
    `./story/?id=${encodeURIComponent(x.story_id)}`,
  ));
  voices.slice(0, 2).forEach((x) => add('💬', x.headline, 'Community Voices'));

  els.talkingList.replaceChildren();
  const fragment = document.createDocumentFragment();
  signals.slice(0, 6).forEach((signal) => {
    const item = document.createElement(signal.href ? 'a' : 'div');
    item.className = 'talking-item';
    if (signal.href) {
      item.href = signal.href;
      item.style.textDecoration = 'none';
      item.style.color = 'inherit';
      if (/^https?:/.test(signal.href)) { item.target = '_blank'; item.rel = 'noopener noreferrer'; }
    }
    const icon = document.createElement('span'); icon.textContent = signal.icon;
    const copy = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = signal.title;
    const source = document.createElement('small'); source.textContent = signal.source;
    copy.append(title, source); item.append(icon, copy); fragment.append(item);
  });
  els.talkingList.append(fragment);
}

async function subscribeQuick(event) {
  event.preventDefault();
  const email = els.alertEmail?.value.trim();
  if (!email) return;
  els.alertMessage.textContent = 'Saving your request…';
  els.alertMessage.dataset.kind = 'info';

  const { error } = await supabase.from('alert_subscriptions').insert({
    email,
    categories: ['local','traffic','schools','public_safety','weather','events'],
    neighborhoods: ['pasadena'],
    cadence: 'daily',
    consent: true,
    source: 'homepage_quick_signup',
  });

  if (error?.code === '23505') {
    els.alertMessage.textContent = 'That address is already on the Pasadena Morning Brief list.';
    els.alertMessage.dataset.kind = 'success';
  } else if (error) {
    els.alertMessage.textContent = 'We could not save that subscription request. Please try the alert preferences page.';
    els.alertMessage.dataset.kind = 'error';
  } else {
    els.alertMessage.textContent = 'You’re on the list for the Pasadena Morning Brief. Delivery activation will follow the email confirmation workflow.';
    els.alertMessage.dataset.kind = 'success';
    els.alertForm.reset();
  }
}

async function loadDashboard() {
  loadSchoolStatus();
  const [weather, weatherAlerts, traffic, tides, marine, events, signals] = await Promise.all([
    loadWeather(),
    loadWeatherAlerts(),
    loadTraffic(),
    loadTides(),
    loadMarine(),
    fetchTodayEvents(),
    fetchRecentSignals(),
  ]);
  renderHappening({ events, traffic, weatherAlerts, weather, tides, marine });
  renderTalking({ stories: signals.stories, voices: signals.voices, events, traffic });
  if (els.nowUpdated) els.nowUpdated.textContent = `Updated ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date())}`;
}

els.alertForm?.addEventListener('submit', subscribeQuick);
loadDashboard();
