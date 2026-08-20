import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm';

const SUPABASE_URL = 'https://eedpedkvymohcubdaoey.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_6RReetP9MPYS_xn0k6xzrw_AVBbgBRs';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const els = {
  loginPanel: document.querySelector('#loginPanel'),
  loginForm: document.querySelector('#loginForm'),
  emailInput: document.querySelector('#emailInput'),
  passwordInput: document.querySelector('#passwordInput'),
  loginMessage: document.querySelector('#loginMessage'),
  dashboard: document.querySelector('#dashboard'),
  sessionEmail: document.querySelector('#sessionEmail'),
  signOutButton: document.querySelector('#signOutButton'),
  reviewCount: document.querySelector('#reviewCount'),
  newCount: document.querySelector('#newCount'),
  approvedCount: document.querySelector('#approvedCount'),
  rejectedCount: document.querySelector('#rejectedCount'),
  statusFilter: document.querySelector('#statusFilter'),
  categoryFilter: document.querySelector('#categoryFilter'),
  searchInput: document.querySelector('#searchInput'),
  refreshButton: document.querySelector('#refreshButton'),
  generateEditionButton: document.querySelector('#generateEditionButton'),
  editionPanel: document.querySelector('#editionPanel'),
  closeEditionButton: document.querySelector('#closeEditionButton'),
  newsletterDraft: document.querySelector('#newsletterDraft'),
  facebookDraft: document.querySelector('#facebookDraft'),
  copyNewsletterButton: document.querySelector('#copyNewsletterButton'),
  copyFacebookButton: document.querySelector('#copyFacebookButton'),
  editionMessage: document.querySelector('#editionMessage'),
  queueNotice: document.querySelector('#queueNotice'),
  storyList: document.querySelector('#storyList'),
  storyCardTemplate: document.querySelector('#storyCardTemplate'),
};

let stories = [];
let currentSession = null;

function setHidden(element, hidden) { element.classList.toggle('hidden', hidden); }
function setNotice(message = '', kind = 'info') {
  els.queueNotice.textContent = message;
  els.queueNotice.dataset.kind = kind;
  setHidden(els.queueNotice, !message);
}
function statusLabel(status) {
  return ({ new: 'New', review: 'Needs review', approved: 'Approved', rejected: 'Rejected', published: 'Published', archived: 'Archived' })[status] || status || 'Unknown';
}
function formatDate(value) {
  if (!value) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function clampScore(value) {
  const n = Number(value ?? 0);
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}
function categoryLabel(value) {
  return (value || 'community').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function updateStats() {
  const counts = stories.reduce((acc, story) => {
    acc[story.editorial_status] = (acc[story.editorial_status] || 0) + 1;
    return acc;
  }, {});
  els.reviewCount.textContent = counts.review || 0;
  els.newCount.textContent = counts.new || 0;
  els.approvedCount.textContent = counts.approved || 0;
  els.rejectedCount.textContent = counts.rejected || 0;
}

function updateCategoryFilter() {
  const selected = els.categoryFilter.value;
  const categories = [...new Set(stories.map((story) => story.category).filter(Boolean))].sort();
  els.categoryFilter.replaceChildren();
  const all = document.createElement('option');
  all.value = 'all'; all.textContent = 'All categories'; els.categoryFilter.append(all);
  for (const category of categories) {
    const option = document.createElement('option');
    option.value = category; option.textContent = categoryLabel(category); els.categoryFilter.append(option);
  }
  els.categoryFilter.value = categories.includes(selected) ? selected : 'all';
}

function getFilteredStories() {
  const status = els.statusFilter.value;
  const category = els.categoryFilter.value;
  const search = els.searchInput.value.trim().toLowerCase();
  return stories.filter((story) => {
    const statusMatches = status === 'all' || (status === 'active' && ['review', 'new'].includes(story.editorial_status)) || story.editorial_status === status;
    const categoryMatches = category === 'all' || story.category === category;
    const haystack = [story.ai_headline, story.ai_summary, story.source_title, story.location_text, story.relevance_reason, story.category].filter(Boolean).join(' ').toLowerCase();
    return statusMatches && categoryMatches && (!search || haystack.includes(search));
  });
}

function disableCardActions(card, disabled) { card.querySelectorAll('button').forEach((button) => { button.disabled = disabled; }); }

async function saveStory(storyId, card, editorialStatus = null) {
  const headline = card.querySelector('.headline-input').value.trim();
  const summary = card.querySelector('.summary-input').value.trim();
  const reviewNotes = card.querySelector('.notes-input').value.trim();
  const saveState = card.querySelector('.save-state');
  if (!headline || !summary) {
    saveState.textContent = 'Headline and summary are required.'; saveState.dataset.kind = 'error'; return;
  }
  const patch = { ai_headline: headline, ai_summary: summary, review_notes: reviewNotes || null };
  if (editorialStatus) patch.editorial_status = editorialStatus;
  disableCardActions(card, true);
  saveState.textContent = editorialStatus ? `${statusLabel(editorialStatus)}…` : 'Saving…';
  saveState.dataset.kind = 'info';
  const { data, error } = await supabase.from('stories').update(patch).eq('id', storyId).select('id, editorial_status').maybeSingle();
  if (error) {
    saveState.textContent = error.message; saveState.dataset.kind = 'error'; disableCardActions(card, false); return;
  }
  if (!data) {
    saveState.textContent = 'Update was not permitted. Verify this account is an active editor.';
    saveState.dataset.kind = 'error'; disableCardActions(card, false); return;
  }
  saveState.textContent = editorialStatus ? `${statusLabel(editorialStatus)}.` : 'Saved.';
  saveState.dataset.kind = 'success';
  await loadStories({ quiet: true });
}

function renderStory(story) {
  const card = els.storyCardTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.storyId = story.id;
  card.querySelector('.category-badge').textContent = categoryLabel(story.category);
  const statusBadge = card.querySelector('.status-badge');
  statusBadge.textContent = statusLabel(story.editorial_status); statusBadge.dataset.status = story.editorial_status || 'unknown';
  card.querySelector('.source-link').href = story.source_url;
  card.querySelector('.source-title').textContent = story.source_title || 'Source item';
  card.querySelector('.display-headline').textContent = story.ai_headline || story.source_title || 'Untitled';
  card.querySelector('.story-meta').textContent = [story.location_text, story.ai_processed_at ? `AI processed ${formatDate(story.ai_processed_at)}` : null, story.ai_model ? `Model: ${story.ai_model}` : null].filter(Boolean).join(' · ');
  const relevance = clampScore(story.pasadena_relevance); const urgency = clampScore(story.urgency);
  card.querySelector('.relevance-score strong').textContent = relevance; card.querySelector('.urgency-score strong').textContent = urgency;
  card.querySelector('.relevance-score').style.setProperty('--score', relevance); card.querySelector('.urgency-score').style.setProperty('--score', urgency);
  card.querySelector('.relevance-reason').textContent = story.relevance_reason || 'No rationale captured.';
  card.querySelector('.headline-input').value = story.ai_headline || story.source_title || '';
  card.querySelector('.summary-input').value = story.ai_summary || '';
  card.querySelector('.notes-input').value = story.review_notes || '';
  card.querySelector('.save-button').addEventListener('click', () => saveStory(story.id, card));
  card.querySelector('.approve-button').addEventListener('click', () => saveStory(story.id, card, 'approved'));
  card.querySelector('.reject-button').addEventListener('click', () => saveStory(story.id, card, 'rejected'));
  if (story.editorial_status === 'approved') card.querySelector('.approve-button').disabled = true;
  if (story.editorial_status === 'rejected') card.querySelector('.reject-button').disabled = true;
  return card;
}

function renderStories() {
  const filtered = getFilteredStories();
  els.storyList.replaceChildren();
  if (!filtered.length) {
    setNotice(stories.length ? 'No stories match the current filters.' : 'No accessible stories were returned. If this is a new login, the account may not yet be on the editor list.', 'info');
    return;
  }
  setNotice();
  const fragment = document.createDocumentFragment();
  filtered.forEach((story) => fragment.append(renderStory(story)));
  els.storyList.append(fragment);
}

async function loadStories({ quiet = false } = {}) {
  if (!quiet) setNotice('Loading editorial queue…');
  const { data, error } = await supabase.from('stories').select([
    'id','source_url','source_title','ai_headline','ai_summary','category','pasadena_relevance','urgency','location_text','editorial_status','review_notes','ai_model','ai_processed_at','relevance_reason','reviewed_at','last_edited_at'
  ].join(',')).order('pasadena_relevance', { ascending: false, nullsFirst: false }).order('urgency', { ascending: false, nullsFirst: false }).limit(200);
  if (error) {
    stories = []; setNotice(`Could not load the queue: ${error.message}`, 'error'); updateStats(); renderStories(); return;
  }
  stories = data || []; updateStats(); updateCategoryFilter(); renderStories();
}

function approvedStories() {
  return stories.filter((story) => ['approved', 'published'].includes(story.editorial_status)).sort((a, b) => (b.pasadena_relevance ?? 0) - (a.pasadena_relevance ?? 0) || (b.urgency ?? 0) - (a.urgency ?? 0));
}

function buildNewsletterDraft(items) {
  const date = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());
  const sections = new Map();
  for (const story of items) {
    const key = categoryLabel(story.category);
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key).push(story);
  }
  const body = [...sections.entries()].map(([category, categoryStories]) => {
    const storiesText = categoryStories.map((story) => `${story.ai_headline || story.source_title}\n${story.ai_summary || ''}\nSource: ${story.source_url}`).join('\n\n');
    return `${category.toUpperCase()}\n${storiesText}`;
  }).join('\n\n---\n\n');
  return `THE PASADENA CURRENT\n${date}\nNews from the roads, neighborhoods, docks and water around Pasadena.\n\n${body}\n\n— The Pasadena Current\nLocal news, community life and what matters around 21122.`;
}

function buildFacebookDraft(items) {
  const date = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date());
  const bullets = items.slice(0, 6).map((story) => `• ${story.ai_headline || story.source_title} — ${story.ai_summary || ''}`).join('\n\n');
  return `THE PASADENA CURRENT — ${date}\n\nHere’s what’s moving around Pasadena today:\n\n${bullets}\n\nEvery item was reviewed before publication. Read the full brief and original sources on The Pasadena Current.`;
}

function generateEdition() {
  const items = approvedStories();
  if (!items.length) {
    els.editionMessage.textContent = 'Approve at least one story before generating an edition.';
    els.editionMessage.dataset.kind = 'error';
    setHidden(els.editionPanel, false);
    return;
  }
  els.newsletterDraft.value = buildNewsletterDraft(items);
  els.facebookDraft.value = buildFacebookDraft(items);
  els.editionMessage.textContent = `${items.length} approved ${items.length === 1 ? 'story' : 'stories'} included.`;
  els.editionMessage.dataset.kind = 'success';
  setHidden(els.editionPanel, false);
  els.editionPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function copyDraft(textarea, label) {
  try {
    await navigator.clipboard.writeText(textarea.value);
    els.editionMessage.textContent = `${label} copied.`;
    els.editionMessage.dataset.kind = 'success';
  } catch {
    textarea.focus(); textarea.select();
    els.editionMessage.textContent = 'Clipboard access was blocked. The draft is selected so you can copy it manually.';
    els.editionMessage.dataset.kind = 'error';
  }
}

function renderSession(session) {
  currentSession = session;
  const signedIn = Boolean(session?.user);
  setHidden(els.loginPanel, signedIn); setHidden(els.dashboard, !signedIn); setHidden(els.signOutButton, !signedIn); setHidden(els.sessionEmail, !signedIn);
  els.sessionEmail.textContent = session?.user?.email || '';
  if (signedIn) loadStories();
}

els.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault(); els.loginMessage.textContent = 'Signing in…'; els.loginMessage.dataset.kind = 'info';
  const { data, error } = await supabase.auth.signInWithPassword({ email: els.emailInput.value.trim(), password: els.passwordInput.value });
  if (error) { els.loginMessage.textContent = error.message; els.loginMessage.dataset.kind = 'error'; return; }
  els.loginMessage.textContent = ''; renderSession(data.session);
});
els.signOutButton.addEventListener('click', async () => { await supabase.auth.signOut(); stories = []; renderSession(null); });
els.refreshButton.addEventListener('click', () => loadStories());
els.generateEditionButton.addEventListener('click', generateEdition);
els.closeEditionButton.addEventListener('click', () => setHidden(els.editionPanel, true));
els.copyNewsletterButton.addEventListener('click', () => copyDraft(els.newsletterDraft, 'Newsletter draft'));
els.copyFacebookButton.addEventListener('click', () => copyDraft(els.facebookDraft, 'Facebook draft'));
els.statusFilter.addEventListener('change', renderStories);
els.categoryFilter.addEventListener('change', renderStories);
els.searchInput.addEventListener('input', renderStories);
supabase.auth.onAuthStateChange((_event, session) => { if (session?.access_token !== currentSession?.access_token) renderSession(session); });
const { data: sessionData } = await supabase.auth.getSession();
renderSession(sessionData.session);
