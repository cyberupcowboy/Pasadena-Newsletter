import { supabase, formatDateTime, labelCategory } from '../lib/current.js';

const searchInput = document.querySelector('#eventSearch');
const windowSelect = document.querySelector('#eventWindow');
const categorySelect = document.querySelector('#eventCategory');
const state = document.querySelector('#eventState');
const results = document.querySelector('#eventResults');
let events = [];

function setHidden(el, hidden) { el.classList.toggle('hidden', hidden); }

function dateBounds(windowValue) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  let end = new Date(start);

  if (windowValue === 'today') {
    end.setDate(end.getDate() + 1);
  } else if (windowValue === 'weekend') {
    const day = start.getDay();
    const daysToSaturday = (6 - day + 7) % 7;
    start.setDate(start.getDate() + daysToSaturday);
    end = new Date(start);
    end.setDate(end.getDate() + 2);
  } else {
    end.setDate(end.getDate() + Number(windowValue || 30));
  }
  return { start, end };
}

function renderCategories() {
  const selected = categorySelect.value;
  const categories = [...new Set(events.map((event) => event.category).filter(Boolean))].sort();
  categorySelect.replaceChildren();
  const all = document.createElement('option'); all.value = 'all'; all.textContent = 'All categories'; categorySelect.append(all);
  categories.forEach((category) => {
    const option = document.createElement('option'); option.value = category; option.textContent = labelCategory(category); categorySelect.append(option);
  });
  categorySelect.value = categories.includes(selected) ? selected : 'all';
}

function render() {
  const { start, end } = dateBounds(windowSelect.value);
  const query = searchInput.value.trim().toLowerCase();
  const category = categorySelect.value;
  const filtered = events.filter((event) => {
    const begins = new Date(event.starts_at);
    const inWindow = begins >= start && begins < end;
    const categoryMatch = category === 'all' || event.category === category;
    const haystack = [event.title, event.description, event.venue_name, event.address, event.category].filter(Boolean).join(' ').toLowerCase();
    return inWindow && categoryMatch && (!query || haystack.includes(query));
  });

  results.replaceChildren();
  if (!filtered.length) {
    state.textContent = 'No events match those filters yet. Try a wider date range or submit something Pasadena should know about.';
    setHidden(state, false); setHidden(results, true); return;
  }

  setHidden(state, true); setHidden(results, false);
  const fragment = document.createDocumentFragment();
  filtered.forEach((event) => {
    const row = document.createElement('article'); row.className = 'list-item';
    const when = document.createElement('time'); when.dateTime = event.starts_at; when.textContent = formatDateTime(event.starts_at);
    const copy = document.createElement('div');
    const title = document.createElement('h2'); title.textContent = event.title;
    const meta = document.createElement('p'); meta.textContent = [event.venue_name, event.address, labelCategory(event.category)].filter(Boolean).join(' · ');
    const desc = document.createElement('p'); desc.textContent = event.description || '';
    copy.append(title, meta); if (event.description) copy.append(desc);
    const link = document.createElement('a');
    link.href = event.source_url || '../submit/';
    if (event.source_url) { link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Event details ↗'; }
    else link.textContent = 'Community listing';
    row.append(when, copy, link); fragment.append(row);
  });
  results.append(fragment);
}

async function load() {
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const horizon = new Date(); horizon.setDate(horizon.getDate() + 90);
  const { data, error } = await supabase.from('events')
    .select('id,title,description,venue_name,address,starts_at,ends_at,source_url,category,pasadena_relevance,origin_submission_id')
    .gte('starts_at', cutoff)
    .lt('starts_at', horizon.toISOString())
    .order('starts_at', { ascending: true })
    .limit(300);
  if (error) { state.textContent = `Could not load the calendar: ${error.message}`; return; }
  events = data || [];
  renderCategories(); render();
}

[searchInput, windowSelect, categorySelect].forEach((el) => el.addEventListener(el === searchInput ? 'input' : 'change', render));
load();
