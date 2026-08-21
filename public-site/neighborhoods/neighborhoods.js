import { supabase, formatDate, labelCategory } from '../lib/current.js';

const params = new URLSearchParams(location.search);
const picker = document.querySelector('#neighborhoodPicker');
const title = document.querySelector('#neighborhoodTitle');
const description = document.querySelector('#neighborhoodDescription');
const feed = document.querySelector('#neighborhoodFeed');
const state = document.querySelector('#neighborhoodState');
let neighborhoods = [];

function norm(value) { return String(value || '').toLowerCase(); }
function hide(el, value) { el.classList.toggle('hidden', value); }

function selectedNeighborhood() {
  const requested = params.get('n');
  return neighborhoods.find((n) => n.slug === requested) || neighborhoods[0];
}

function renderPicker() {
  picker.replaceChildren();
  neighborhoods.forEach((n) => {
    const a = document.createElement('a');
    a.className = 'action-button';
    a.href = `./?n=${encodeURIComponent(n.slug)}`;
    a.textContent = n.name;
    if (selectedNeighborhood()?.slug === n.slug) a.style.background = '#9a4d31';
    picker.append(a);
  });
}

function matchesNeighborhood(item, n) {
  if (!n) return true;
  if (n.slug === 'pasadena') return true;
  const haystack = norm([item.location_text, item.neighborhood, item.title, item.summary].filter(Boolean).join(' '));
  return haystack.includes(norm(n.name));
}

async function loadFeed(n) {
  const [storyResult, voiceResult] = await Promise.all([
    supabase.from('published_stories')
      .select('story_id,headline,summary,category,location_text,source_published_at,approved_at')
      .eq('content_scope', 'local')
      .order('approved_at', { ascending: false, nullsFirst: false })
      .limit(120),
    supabase.from('published_community_submissions')
      .select('submission_id,headline,body,submission_type,location_text,published_at')
      .order('published_at', { ascending: false })
      .limit(80),
  ]);
  const storyIds = (storyResult.data || []).map((x) => x.story_id);
  const { data: metaRows } = storyIds.length
    ? await supabase.from('story_transparency').select('story_id,neighborhood').in('story_id', storyIds)
    : { data: [] };
  const meta = new Map((metaRows || []).map((row) => [row.story_id, row.neighborhood]));

  const items = [
    ...(storyResult.data || []).map((x) => ({
      kind: 'Current brief', id: x.story_id, title: x.headline, summary: x.summary, category: x.category,
      location_text: x.location_text, neighborhood: meta.get(x.story_id), when: x.source_published_at || x.approved_at,
      href: `../story/?id=${encodeURIComponent(x.story_id)}`,
    })),
    ...(voiceResult.data || []).map((x) => ({
      kind: 'Community Voice', id: x.submission_id, title: x.headline, summary: x.body,
      category: x.submission_type, location_text: x.location_text, when: x.published_at, href: '../#voicesSection',
    })),
  ].filter((item) => matchesNeighborhood(item, n))
    .sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0))
    .slice(0, 40);

  feed.replaceChildren();
  if (!items.length) {
    state.textContent = `No ${n.name}-specific items have been tagged yet. The page will fill in as reporting and Community Voices grow.`;
    hide(state, false); return;
  }
  hide(state, true);
  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const row = document.createElement('article'); row.className = 'list-item';
    const when = document.createElement('time'); when.textContent = formatDate(item.when);
    const copy = document.createElement('div');
    const h = document.createElement('h3'); h.textContent = item.title;
    const p = document.createElement('p'); p.textContent = String(item.summary || '').slice(0, 380);
    const metaLine = document.createElement('p'); metaLine.style.marginTop = '5px'; metaLine.textContent = [item.kind,labelCategory(item.category),item.location_text].filter(Boolean).join(' · ');
    copy.append(h,p,metaLine);
    const link = document.createElement('a'); link.href = item.href; link.textContent = 'Open →';
    row.append(when,copy,link); fragment.append(row);
  });
  feed.append(fragment);
}

async function load() {
  const { data, error } = await supabase.from('neighborhoods').select('slug,name,description,sort_order').order('sort_order');
  if (error || !data?.length) { state.textContent = 'Neighborhood pages are temporarily unavailable.'; return; }
  neighborhoods = data;
  const n = selectedNeighborhood();
  title.textContent = n.name;
  description.textContent = n.description || `News and community updates for ${n.name}.`;
  document.title = `${n.name} — The Pasadena Current`;
  renderPicker();
  await loadFeed(n);
}
load();
