import { supabase, formatDate, labelCategory } from '../lib/current.js';

const form = document.querySelector('#searchForm');
const input = document.querySelector('#searchQuery');
const state = document.querySelector('#searchState');
const results = document.querySelector('#searchResults');
const summary = document.querySelector('#searchSummary');

function hide(el, value) { el.classList.toggle('hidden', value); }

function hrefFor(result) {
  if (result.kind === 'story') return `../story/?id=${encodeURIComponent(result.item_id)}`;
  if (result.kind === 'event') return '../events/';
  if (result.kind === 'business') return '../directory/';
  if (result.kind === 'community') return '../#voicesSection';
  return result.source_url || '../';
}

async function search(query, pushState = true) {
  const q = query.trim();
  if (q.length < 2) return;
  input.value = q;
  state.textContent = 'Searching the public Current archive…';
  hide(state, false); hide(results, true); hide(summary, true);

  const { data, error } = await supabase.rpc('search_current', { search_text: q, result_limit: 40 });
  if (error) {
    state.textContent = `Search is temporarily unavailable: ${error.message}`;
    return;
  }

  if (pushState) history.replaceState({}, '', `?q=${encodeURIComponent(q)}`);
  const rows = data || [];
  if (!rows.length) {
    state.textContent = `The public archive did not find a match for “${q}.” That means the Current does not currently have enough sourced material to answer it responsibly.`;
    return;
  }

  summary.textContent = `Ask Pasadena beta found ${rows.length} source-linked match${rows.length === 1 ? '' : 'es'} for “${q}.” The results below are the evidence set—open the underlying Current brief, event, Community Voice or directory entry for context.`;
  hide(summary, false); hide(state, true); hide(results, false);
  results.replaceChildren();
  const fragment = document.createDocumentFragment();
  rows.forEach((item) => {
    const row = document.createElement('article'); row.className = 'list-item';
    const kind = document.createElement('span'); kind.className = 'item-label'; kind.textContent = item.kind;
    const copy = document.createElement('div');
    const h = document.createElement('h2'); h.textContent = item.title;
    const p = document.createElement('p'); p.textContent = String(item.summary || '').slice(0, 480);
    const meta = document.createElement('p'); meta.style.marginTop = '5px'; meta.textContent = [labelCategory(item.category),item.location_text,formatDate(item.occurred_at)].filter(Boolean).join(' · ');
    copy.append(h,p,meta);
    const link = document.createElement('a'); link.href = hrefFor(item); link.textContent = 'Open →';
    row.append(kind,copy,link); fragment.append(row);
  });
  results.append(fragment);
}

form.addEventListener('submit', (event) => { event.preventDefault(); search(input.value); });
const initial = new URLSearchParams(location.search).get('q');
if (initial) search(initial, false);
