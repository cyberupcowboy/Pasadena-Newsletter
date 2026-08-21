import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm';

const SUPABASE_URL = 'https://eedpedkvymohcubdaoey.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_6RReetP9MPYS_xn0k6xzrw_AVBbgBRs';
const FILTER_STORAGE_KEY = 'pasadena-current-community-workflow-filter';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const els = {
  section: document.querySelector('#communityReviewSection'),
  list: document.querySelector('#communityList'),
  inboxCount: document.querySelector('#communityCount'),
  search: document.querySelector('#communityWorkflowSearch'),
  refresh: document.querySelector('#communityWorkflowRefresh'),
  hint: document.querySelector('#communityWorkflowHint'),
  empty: document.querySelector('#communityWorkflowEmpty'),
  tabs: [...document.querySelectorAll('[data-community-workflow-filter]')],
};

const FILTER_COPY = {
  action: 'AI-reviewed submissions waiting for your editorial decision.',
  waiting: 'New or re-queued submissions still waiting for the AI copy desk. Publishing unlocks after the review finishes.',
  later: 'Stories you intentionally set aside. They stay out of the Inbox until you return them to review.',
  approved: 'Published Community Voices archive. Reopening one removes it from the public feed until you approve it again.',
  rejected: 'Rejected submissions are kept here for your editorial record and can be reopened if you change your mind.',
  all: 'Every resident submission, including active work and archives.',
};

let activeFilter = sessionStorage.getItem(FILTER_STORAGE_KEY) || 'action';
if (!FILTER_COPY[activeFilter]) activeFilter = 'action';

function statusFromCard(card) {
  return card.querySelector('.submission-status-badge')?.dataset.status || 'unknown';
}

function isWaitingOnAi(card) {
  const status = statusFromCard(card);
  if (status === 'pending') return true;
  if (status !== 'review') return false;
  const risk = card.querySelector('.risk-badge')?.dataset.risk;
  const rerunText = card.querySelector('.community-reprocess-button')?.textContent || '';
  const approveText = card.querySelector('.community-approve-button')?.textContent || '';
  return risk === 'pending' || /queued|waiting/i.test(`${rerunText} ${approveText}`);
}

function workflowState(card) {
  const status = statusFromCard(card);
  if (status === 'deferred') return 'later';
  if (status === 'approved' || status === 'published') return 'approved';
  if (status === 'rejected') return 'rejected';
  if (isWaitingOnAi(card)) return 'waiting';
  if (status === 'review') return 'action';
  return 'waiting';
}

function statusLabel(status) {
  return ({
    pending: 'Awaiting AI review',
    review: 'Needs review',
    deferred: 'Saved for later',
    approved: 'Approved',
    published: 'Published',
    rejected: 'Rejected',
  })[status] || status;
}

function cardTitle(card) {
  return card.querySelector('.community-title-input')?.value?.trim()
    || card.querySelector('.original-title')?.textContent?.trim()
    || 'Untitled submission';
}

function ensureSummary(card) {
  let summary = card.querySelector('.workflow-card-summary');
  if (!summary) {
    summary = document.createElement('div');
    summary.className = 'workflow-card-summary';
    const title = document.createElement('h3');
    title.className = 'workflow-card-title';
    const meta = document.createElement('p');
    meta.className = 'workflow-card-state';
    summary.append(title, meta);
    card.querySelector('.submitter-meta')?.after(summary);
  }
  summary.querySelector('.workflow-card-title').textContent = cardTitle(card);
  const state = workflowState(card);
  summary.querySelector('.workflow-card-state').textContent = ({
    action: 'Ready for your decision',
    waiting: 'Waiting for AI editorial review',
    later: 'Saved for later',
    approved: 'Approved / published',
    rejected: 'Rejected archive',
  })[state] || '';
}

function setCardMessage(card, message, kind = 'info') {
  const state = card.querySelector('.community-save-state');
  if (!state) return;
  state.textContent = message;
  state.dataset.kind = kind;
}

function draftPatch(card) {
  return {
    ai_cleaned_title: card.querySelector('.community-title-input')?.value.trim() || null,
    ai_cleaned_description: card.querySelector('.community-body-input')?.value.trim() || null,
    editor_byline: card.querySelector('.community-byline-input')?.value.trim() || null,
    publication_location: card.querySelector('.community-location-input')?.value.trim() || null,
    moderator_notes: card.querySelector('.community-notes-input')?.value.trim() || null,
  };
}

async function moveSubmission(card, nextStatus) {
  const id = card.dataset.submissionId;
  if (!id) return;

  const currentStatus = statusFromCard(card);
  if (nextStatus === 'review' && ['approved', 'published'].includes(currentStatus)) {
    const confirmed = window.confirm('Reopen this published submission? It will be removed from the public Community Voices feed until you approve it again.');
    if (!confirmed) return;
  }

  const buttons = [...card.querySelectorAll('button')];
  buttons.forEach((button) => { button.disabled = true; });

  const patch = nextStatus === 'deferred'
    ? { ...draftPatch(card), moderation_status: 'deferred' }
    : { moderation_status: nextStatus };

  setCardMessage(
    card,
    nextStatus === 'deferred' ? 'Saving for later…' : nextStatus === 'review' ? 'Returning to Inbox…' : 'Updating…',
  );

  const { data, error } = await supabase
    .from('community_submissions')
    .update(patch)
    .eq('id', id)
    .select('id,moderation_status')
    .maybeSingle();

  if (error || !data) {
    setCardMessage(card, error?.message || 'The workflow update was not permitted.', 'error');
    buttons.forEach((button) => { button.disabled = false; });
    return;
  }

  setCardMessage(
    card,
    nextStatus === 'deferred' ? 'Saved for later.' : 'Returned to the Inbox.',
    'success',
  );

  window.setTimeout(() => location.reload(), 250);
}

function createWorkflowButton(card, actionGroup, kind, label, nextStatus) {
  if (actionGroup.querySelector(`[data-workflow-action="${kind}"]`)) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = kind === 'later' ? 'button ghost workflow-later-button' : 'button ghost workflow-reopen-button';
  button.dataset.workflowAction = kind;
  button.textContent = label;
  button.addEventListener('click', () => moveSubmission(card, nextStatus));

  const reject = actionGroup.querySelector('.community-reject-button');
  if (reject) actionGroup.insertBefore(button, reject);
  else actionGroup.append(button);
}

function ensureDetailsToggle(card) {
  let toggle = card.querySelector('.workflow-details-toggle');
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'button ghost workflow-details-toggle';
    toggle.addEventListener('click', () => {
      const expanded = card.classList.toggle('workflow-expanded');
      toggle.textContent = expanded ? 'Hide details' : 'Open details';
    });
    card.querySelector('.community-actions > div')?.prepend(toggle);
  }
  toggle.textContent = card.classList.contains('workflow-expanded') ? 'Hide details' : 'Open details';
}

function enhanceCard(card) {
  const status = statusFromCard(card);
  const badge = card.querySelector('.submission-status-badge');
  if (badge) badge.textContent = statusLabel(status);

  const save = card.querySelector('.community-save-button');
  if (save) save.textContent = 'Save changes';

  ensureSummary(card);

  const actionGroup = card.querySelector('.community-actions > div');
  if (!actionGroup) return;

  actionGroup.querySelectorAll('[data-workflow-action]').forEach((button) => button.remove());

  const state = workflowState(card);
  if (state === 'action') {
    createWorkflowButton(card, actionGroup, 'later', 'Save for later', 'deferred');
  } else if (state === 'later') {
    createWorkflowButton(card, actionGroup, 'reopen', 'Return to Inbox', 'review');
  } else if (state === 'approved' || state === 'rejected') {
    createWorkflowButton(card, actionGroup, 'reopen', 'Reopen', 'review');
  }

  const archived = ['later', 'approved', 'rejected'].includes(state);
  card.classList.toggle('workflow-archive-card', archived);
  if (archived) ensureDetailsToggle(card);
  else {
    card.classList.remove('workflow-expanded');
    card.querySelector('.workflow-details-toggle')?.remove();
  }
}

function matchesSearch(card) {
  const query = els.search?.value.trim().toLowerCase();
  if (!query) return true;
  return card.textContent.toLowerCase().includes(query);
}

function updateCounts(cards) {
  const counts = { action: 0, waiting: 0, later: 0, approved: 0, rejected: 0, all: cards.length };
  cards.forEach((card) => { counts[workflowState(card)] += 1; });

  els.tabs.forEach((tab) => {
    const key = tab.dataset.communityWorkflowFilter;
    const count = tab.querySelector('[data-workflow-count]');
    if (count) count.textContent = counts[key] ?? 0;
    tab.dataset.active = String(key === activeFilter);
    tab.setAttribute('aria-selected', String(key === activeFilter));
  });

  if (els.inboxCount) els.inboxCount.textContent = counts.action;
  return counts;
}

function applyWorkflow() {
  if (!els.list) return;
  const cards = [...els.list.querySelectorAll('.community-card')];
  cards.forEach(enhanceCard);
  const counts = updateCounts(cards);

  let visible = 0;
  cards.forEach((card) => {
    const state = workflowState(card);
    const stateMatches = activeFilter === 'all' || state === activeFilter;
    const show = stateMatches && matchesSearch(card);
    card.classList.toggle('workflow-hidden', !show);
    if (show) visible += 1;
  });

  if (els.hint) els.hint.textContent = FILTER_COPY[activeFilter];
  if (els.empty) {
    els.empty.classList.toggle('hidden', visible > 0);
    els.empty.textContent = els.search?.value.trim()
      ? 'No submissions in this section match your search.'
      : counts.all
        ? 'Nothing is in this section right now.'
        : 'No resident submissions yet.';
  }
}

function setFilter(filter) {
  if (!FILTER_COPY[filter]) return;
  activeFilter = filter;
  sessionStorage.setItem(FILTER_STORAGE_KEY, filter);
  if (els.search) els.search.value = '';
  applyWorkflow();
}

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => setFilter(tab.dataset.communityWorkflowFilter));
});
els.search?.addEventListener('input', applyWorkflow);
els.refresh?.addEventListener('click', () => location.reload());

let renderQueued = false;
const observer = new MutationObserver(() => {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    applyWorkflow();
  });
});
if (els.list) observer.observe(els.list, { childList: true });

const { data: sessionData } = await supabase.auth.getSession();
if (sessionData.session?.user) applyWorkflow();

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) applyWorkflow();
});
