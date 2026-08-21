import { supabase, labelCategory, safeHttpUrl } from '../lib/current.js';

const search = document.querySelector('#businessSearch');
const category = document.querySelector('#businessCategory');
const state = document.querySelector('#businessState');
const grid = document.querySelector('#businessGrid');
let businesses = [];

function setHidden(el, hidden) { el.classList.toggle('hidden', hidden); }

function renderCategoryOptions() {
  const selected = category.value;
  const categories = [...new Set(businesses.map((b) => b.category).filter(Boolean))].sort();
  category.replaceChildren();
  const all = document.createElement('option'); all.value = 'all'; all.textContent = 'All categories'; category.append(all);
  categories.forEach((value) => {
    const option = document.createElement('option'); option.value = value; option.textContent = labelCategory(value); category.append(option);
  });
  category.value = categories.includes(selected) ? selected : 'all';
}

function eatsLabel(status) {
  return ({ hot: 'Local Eats · Hot right now', favorite: 'Local Eats · Local favorite', both: 'Local Eats pick' })[status] || null;
}

function render() {
  const q = search.value.trim().toLowerCase();
  const selectedCategory = category.value;
  const filtered = businesses.filter((business) => {
    const haystack = [business.name,business.category,business.cuisine,business.address,business.description,business.specials,business.signature_item].filter(Boolean).join(' ').toLowerCase();
    return (selectedCategory === 'all' || business.category === selectedCategory) && (!q || haystack.includes(q));
  });
  grid.replaceChildren();
  if (!filtered.length) {
    state.textContent = businesses.length ? 'No listings match those filters.' : 'The directory is ready for listings, but no businesses have cleared the editor yet. Local owners can submit a listing now.';
    setHidden(state, false); setHidden(grid, true); return;
  }
  setHidden(state, true); setHidden(grid, false);
  const fragment = document.createDocumentFragment();
  filtered.forEach((business) => {
    const card = document.createElement('article'); card.className = 'info-card';
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = [business.cuisine || labelCategory(business.category), eatsLabel(business.eats_status), business.verified ? 'Verified owner' : null, business.sponsor_status && business.sponsor_status !== 'none' ? 'Sponsored' : null].filter(Boolean).join(' · ');
    const title = document.createElement('h2'); title.textContent = business.name;
    const desc = document.createElement('p'); desc.textContent = business.description || 'Local directory listing.';
    const details = document.createElement('p'); details.style.marginTop = '8px'; details.textContent = [business.address,business.hours_text,business.phone].filter(Boolean).join(' · ');
    const links = document.createElement('div'); links.className = 'card-links';
    const website = safeHttpUrl(business.website);
    if (website) { const a = document.createElement('a'); a.href = website; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Website ↗'; links.append(a); }
    if (business.signature_item) { const s = document.createElement('span'); s.textContent = `Try: ${business.signature_item}`; links.append(s); }
    if (business.specials) { const s = document.createElement('span'); s.textContent = `Special: ${business.specials}`; links.append(s); }
    if (business.eats_status && business.eats_status !== 'none') { const a = document.createElement('a'); a.href = '../eats/'; a.textContent = 'Local Eats guide →'; links.append(a); }
    card.append(meta,title,desc); if (details.textContent) card.append(details); if (links.childNodes.length) card.append(links); fragment.append(card);
  });
  grid.append(fragment);
}

async function load() {
  const { data, error } = await supabase.from('businesses')
    .select('id,name,category,cuisine,address,website,phone,verified,sponsor_status,description,hours_text,photo_url,specials,eats_status,eats_blurb,signature_item,price_level,updated_at')
    .order('name', { ascending: true })
    .limit(500);
  if (error) { state.textContent = `Could not load the directory: ${error.message}`; return; }
  businesses = data || [];
  renderCategoryOptions(); render();
}

search.addEventListener('input', render);
category.addEventListener('change', render);
load();
