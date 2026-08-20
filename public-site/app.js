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
  content: document.querySelector('#content'),
  featuredStory: document.querySelector('#featuredStory'),
  storyGrid: document.querySelector('#storyGrid'),
  categoryFilters: document.querySelector('#categoryFilters'),
  storyTemplate: document.querySelector('#storyTemplate'),
};

let stories = [];
let activeCategory = 'all';

function setHidden(element, hidden) {
  element.classList.toggle('hidden', hidden);
}

function labelCategory(value) {
  if (!value) return 'Community';
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function storyMeta(story) {
  return [story.location_text, formatDate(story.source_published_at || story.approved_at)].filter(Boolean).join(' · ');
}

function renderFeatured(story) {
  els.featuredStory.replaceChildren();
  const top = document.createElement('div');
  top.className = 'card-topline';

  const category = document.createElement('span');
  category.className = 'category';
  category.textContent = labelCategory(story.category);

  const score = document.createElement('span');
  score.className = 'local-score';
  score.textContent = `Local relevance ${story.pasadena_relevance ?? 0}/100`;

  top.append(category, score);

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
  card.querySelector('.local-score').textContent = `${story.pasadena_relevance ?? 0} local`;
  card.querySelector('h3').textContent = story.headline;
  card.querySelector('.summary').textContent = story.summary || '';
  card.querySelector('.story-meta').textContent = storyMeta(story);
  const link = card.querySelector('.read-source');
  link.href = story.source_url;
  return card;
}

function renderFilters() {
  const categories = [...new Set(stories.map((story) => story.category).filter(Boolean))].sort();
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
  const filtered = stories.filter((story) => activeCategory === 'all' || story.category === activeCategory);
  const fragment = document.createDocumentFragment();
  filtered.forEach((story) => fragment.append(renderCard(story)));
  els.storyGrid.append(fragment);
}

async function loadStories() {
  els.editionDate.textContent = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date());

  const { data, error } = await supabase
    .from('published_stories')
    .select('story_id,source_url,source_title,headline,summary,category,pasadena_relevance,urgency,location_text,source_published_at,approved_at,updated_at')
    .order('pasadena_relevance', { ascending: false, nullsFirst: false })
    .order('urgency', { ascending: false, nullsFirst: false })
    .order('approved_at', { ascending: false, nullsFirst: false })
    .limit(100);

  setHidden(els.loadingState, true);

  if (error) {
    els.errorState.textContent = `The local brief could not be loaded: ${error.message}`;
    setHidden(els.errorState, false);
    els.storyCount.textContent = 'Unavailable';
    return;
  }

  stories = data || [];
  els.storyCount.textContent = `${stories.length} approved ${stories.length === 1 ? 'story' : 'stories'}`;

  if (!stories.length) {
    setHidden(els.emptyState, false);
    return;
  }

  renderFeatured(stories[0]);
  renderFilters();
  renderGrid();
  setHidden(els.content, false);
}

loadStories();
