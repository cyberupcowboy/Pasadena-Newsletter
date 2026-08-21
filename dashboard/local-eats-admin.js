import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm';

const SUPABASE_URL = 'https://eedpedkvymohcubdaoey.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_6RReetP9MPYS_xn0k6xzrw_AVBbgBRs';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

function ensureCss() {
  if (document.querySelector('link[data-local-eats-admin]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './local-eats-admin.css';
  link.dataset.localEatsAdmin = 'true';
  document.head.append(link);
}

function ensureSection() {
  let section = document.querySelector('#localEatsAdminSection');
  if (section) return section;
  section = document.createElement('section');
  section.id = 'localEatsAdminSection';
  section.className = 'local-eats-admin';
  const community = document.querySelector('#communityReviewSection');
  section.innerHTML = `
    <div class="local-eats-admin-head">
      <div><p class="eyebrow">Local Eats desk</p><h2>Restaurant picks</h2><p>Control Hot right now and Local favorites from the same business-directory records.</p></div>
      <a class="button ghost" href="../eats/" target="_blank" rel="noopener noreferrer">View Local Eats ↗</a>
    </div>
    <div id="localEatsAdminList" class="local-eats-admin-list"></div>
    <p id="localEatsAdminState" class="local-eats-admin-state"></p>`;
  if (community) community.after(section); else document.querySelector('#dashboard')?.append(section);
  return section;
}

function option(value, label, selected) {
  const el = document.createElement('option'); el.value = value; el.textContent = label; el.selected = value === selected; return el;
}

function cardFor(row) {
  const card = document.createElement('article');
  card.className = 'local-eats-admin-card';
  card.dataset.businessId = row.id;

  const name = document.createElement('div'); name.className = 'local-eats-admin-name';
  const strong = document.createElement('strong'); strong.textContent = row.name;
  const sub = document.createElement('span'); sub.textContent = [row.cuisine || row.category, row.address].filter(Boolean).join(' · ');
  name.append(strong, sub);

  const statusLabel = document.createElement('label'); statusLabel.textContent = 'Local Eats status';
  const status = document.createElement('select'); status.className = 'eats-admin-status';
  status.append(option('none','Not featured',row.eats_status), option('hot','Hot right now',row.eats_status), option('favorite','Local favorite',row.eats_status), option('both','Both',row.eats_status));
  statusLabel.append(status);

  const rankLabel = document.createElement('label'); rankLabel.textContent = 'Order';
  const rank = document.createElement('input'); rank.className = 'eats-admin-rank'; rank.type = 'number'; rank.min = '1'; rank.max = '1000'; rank.value = row.eats_rank ?? '';
  rankLabel.append(rank);

  const priceLabel = document.createElement('label'); priceLabel.textContent = 'Price';
  const price = document.createElement('select'); price.className = 'eats-admin-price';
  price.append(option('','—',row.price_level || ''), option('$','$',row.price_level), option('$$','$$',row.price_level), option('$$$','$$$',row.price_level), option('$$$$','$$$$',row.price_level));
  priceLabel.append(price);

  const blurbLabel = document.createElement('label'); blurbLabel.textContent = 'Why it’s here';
  const blurb = document.createElement('textarea'); blurb.className = 'eats-admin-blurb'; blurb.value = row.eats_blurb || ''; blurb.maxLength = 1200;
  blurbLabel.append(blurb);

  const signatureLabel = document.createElement('label'); signatureLabel.textContent = 'What to try';
  const signature = document.createElement('input'); signature.className = 'eats-admin-signature'; signature.type = 'text'; signature.maxLength = 240; signature.value = row.signature_item || '';
  signatureLabel.append(signature);

  const save = document.createElement('button'); save.className = 'button primary local-eats-admin-save'; save.type = 'button'; save.textContent = 'Save pick';
  save.addEventListener('click', async () => {
    save.disabled = true; save.textContent = 'Saving…';
    const patch = {
      eats_status: status.value,
      eats_rank: rank.value ? Number(rank.value) : null,
      eats_blurb: blurb.value.trim() || null,
      signature_item: signature.value.trim() || null,
      price_level: price.value || null,
      local_eats_updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('businesses').update(patch).eq('id', row.id);
    save.textContent = error ? 'Save failed' : 'Saved';
    save.dataset.kind = error ? 'error' : 'success';
    setTimeout(() => { save.disabled = false; save.textContent = 'Save pick'; }, 1600);
  });

  card.append(name, statusLabel, rankLabel, priceLabel, blurbLabel, signatureLabel, save);
  return card;
}

async function load() {
  ensureCss();
  const section = ensureSection();
  if (!section) return;
  const list = section.querySelector('#localEatsAdminList');
  const state = section.querySelector('#localEatsAdminState');
  state.textContent = 'Loading restaurant directory…';
  const { data, error } = await supabase.from('businesses')
    .select('id,name,category,cuisine,address,editorial_status,eats_status,eats_rank,eats_blurb,signature_item,price_level')
    .eq('editorial_status','approved')
    .order('name',{ ascending:true })
    .limit(500);
  if (error) { state.textContent = `Could not load Local Eats desk: ${error.message}`; return; }
  const rows = data || [];
  list.replaceChildren(...rows.map(cardFor));
  state.textContent = rows.length ? `${rows.length} approved directory listing${rows.length === 1 ? '' : 's'} available for Local Eats.` : 'No approved businesses are in the directory yet.';
}

async function init() {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) await load();
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) load();
  else document.querySelector('#localEatsAdminSection')?.remove();
});

init();
