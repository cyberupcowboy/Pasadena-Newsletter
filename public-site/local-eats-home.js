import { supabase } from './lib/current.js';

function ensureStylesheet() {
  if (document.querySelector('link[data-local-eats-home]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './local-eats-home.css';
  link.dataset.localEatsHome = 'true';
  document.head.append(link);
}

function addNavLinks() {
  const nav = document.querySelector('.primary-nav .wrap');
  if (nav && !nav.querySelector('a[href="./eats/"]')) {
    const link = document.createElement('a');
    link.href = './eats/';
    link.textContent = 'Local Eats';
    const directory = nav.querySelector('a[href="./directory/"]');
    nav.insertBefore(link, directory || nav.querySelector('.nav-submit'));
  }

  const jumps = document.querySelector('.section-jump');
  if (jumps && !jumps.querySelector('a[href="./eats/"]')) {
    const link = document.createElement('a');
    link.href = './eats/';
    link.textContent = 'Food & drink';
    const business = jumps.querySelector('a[href="./directory/"]');
    if (business) business.after(link); else jumps.append(link);
  }

  const explore = document.querySelector('.explore-grid');
  if (explore && !explore.querySelector('a[href="./eats/"]')) {
    const link = document.createElement('a');
    link.className = 'explore-card';
    link.href = './eats/';
    const kicker = document.createElement('span'); kicker.textContent = 'Food & drink';
    const title = document.createElement('h3'); title.textContent = 'Local Eats';
    const copy = document.createElement('p'); copy.textContent = 'See what’s hot right now, rediscover Pasadena favorites and nominate the spots locals should know.';
    link.append(kicker, title, copy);
    const directory = explore.querySelector('a[href="./directory/"]');
    if (directory) directory.after(link); else explore.append(link);
  }
}

function labelFor(item) {
  if (item.eats_status === 'hot') return 'Hot right now';
  if (item.eats_status === 'favorite') return 'Local favorite';
  return Number(item.eats_rank ?? 999) <= 20 ? 'Hot right now' : 'Local favorite';
}

function createModule(items) {
  if (!items.length || document.querySelector('.home-eats-section')) return;
  const section = document.createElement('section');
  section.className = 'home-eats-section';
  const heading = document.createElement('div'); heading.className = 'home-eats-heading';
  const copy = document.createElement('div');
  const eyebrow = document.createElement('p'); eyebrow.textContent = 'Local Eats';
  const title = document.createElement('h2'); title.textContent = 'Where Pasadena is eating now';
  copy.append(eyebrow, title);
  const more = document.createElement('a'); more.href = './eats/'; more.textContent = 'Open the full food guide →';
  heading.append(copy, more);

  const grid = document.createElement('div'); grid.className = 'home-eats-grid';
  items.slice(0, 4).forEach((item) => {
    const card = document.createElement('a'); card.className = 'home-eats-card'; card.href = './eats/';
    const label = document.createElement('span'); label.textContent = labelFor(item);
    const name = document.createElement('h3'); name.textContent = item.name;
    const desc = document.createElement('p'); desc.textContent = item.eats_blurb || item.description || item.cuisine || 'Pasadena restaurant';
    const detail = document.createElement('small'); detail.textContent = [item.cuisine, item.signature_item ? `Try: ${item.signature_item}` : null].filter(Boolean).join(' · ');
    card.append(label, name, desc, detail); grid.append(card);
  });
  section.append(heading, grid);

  const events = document.querySelector('#eventsSection');
  const beyond = document.querySelector('#beyondSection');
  if (events) events.after(section);
  else if (beyond) beyond.before(section);
  else document.querySelector('main')?.append(section);
}

async function loadLocalEats() {
  ensureStylesheet();
  addNavLinks();
  const { data } = await supabase.from('businesses')
    .select('name,cuisine,eats_status,eats_rank,eats_blurb,description,signature_item')
    .neq('eats_status', 'none')
    .order('eats_rank', { ascending: true, nullsFirst: false })
    .limit(12);
  const rows = data || [];
  const hot = rows.filter((item) => ['hot','both'].includes(item.eats_status)).slice(0, 2);
  const favorites = rows.filter((item) => ['favorite','both'].includes(item.eats_status)).slice(0, 2);
  createModule([...hot, ...favorites]);
}

loadLocalEats();
