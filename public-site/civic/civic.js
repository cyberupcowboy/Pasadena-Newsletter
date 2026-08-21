import { supabase, formatDate, formatDateTime, labelCategory } from '../lib/current.js';

const storyList = document.querySelector('#civicStories');
const storyState = document.querySelector('#civicStoryState');
const eventList = document.querySelector('#civicEvents');
const eventState = document.querySelector('#civicEventState');

function hide(el, value) { el.classList.toggle('hidden', value); }

async function loadStories() {
  const { data, error } = await supabase.from('published_stories')
    .select('story_id,headline,summary,category,location_text,source_published_at,approved_at,content_scope')
    .in('category', ['government','courts','schools','education','development','public_policy'])
    .order('approved_at', { ascending: false, nullsFirst: false })
    .limit(30);
  if (error) { storyState.textContent = `Could not load civic coverage: ${error.message}`; return; }
  const stories = data || [];
  if (!stories.length) { storyState.textContent = 'No civic stories have cleared the desk yet.'; return; }

  const ids = stories.map((s) => s.story_id);
  const { data: transparencyRows } = await supabase.from('story_transparency').select('story_id,why_it_matters').in('story_id', ids);
  const why = new Map((transparencyRows || []).map((row) => [row.story_id, row.why_it_matters]));

  storyList.replaceChildren();
  const fragment = document.createDocumentFragment();
  stories.slice(0, 15).forEach((story) => {
    const row = document.createElement('article'); row.className = 'list-item';
    const when = document.createElement('time'); when.textContent = formatDate(story.source_published_at || story.approved_at);
    const copy = document.createElement('div');
    const title = document.createElement('h3'); title.textContent = story.headline;
    const summary = document.createElement('p'); summary.textContent = why.get(story.story_id) || story.summary || '';
    const meta = document.createElement('p'); meta.style.marginTop = '5px'; meta.textContent = [labelCategory(story.category), story.location_text, story.content_scope === 'state' ? 'Maryland' : 'Local'].filter(Boolean).join(' · ');
    copy.append(title, summary, meta);
    const link = document.createElement('a'); link.href = `../story/?id=${encodeURIComponent(story.story_id)}`; link.textContent = 'Current brief →';
    row.append(when, copy, link); fragment.append(row);
  });
  storyList.append(fragment); hide(storyState, true);
}

async function loadEvents() {
  const horizon = new Date(); horizon.setDate(horizon.getDate() + 90);
  const { data, error } = await supabase.from('events')
    .select('id,title,description,venue_name,starts_at,source_url,category')
    .gte('starts_at', new Date().toISOString())
    .lt('starts_at', horizon.toISOString())
    .order('starts_at', { ascending: true })
    .limit(150);
  if (error) { eventState.textContent = `Could not load meetings: ${error.message}`; return; }
  const civicPattern = /council|board|hearing|planning|zoning|commission|committee|public meeting|town hall|government/i;
  const events = (data || []).filter((item) => civicPattern.test([item.title,item.description,item.venue_name,item.category].filter(Boolean).join(' '))).slice(0, 12);
  if (!events.length) { eventState.textContent = 'No public meetings are currently in the local event feed. Use the official links above for the authoritative calendars.'; return; }

  eventList.replaceChildren();
  const fragment = document.createDocumentFragment();
  events.forEach((event) => {
    const row = document.createElement('article'); row.className = 'list-item';
    const when = document.createElement('time'); when.textContent = formatDateTime(event.starts_at);
    const copy = document.createElement('div');
    const title = document.createElement('h3'); title.textContent = event.title;
    const meta = document.createElement('p'); meta.textContent = [event.venue_name,labelCategory(event.category)].filter(Boolean).join(' · ');
    copy.append(title, meta);
    const link = document.createElement('a'); link.href = event.source_url || '../events/'; if (event.source_url) { link.target = '_blank'; link.rel = 'noopener noreferrer'; } link.textContent = event.source_url ? 'Official details ↗' : 'Calendar →';
    row.append(when, copy, link); fragment.append(row);
  });
  eventList.append(fragment); hide(eventState, true);
}

loadStories();
loadEvents();
