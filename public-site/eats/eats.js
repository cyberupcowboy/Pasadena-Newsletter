import { supabase, safeHttpUrl } from '../lib/current.js';

const search = document.querySelector('#eatsSearch');
const cuisineFilter = document.querySelector('#cuisineFilter');
const state = document.querySelector('#eatsState');
const hotSection = document.querySelector('#hot');
const favoriteSection = document.querySelector('#favorites');
const hotGrid = document.querySelector('#hotGrid');
const favoriteGrid = document.querySelector('#favoriteGrid');
let restaurants = [];

function setHidden(el, hidden) { el.classList.toggle('hidden', hidden); }

function statusIncludes(status, kind) {
  return status === kind || status === 'both';
}

function textMatch(item, q) {
  if (!q) return true;
  return [item.name,item.cuisine,item.address,item.description,item.eats_blurb,item.signature_item,item.specials]
    .filter(Boolean).join(' ').toLowerCase().includes(q);
}

function renderCuisineOptions() {
  const selected = cuisineFilter.value;
  const cuisines = [...new Set(restaurants.map((r) => r.cuisine).filter(Boolean))].sort();
  cuisineFilter.replaceChildren();
  const all = document.createElement('option'); all.value = 'all'; all.textContent = 'All cuisines'; cuisineFilter.append(all);
  cuisines.forEach((value) => {
    const option = document.createElement('option'); option.value = value; option.textContent = value; cuisineFilter.append(option);
  });
  cuisineFilter.value = cuisines.includes(selected) ? selected : 'all';
}

function restaurantCard(item, kind) {
  const card = document.createElement('article');
  card.className = 'eats-card';
  card.dataset.kind = kind;

  const topline = document.createElement('div'); topline.className = 'eats-topline';
  const badges = document.createElement('div'); badges.className = 'eats-badges';
  const badge = document.createElement('span'); badge.className = `eats-badge ${kind === 'hot' ? 'hot' : ''}`;
  badge.textContent = kind === 'hot' ? 'Hot right now' : 'Local favorite';
  badges.append(badge);
  if (item.sponsor_status && item.sponsor_status !== 'none') {
    const sponsored = document.createElement('span'); sponsored.className = 'eats-badge'; sponsored.textContent = 'Sponsored directory listing'; badges.append(sponsored);
  }
  const price = document.createElement('span'); price.className = 'eats-price'; price.textContent = item.price_level || '';
  topline.append(badges, price);

  const title = document.createElement('h3'); title.textContent = item.name;
  const cuisine = document.createElement('p'); cuisine.className = 'eats-cuisine'; cuisine.textContent = item.cuisine || 'Restaurant';
  const blurb = document.createElement('p'); blurb.className = 'eats-blurb'; blurb.textContent = item.eats_blurb || item.description || 'A Pasadena-area restaurant worth knowing.';

  const details = document.createElement('div'); details.className = 'eats-details';
  if (item.signature_item) {
    const row = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = 'Try: ';
    row.append(strong, document.createTextNode(item.signature_item)); details.append(row);
  }
  if (item.address) {
    const row = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = 'Find it: ';
    row.append(strong, document.createTextNode(item.address)); details.append(row);
  }
  if (item.hours_text) {
    const row = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = 'Hours: ';
    row.append(strong, document.createTextNode(item.hours_text)); details.append(row);
  }
  if (item.specials) {
    const row = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = 'Special: ';
    row.append(strong, document.createTextNode(item.specials)); details.append(row);
  }

  const links = document.createElement('div'); links.className = 'eats-links';
  const website = safeHttpUrl(item.website);
  if (website) {
    const a = document.createElement('a'); a.href = website; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Restaurant website ↗'; links.append(a);
  }
  if (item.phone) {
    const tel = document.createElement('a'); tel.href = `tel:${item.phone.replace(/[^0-9+]/g, '')}`; tel.textContent = item.phone; links.append(tel);
  }

  card.append(topline, title, cuisine, blurb);
  if (details.childNodes.length) card.append(details);
  if (links.childNodes.length) card.append(links);
  return card;
}

function renderGrid(grid, items, kind) {
  grid.replaceChildren();
  const fragment = document.createDocumentFragment();
  items.forEach((item) => fragment.append(restaurantCard(item, kind)));
  grid.append(fragment);
}

function render() {
  const q = search.value.trim().toLowerCase();
  const cuisine = cuisineFilter.value;
  const filtered = restaurants.filter((item) =>
    (cuisine === 'all' || item.cuisine === cuisine) && textMatch(item, q)
  );
  const hot = filtered.filter((item) => statusIncludes(item.eats_status, 'hot')).sort((a,b) => (a.eats_rank ?? 999) - (b.eats_rank ?? 999));
  const favorites = filtered.filter((item) => statusIncludes(item.eats_status, 'favorite')).sort((a,b) => (a.eats_rank ?? 999) - (b.eats_rank ?? 999));

  renderGrid(hotGrid, hot, 'hot');
  renderGrid(favoriteGrid, favorites, 'favorite');
  setHidden(hotSection, !hot.length);
  setHidden(favoriteSection, !favorites.length);

  if (!restaurants.length) {
    state.textContent = 'The Local Eats desk is ready, but no restaurants have been selected yet.';
    setHidden(state, false);
  } else if (!hot.length && !favorites.length) {
    state.textContent = 'No Local Eats picks match those filters.';
    setHidden(state, false);
  } else {
    setHidden(state, true);
  }
}

async function load() {
  const { data, error } = await supabase.from('businesses')
    .select('id,name,category,cuisine,address,website,phone,sponsor_status,description,hours_text,specials,eats_status,eats_rank,eats_blurb,signature_item,price_level,local_eats_updated_at')
    .neq('eats_status', 'none')
    .order('eats_rank', { ascending: true, nullsFirst: false })
    .limit(100);
  if (error) {
    state.textContent = `Could not load Local Eats: ${error.message}`;
    return;
  }
  restaurants = data || [];
  renderCuisineOptions();
  render();
}

search.addEventListener('input', render);
cuisineFilter.addEventListener('change', render);
load();
