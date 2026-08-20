import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm';

const SUPABASE_URL = 'https://eedpedkvymohcubdaoey.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_6RReetP9MPYS_xn0k6xzrw_AVBbgBRs';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const els = {
  section: document.querySelector('#communityReviewSection'),
  count: document.querySelector('#communityCount'),
  notice: document.querySelector('#communityNotice'),
  list: document.querySelector('#communityList'),
  template: document.querySelector('#communityCardTemplate'),
};

let submissions = [];

function setNotice(message = '', kind = 'info') {
  els.notice.textContent = message;
  els.notice.dataset.kind = kind;
  els.notice.classList.toggle('hidden', !message);
}

function formatDate(value) {
  if (!value) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function labelType(value) {
  return ({
    news_report: 'Community report',
    opinion: 'Opinion',
    community_notice: 'Neighborhood note',
    event: 'Event',
    tip: 'Tip',
    yard_sale: 'Yard sale',
    lost_found: 'Lost & found',
    business: 'Business',
    photo: 'Photo',
    other: 'Other',
  })[value] || value || 'Submission';
}

function labelStatus(value) {
  return ({ pending: 'Awaiting AI', review: 'Needs review', approved: 'Approved', rejected: 'Rejected', published: 'Published' })[value] || value || 'Unknown';
}

function preferredBylineLabel(value) {
  return ({ full_name: 'full name', first_name_last_initial: 'first name + last initial', anonymous: 'anonymous to readers' })[value] || value;
}

function riskLabel(level) {
  const value = Number(level ?? 0);
  if (value >= 70) return `High review risk ${value}`;
  if (value >= 35) return `Review risk ${value}`;
  if (level == null) return 'Not AI-reviewed';
  return `Low review risk ${value}`;
}

function disableActions(card, disabled) {
  card.querySelectorAll('button').forEach((button) => { button.disabled = disabled; });
}

async function saveSubmission(submissionId, card, moderationStatus = null) {
  const saveState = card.querySelector('.community-save-state');
  const cleanedTitle = card.querySelector('.community-title-input').value.trim();
  const cleanedBody = card.querySelector('.community-body-input').value.trim();

  if (!cleanedTitle || !cleanedBody) {
    saveState.textContent = 'A publishable headline and story are required.';
    saveState.dataset.kind = 'error';
    return;
  }

  const patch = {
    ai_cleaned_title: cleanedTitle,
    ai_cleaned_description: cleanedBody,
    editor_byline: card.querySelector('.community-byline-input').value.trim() || null,
    publication_location: card.querySelector('.community-location-input').value.trim() || null,
    moderator_notes: card.querySelector('.community-notes-input').value.trim() || null,
  };
  if (moderationStatus) patch.moderation_status = moderationStatus;

  disableActions(card, true);
  saveState.textContent = moderationStatus === 'approved' ? 'Publishing…' : moderationStatus === 'rejected' ? 'Rejecting…' : 'Saving…';
  saveState.dataset.kind = 'info';

  const { data, error } = await supabase
    .from('community_submissions')
    .update(patch)
    .eq('id', submissionId)
    .select('id, moderation_status')
    .maybeSingle();

  if (error) {
    saveState.textContent = error.message;
    saveState.dataset.kind = 'error';
    disableActions(card, false);
    return;
  }

  if (!data) {
    saveState.textContent = 'Update was not permitted for this account.';
    saveState.dataset.kind = 'error';
    disableActions(card, false);
    return;
  }

  saveState.textContent = moderationStatus === 'approved' ? 'Approved and published.' : moderationStatus === 'rejected' ? 'Rejected.' : 'Saved.';
  saveState.dataset.kind = 'success';
  await loadSubmissions({ quiet: true });
}

function renderSubmission(item) {
  const card = els.template.content.firstElementChild.cloneNode(true);
  card.dataset.submissionId = item.id;

  card.querySelector('.submission-type-badge').textContent = labelType(item.submission_type);
  const status = card.querySelector('.submission-status-badge');
  status.textContent = labelStatus(item.moderation_status);
  status.dataset.status = item.moderation_status;

  const risk = card.querySelector('.risk-badge');
  risk.textContent = riskLabel(item.ai_risk_level);
  risk.dataset.risk = Number(item.ai_risk_level ?? 0) >= 70 ? 'high' : Number(item.ai_risk_level ?? 0) >= 35 ? 'medium' : 'low';

  const sourceLink = card.querySelector('.submission-source-link');
  if (item.source_url) {
    sourceLink.href = item.source_url;
    sourceLink.classList.remove('hidden');
  }

  const submitterMeta = [
    item.submitter_name,
    item.submitter_email,
    `credit: ${preferredBylineLabel(item.byline_preference)}`,
    item.address ? `submitted location: ${item.address}` : null,
    `received ${formatDate(item.created_at)}`,
  ].filter(Boolean).join(' · ');
  card.querySelector('.submitter-meta').textContent = submitterMeta;

  card.querySelector('.original-title').textContent = item.title;
  card.querySelector('.original-body').textContent = item.description || '';
  card.querySelector('.community-title-input').value = item.ai_cleaned_title || item.title || '';
  card.querySelector('.community-body-input').value = item.ai_cleaned_description || item.description || '';
  card.querySelector('.community-byline-input').value = item.editor_byline || '';
  card.querySelector('.community-location-input').value = item.publication_location || '';
  card.querySelector('.community-notes-input').value = item.moderator_notes || '';
  card.querySelector('.community-ai-note').textContent = item.ai_editor_notes || (item.moderation_status === 'pending' ? 'Waiting for the copy-desk workflow.' : 'No AI copy-desk note was recorded.');

  const flags = Array.isArray(item.ai_risk_flags) ? item.ai_risk_flags : [];
  card.querySelector('.community-risk-flags').textContent = flags.length ? flags.join(' · ') : 'None flagged';

  card.querySelector('.community-save-button').addEventListener('click', () => saveSubmission(item.id, card));
  card.querySelector('.community-reject-button').addEventListener('click', () => saveSubmission(item.id, card, 'rejected'));
  card.querySelector('.community-approve-button').addEventListener('click', () => saveSubmission(item.id, card, 'approved'));

  if (item.moderation_status === 'approved' || item.moderation_status === 'published') {
    card.querySelector('.community-approve-button').disabled = true;
  }
  if (item.moderation_status === 'rejected') {
    card.querySelector('.community-reject-button').disabled = true;
  }

  return card;
}

function renderSubmissions() {
  els.list.replaceChildren();
  const activeCount = submissions.filter((item) => ['pending', 'review'].includes(item.moderation_status)).length;
  els.count.textContent = activeCount;

  if (!submissions.length) {
    setNotice('No resident submissions yet.');
    return;
  }

  setNotice();
  const sorted = [...submissions].sort((a, b) => {
    const rank = { review: 0, pending: 1, approved: 2, published: 2, rejected: 3 };
    const statusDelta = (rank[a.moderation_status] ?? 9) - (rank[b.moderation_status] ?? 9);
    if (statusDelta) return statusDelta;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  const fragment = document.createDocumentFragment();
  sorted.forEach((item) => fragment.append(renderSubmission(item)));
  els.list.append(fragment);
}

async function loadSubmissions({ quiet = false } = {}) {
  if (!quiet) setNotice('Loading resident submissions…');

  const { data, error } = await supabase
    .from('community_submissions')
    .select([
      'id','submission_type','submitter_name','submitter_email','title','description','address','source_url','byline_preference','moderation_status',
      'ai_cleaned_title','ai_cleaned_description','ai_editor_notes','ai_risk_level','ai_risk_flags','ai_model','ai_processed_at',
      'moderator_notes','editor_byline','publication_location','created_at','reviewed_at','published_at'
    ].join(','))
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    submissions = [];
    els.count.textContent = '0';
    setNotice(`Could not load Community Voices: ${error.message}`, 'error');
    return;
  }

  submissions = data || [];
  renderSubmissions();
}

async function syncSession(session) {
  if (session?.user) {
    els.section.classList.remove('hidden');
    await loadSubmissions();
  } else {
    submissions = [];
    els.list.replaceChildren();
    els.count.textContent = '0';
  }
}

supabase.auth.onAuthStateChange((_event, session) => {
  syncSession(session);
});

const { data: sessionData } = await supabase.auth.getSession();
await syncSession(sessionData.session);
