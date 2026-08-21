import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm';
import './newsroom-ops.js';

if (!document.querySelector('link[href="./newsroom-ops.css"]')) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = './newsroom-ops.css';
  document.head.append(stylesheet);
}

const SUPABASE_URL = 'https://eedpedkvymohcubdaoey.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_6RReetP9MPYS_xn0k6xzrw_AVBbgBRs';
const REQUIRED_AI_REVIEW_VERSION = 2;
const POLL_MS = 15000;

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

let editorDirty = false;
let pollTimer = null;

document.addEventListener('input', (event) => {
  if (event.target.closest?.('#communityReviewSection')) editorDirty = true;
});

document.addEventListener('change', (event) => {
  if (event.target.closest?.('#communityReviewSection')) editorDirty = true;
});

function queuedCards() {
  return [...document.querySelectorAll('.community-card[data-submission-id]')]
    .filter((card) => {
      const rerun = card.querySelector('.community-reprocess-button');
      return rerun?.disabled && /queued/i.test(rerun.textContent || '');
    });
}

function clarifyQueuedCard(card) {
  const approve = card.querySelector('.community-approve-button');
  const saveState = card.querySelector('.community-save-state');
  if (approve?.disabled) {
    approve.textContent = 'Waiting for AI review…';
    approve.title = 'Publishing unlocks automatically after the queued AI editorial review completes.';
  }
  if (saveState && !saveState.textContent.trim()) {
    saveState.textContent = 'AI review queued — publish unlocks after the editorial pass finishes.';
    saveState.dataset.kind = 'info';
  }
}

function addRefreshPrompt(card) {
  const saveState = card.querySelector('.community-save-state');
  const actionGroup = card.querySelector('.community-actions > div');
  if (saveState) {
    saveState.textContent = 'AI review complete. Refresh this editor view to load the reviewed draft and unlock publishing.';
    saveState.dataset.kind = 'success';
  }
  if (actionGroup && !actionGroup.querySelector('.community-ai-refresh-button')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button primary community-ai-refresh-button';
    button.textContent = 'Load AI review';
    button.addEventListener('click', () => location.reload());
    actionGroup.prepend(button);
  }
}

function reviewIsCurrent(row) {
  return Boolean(
    row?.ai_processed_at
    && Number(row.ai_review_version ?? 0) >= REQUIRED_AI_REVIEW_VERSION
    && row.ai_editorial_recommendation
    && !row.ai_reprocess_requested_at
  );
}

async function pollQueuedReviews() {
  const cards = queuedCards();
  cards.forEach(clarifyQueuedCard);
  if (!cards.length) return;

  const ids = cards.map((card) => card.dataset.submissionId).filter(Boolean);
  const { data, error } = await supabase
    .from('community_submissions')
    .select('id,ai_processed_at,ai_reprocess_requested_at,ai_review_version,ai_editorial_recommendation')
    .in('id', ids);
  if (error || !data) return;

  const currentIds = new Set(data.filter(reviewIsCurrent).map((row) => row.id));
  if (!currentIds.size) return;
  const completedCards = cards.filter((card) => currentIds.has(card.dataset.submissionId));
  if (!editorDirty) { location.reload(); return; }
  completedCards.forEach(addRefreshPrompt);
}

function schedulePoll() {
  clearInterval(pollTimer);
  pollTimer = setInterval(pollQueuedReviews, POLL_MS);
  pollQueuedReviews();
}

const observer = new MutationObserver(() => { queuedCards().forEach(clarifyQueuedCard); });
observer.observe(document.body, { childList: true, subtree: true });

const { data: sessionData } = await supabase.auth.getSession();
if (sessionData.session?.user) schedulePoll();
supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) schedulePoll();
  else clearInterval(pollTimer);
});
