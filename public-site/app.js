import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm';

const SUPABASE_URL = 'https://eedpedkvymohcubdaoey.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_6RReetP9MPYS_xn0k6xzrw_AVBbgBRs';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const els = {
  editionDate: document.querySelector('#editionDate'),
  storyCount: document.querySelector('#storyCount'),
  loadingState: document.querySelector('#loadingState'),
  errorState: document.querySelector('#errorState'),
  emptyState: document.querySelector('#emptyState'),
  roadSection: document.querySelector('#roadSection'),
  trafficList: document.querySelector('#trafficList'),
  storySection: document.querySelector('#storySection'),
  featuredStory: document.querySelector('#featuredStory'),
  storyGrid: document.querySelector('#storyGrid'),
  categoryFilters: document.querySelector('#categoryFilters'),
  beyondSection: document.querySelector('#beyondSection'),
  stateNewsSection: document.querySelector('#stateNewsSection'),
  stateNewsGrid: document.querySelector('#stateNewsGrid'),
  nationalNewsSection: document.querySelector('#nationalNewsSection'),
  nationalNewsGrid: document.querySelector('#nationalNewsGrid'),
  voicesSection: document.querySelector('#voicesSection'),
  voicesGrid: document.querySelector('#voicesGrid'),
  eventsSection: document.querySelector('#eventsSection'),
  eventGrid: document.querySelector('#eventGrid'),
  storyTemplate: document.querySelector('#storyTemplate'),
};

let allStories = [];
let stories = [];
let stateStories = [];
let nationalStories = [];
let activeCategory = 'all';
let featuredStoryId = null;

function setHidden(element, hidden) {
  element.classList.toggle('hidden', hidden);
}

function labelCategory(value) {
  if (!value) return 'Community';
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function labelSubmissionType(value) {
  return ({
    news_report: 'Community report',
    opinion: 'Opinion',
    community_notice: 'Neighborhood note',
    event: 'Community event',
    tip: 'Community tip',
    yard_sale: 'Yard sale',
    lost_found: 'Lost & found',
    business: 'Local business',
    photo: 'Community photo',
    other: 'Community voice',
  })[value] || 'Community voice';
}

function relevanceLabel(score) {
  const value = Number(score ?? 0);
  if (value >= 80) return 'Pasadena';
  if (value >= 55) return 'Strong local';
  if (value >= 30) return 'Countywide';
  return 'Regional';
}

function framingLabel(story) {
  if (!story.political_content || story.political_slant === 'not_political') return 'Nonpolitical';
  const label = ({
    left: 'Left-leaning',
    center: 'Center / straight',
    right: 'Right-leaning',
    mixed: 'Mixed framing',
    unclear: 'Unclear framing',
  })[story.political_slant] || 'Unclear framing';
  const confidence = Number(story.political_slant_confidence);
  return Number.isFinite(confidence) ? `${label} · ${confidence}%` : label;
}

function sourceKey(story) {
  try {
    return new URL(story.source_url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return story.source_title || 'unknown-source';
  }
}

function isRoutinePoliceStory(story) {
  return /\/police-department\//i.test(story.source_url || '')
    && ['crime', 'public_safety'].includes(story.category);
}

function diversifyStories(items) {
  const selected = [];
  const sourceCounts = new Map();
  let routinePolice = 0;

  for (const story of items) {
    const source = sourceKey(story);
    const sourceCount = sourceCounts.get(source) || 0;
    const police = isRoutinePoliceStory(story);
    if (police && routinePolice >= 1) continue;
    if (sourceCount >= 2) continue;
    selected.push(story);
    sourceCounts.set(source, sourceCount + 1);
    if (police) routinePolice += 1;
  }

  return selected;
}

function formatDate(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function formatRoadTime(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function formatEventTime(startsAt, endsAt) {
  const start = new Date(startsAt);
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(start);
  const startTime = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(start);
  if (!endsAt) return `${day} · ${startTime}`;
  const end = new Date(endsAt);
  const endTime = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(end);
  return `${day} · ${startTime}–${endTime}`;
}

function storyMeta(story) {
  return [story.location_text, formatDate(story.source_published_at || story.approved_at)].filter(Boolean).join(' · ');
}

function renderFeatured(story) {
  els.featuredStory.replaceChildren();
  featuredStoryId = story.story_id;

  const top = document.createElement('div');
  top.className = 'card-topline';
  const category = document.createElement('span');
  category.className = 'category';
  category.textContent = labelCategory(story.category);
  const relevance = document.createElement('span');
  relevance.className = 'local-score';
  relevance.textContent = relevanceLabel(story.pasadena_relevance);
  top.append(category, relevance);

  const title = document.createElement('h2');
  title.textContent = story.headline;
  const summary = document.createElement('p');
  summary.className = 'featured-summary';
  summary.textContent = story.summary || '';
  const meta = document.createElement('p');
  meta.className = 'story-meta';
  meta.textContent = storyMeta(story);
  const link = document.createElement('a');
  link.className = 'read-source';
  link.href = story.source_url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Read original source →';

  els.featuredStory.append(top, title, summary, meta, link);
}

function renderCard(story) {
  const card = els.storyTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector('.category').textContent = labelCategory(story.category);
  card.querySelector('.local-score').textContent = relevanceLabel(story.pasadena_relevance);
  card.querySelector('h3').textContent = story.headline;
  card.querySelector('.summary').textContent = story.summary || '';
  card.querySelector('.story-meta').textContent = storyMeta(story);
  card.querySelector('.read-source').href = story.source_url;
  return card;
}

function renderFilters() {
  const categories = [...new Set(allStories.map((story) => story.category).filter(Boolean))].sort();
  els.categoryFilters.replaceChildren();

  const makeButton = (value, label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter-chip';
    button.dataset.active = String(activeCategory === value);
    button.textContent = label;
    button.addEventListener('click', () => {
      activeCategory = value;
      renderFilters();
      renderGrid();
    });
    return button;
  };

  els.categoryFilters.append(makeButton('all', 'All'));
  categories.forEach((category) => els.categoryFilters.append(makeButton(category, labelCategory(category))));
}

function renderGrid() {
  els.storyGrid.replaceChildren();
  const source = activeCategory === 'all' ? stories : allStories;
  const filtered = source.filter((story) => {
    if (story.story_id === featuredStoryId) return false;
    return activeCategory === 'all' || story.category === activeCategory;
  });
  const fragment = document.createDocumentFragment();
  filtered.forEach((story) => fragment.append(renderCard(story)));
  els.storyGrid.append(fragment);
}

function renderDeskStory(story) {
  const card = document.createElement('article');
  card.className = 'desk-story';

  const top = document.createElement('div');
  top.className = 'desk-story-topline';
  const source = document.createElement('span');
  source.className = 'desk-source';
  source.textContent = story.source_title || sourceKey(story);
  const framing = document.createElement('span');
  framing.className = `framing-badge framing-${story.political_slant || 'unclear'}`;
  framing.textContent = framingLabel(story);
  top.append(source, framing);

  const title = document.createElement('h4');
  title.textContent = story.headline;
  const summary = document.createElement('p');
  summary.className = 'desk-summary';
  summary.textContent = story.summary || '';
  const meta = document.createElement('p');
  meta.className = 'desk-meta';
  meta.textContent = [labelCategory(story.category), formatDate(story.source_published_at || story.approved_at)].filter(Boolean).join(' · ');
  const link = document.createElement('a');
  link.className = 'utility-link';
  link.href = story.source_url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Read source →';

  card.append(top, title, summary, meta, link);
  return card;
}

function sortDesk(items) {
  return [...items].sort((a, b) => {
    const aDate = new Date(a.source_published_at || a.approved_at || 0).getTime();
    const bDate = new Date(b.source_published_at || b.approved_at || 0).getTime();
    return bDate - aDate || Number(b.urgency || 0) - Number(a.urgency || 0);
  });
}

function renderNewsDesk(items, grid, section) {
  grid.replaceChildren();
  const selected = sortDesk(items).slice(0, 6);
  if (!selected.length) {
    setHidden(section, true);
    return;
  }
  const fragment = document.createDocumentFragment();
  selected.forEach((story) => fragment.append(renderDeskStory(story)));
  grid.append(fragment);
  setHidden(section, false);
}

function renderBeyond() {
  renderNewsDesk(stateStories, els.stateNewsGrid, els.stateNewsSection);
  renderNewsDesk(nationalStories, els.nationalNewsGrid, els.nationalNewsSection);
  setHidden(els.beyondSection, !stateStories.length && !nationalStories.length);
}

function renderTraffic(items) {
  els.trafficList.replaceChildren();

  if (!items.length) {
    const quiet = document.createElement('article');
    quiet.className = 'traffic-item traffic-quiet';
    const marker = document.createElement('span');
    marker.className = 'road-marker';
    marker.textContent = 'Road desk';
    const title = document.createElement('h3');
    title.textContent = 'No active CHART disruptions reported near Pasadena right now.';
    const details = document.createElement('p');
    details.className = 'traffic-details';
    details.textContent = 'The road desk refreshes throughout the day from Maryland CHART.';
    const link = document.createElement('a');
    link.className = 'utility-link';
    link.href = 'https://chart.maryland.gov/Incidents/GetIncidents';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open Maryland CHART →';
    quiet.append(marker, title, details, link);
    els.trafficList.append(quiet);
    setHidden(els.roadSection, false);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'traffic-item';
    const marker = document.createElement('span');
    marker.className = item.traffic_alert ? 'road-marker alert' : 'road-marker';
    marker.textContent = item.traffic_alert ? 'Traffic alert' : (item.incident_type || 'Road update');
    const title = document.createElement('h3');
    title.textContent = item.description;
    const details = document.createElement('p');
    details.className = 'traffic-details';
    details.textContent = [item.direction, item.lanes_status, formatRoadTime(item.start_at)].filter(Boolean).join(' · ');
    const alertText = document.createElement('p');
    alertText.className = 'traffic-alert-text';
    alertText.textContent = item.traffic_alert_text || '';
    if (!item.traffic_alert_text) alertText.classList.add('hidden');
    const link = document.createElement('a');
    link.className = 'utility-link';
    link.href = item.source_url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open Maryland CHART →';
    card.append(marker, title, details, alertText, link);
    fragment.append(card);
  }
  els.trafficList.append(fragment);
  setHidden(els.roadSection, false);
}

function renderEvents(items) {
  els.eventGrid.replaceChildren();
  if (!items.length) {
    setHidden(els.eventsSection, true);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'event-card';
    const date = document.createElement('p');
    date.className = 'event-date';
    date.textContent = formatEventTime(item.starts_at, item.ends_at);
    const title = document.createElement('h3');
    title.textContent = item.title;
    const venue = document.createElement('p');
    venue.className = 'event-venue';
    venue.textContent = item.venue_name || 'Pasadena area';
    const link = document.createElement('a');
    link.className = 'utility-link';
    link.href = item.source_url || 'https://www.aacpl.net/events/list';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Event details →';
    card.append(date, title, venue, link);
    fragment.append(card);
  }
  els.eventGrid.append(fragment);
  setHidden(els.eventsSection, false);
}

function renderVoices(items) {
  els.voicesGrid.replaceChildren();
  if (!items.length) {
    setHidden(els.voicesSection, true);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'voice-card';
    const type = document.createElement('p');
    type.className = 'voice-type';
    type.textContent = labelSubmissionType(item.submission_type);
    const title = document.createElement('h3');
    title.textContent = item.headline;
    const byline = document.createElement('p');
    byline.className = 'voice-byline';
    byline.textContent = `By ${item.byline}`;
    const body = document.createElement('p');
    body.className = 'voice-body';
    body.textContent = item.body;
    const meta = document.createElement('p');
    meta.className = 'voice-meta';
    meta.textContent = [item.location_text, formatDate(item.published_at)].filter(Boolean).join(' · ');
    card.append(type, title, byline, body, meta);

    if (item.source_url) {
      const link = document.createElement('a');
      link.className = 'utility-link';
      link.href = item.source_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Supporting link →';
      card.append(link);
    }
    fragment.append(card);
  }

  els.voicesGrid.append(fragment);
  setHidden(els.voicesSection, false);
}

async function fetchStories() {
  return supabase
    .from('published_stories')
    .select('story_id,source_url,source_title,headline,summary,category,pasadena_relevance,urgency,location_text,source_published_at,approved_at,updated_at,content_scope,political_content,political_slant,political_slant_confidence,political_slant_reason')
    .order('approved_at', { ascending: false, nullsFirst: false })
    .limit(200);
}

async function fetchTraffic() {
  return supabase
    .from('traffic_events')
    .select('source_event_id,description,incident_type,direction,lanes_status,traffic_alert,traffic_alert_text,start_at,source_url,last_seen_at')
    .order('traffic_alert', { ascending: false })
    .order('start_at', { ascending: false, nullsFirst: false })
    .limit(8);
}

async function fetchEvents() {
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  return supabase
    .from('events')
    .select('id,title,venue_name,starts_at,ends_at,source_url,pasadena_relevance')
    .gte('starts_at', cutoff)
    .order('starts_at', { ascending: true })
    .limit(8);
}

async function fetchVoices() {
  return supabase
    .from('published_community_submissions')
    .select('submission_id,submission_type,byline,headline,body,location_text,source_url,published_at,updated_at')
    .order('published_at', { ascending: false })
    .limit(8);
}

async function loadCurrent() {
  els.editionDate.textContent = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date());

  const [storyResult, trafficResult, eventResult, voicesResult] = await Promise.all([
    fetchStories(),
    fetchTraffic(),
    fetchEvents(),
    fetchVoices(),
  ]);

  setHidden(els.loadingState, true);
  const errors = [];

  if (storyResult.error) {
    errors.push(`news: ${storyResult.error.message}`);
    els.storyCount.textContent = 'News unavailable';
    setHidden(els.storySection, true);
    setHidden(els.beyondSection, true);
  } else {
    const published = storyResult.data || [];
    allStories = published.filter((story) => (story.content_scope || 'local') === 'local')
      .sort((a, b) => Number(b.pasadena_relevance || 0) - Number(a.pasadena_relevance || 0) || Number(b.urgency || 0) - Number(a.urgency || 0));
    stateStories = published.filter((story) => story.content_scope === 'state');
    nationalStories = published.filter((story) => story.content_scope === 'national');
    stories = diversifyStories(allStories);
    els.storyCount.textContent = `${stories.length} ${stories.length === 1 ? 'local story' : 'local stories'} in today’s current`;

    if (stories.length) {
      renderFeatured(stories[0]);
      renderFilters();
      renderGrid();
      setHidden(els.storySection, false);
      setHidden(els.emptyState, true);
    } else {
      setHidden(els.storySection, true);
      setHidden(els.emptyState, false);
    }
    renderBeyond();
  }

  if (trafficResult.error) {
    errors.push(`roads: ${trafficResult.error.message}`);
    setHidden(els.roadSection, true);
  } else {
    renderTraffic(trafficResult.data || []);
  }

  if (eventResult.error) {
    errors.push(`events: ${eventResult.error.message}`);
    setHidden(els.eventsSection, true);
  } else {
    renderEvents(eventResult.data || []);
  }

  if (voicesResult.error) {
    errors.push(`community voices: ${voicesResult.error.message}`);
    setHidden(els.voicesSection, true);
  } else {
    renderVoices(voicesResult.data || []);
  }

  if (errors.length) {
    els.errorState.textContent = `Some parts of today’s current could not be loaded (${errors.join('; ')}).`;
    setHidden(els.errorState, false);
  }
}

loadCurrent();
