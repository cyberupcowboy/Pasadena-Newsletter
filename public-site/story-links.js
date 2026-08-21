import { supabase } from './lib/current.js';
import './local-eats-home.js';

let storiesBySource = new Map();
let observer = null;

function normalize(value) {
  try { return new URL(value, location.href).toString(); } catch { return String(value || ''); }
}

function addOriginalLink(link, originalUrl) {
  const parent = link.parentElement;
  if (!parent || parent.querySelector(':scope > .original-source-link')) return;
  const original = document.createElement('a');
  original.className = 'original-source-link';
  original.href = originalUrl;
  original.target = '_blank';
  original.rel = 'noopener noreferrer';
  original.textContent = 'Original source ↗';
  link.insertAdjacentElement('afterend', original);
}

function upgradeLink(link) {
  if (!link || link.dataset.currentBrief === 'true') return;
  const originalUrl = normalize(link.getAttribute('href'));
  const story = storiesBySource.get(originalUrl);
  if (!story) return;

  link.dataset.currentBrief = 'true';
  link.dataset.originalUrl = originalUrl;
  link.href = `./story/?id=${encodeURIComponent(story.story_id)}`;
  link.removeAttribute('target');
  link.removeAttribute('rel');
  link.textContent = 'Open Current brief →';
  addOriginalLink(link, originalUrl);
}

function upgradeAll() {
  document.querySelectorAll('#featuredStory .read-source, #storyGrid .read-source, .desk-story .utility-link').forEach(upgradeLink);
}

async function init() {
  const { data } = await supabase.from('published_stories').select('story_id,source_url').limit(250);
  storiesBySource = new Map((data || []).map((row) => [normalize(row.source_url), row]));
  upgradeAll();
  observer = new MutationObserver(upgradeAll);
  observer.observe(document.body, { childList: true, subtree: true });
}

init();
