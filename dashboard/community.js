import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm';

const SUPABASE_URL = 'https://eedpedkvymohcubdaoey.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_6RReetP9MPYS_xn0k6xzrw_AVBbgBRs';
const REQUIRED_AI_REVIEW_VERSION = 2;

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
  return ({ pending: 'Awaiting AI review', review: 'Needs review', approved: 'Approved', rejected: 'Rejected', published: 'Published' })[value] || value || 'Unknown';
}

function preferredBylineLabel(value) {
  return ({ full_name: 'full name', first_name_last_initial: 'first name + last initial', anonymous: 'anonymous to readers' })[value] || value;
}

function riskLabel(level, processedAt) {
  if (!processedAt) return 'AI review pending';
  const value = Number(level ?? 0);
  if (value >= 70) return `High review risk ${value}`;
  if (value >= 35) return `Review risk ${value}`;
  return `Low review risk ${value}`;
}

function recommendationLabel(value) {
  return ({
    publishable: 'Publishable',
    publishable_with_edits: 'Publishable with edits',
    hold_for_verification: 'Hold for verification',
    do_not_publish: 'Do not publish',
  })[value] || 'No current AI recommendation';
}

function verdictLabel(value) {
  return ({
    supported_by_sources: 'Supported by sources',
    contradicted_by_sources: 'Contradicted by sources',
    disputed: 'Disputed',
    unverified: 'Unverified',
    opinion_or_personal_account: 'Opinion / personal account',
    not_checked: 'Not checked',
  })[value] || value || 'Not checked';
}

function isCurrentAiReview(item) {
  return Boolean(
    item.ai_processed_at
    && Number(item.ai_review_version ?? 0) >= REQUIRED_AI_REVIEW_VERSION
    && item.ai_editorial_recommendation
    && !item.ai_reprocess_requested_at
  );
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function disableActions(card, disabled) {
  card.querySelectorAll('button').forEach((button) => { button.disabled = disabled; });
}

async function saveSubmission(item, card, moderationStatus = null) {
  const saveState = card.querySelector('.community-save-state');
  const cleanedTitle = card.querySelector('.community-title-input').value.trim();
  const cleanedBody = card.querySelector('.community-body-input').value.trim();
  const moderatorNotes = card.querySelector('.community-notes-input').value.trim();

  if (!cleanedTitle || !cleanedBody) {
    saveState.textContent = 'A publishable headline and story are required.';
    saveState.dataset.kind = 'error';
    return;
  }

  if (moderationStatus === 'approved' && !isCurrentAiReview(item)) {
    saveState.textContent = 'Run the current AI editorial review before publishing this submission.';
    saveState.dataset.kind = 'error';
    return;
  }

  if (
    moderationStatus === 'approved'
    && ['hold_for_verification', 'do_not_publish'].includes(item.ai_editorial_recommendation)
    && !moderatorNotes
  ) {
    saveState.textContent = 'AI recommends holding this item. Add a moderator note explaining your decision if you choose to override and publish.';
    saveState.dataset.kind = 'error';
    card.querySelector('.community-notes-input').focus();
    return;
  }

  const patch = {
    ai_cleaned_title: cleanedTitle,
    ai_cleaned_description: cleanedBody,
    editor_byline: card.querySelector('.community-byline-input').value.trim() || null,
    publication_location: card.querySelector('.community-location-input').value.trim() || null,
    moderator_notes: moderatorNotes || null,
  };
  if (moderationStatus) patch.moderation_status = moderationStatus;

  disableActions(card, true);
  saveState.textContent = moderationStatus === 'approved' ? 'Publishing…' : moderationStatus === 'rejected' ? 'Rejecting…' : 'Saving…';
  saveState.dataset.kind = 'info';

  const { data, error } = await supabase
    .from('community_submissions')
    .update(patch)
    .eq('id', item.id)
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

async function queueAiReview(item, card) {
  const saveState = card.querySelector('.community-save-state');
  disableActions(card, true);
  saveState.textContent = item.ai_processed_at ? 'Queuing a fresh AI editorial review…' : 'Queuing AI editorial review…';
  saveState.dataset.kind = 'info';

  const requestedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('community_submissions')
    .update({
      ai_reprocess_requested_at: requestedAt,
      moderation_status: 'review',
    })
    .eq('id', item.id)
    .select('id, moderation_status, ai_reprocess_requested_at')
    .maybeSingle();

  if (error || !data) {
    saveState.textContent = error?.message || 'Could not queue the AI review.';
    saveState.dataset.kind = 'error';
    disableActions(card, false);
    return;
  }

  saveState.textContent = 'AI editorial review queued. The copy-desk workflow checks for queued items every few minutes. If this was already published, it has returned to review until you approve it again.';
  saveState.dataset.kind = 'success';
  await loadSubmissions({ quiet: true });
}

function appendAnalysisPanel(container, title, text, className = '') {
  const panel = document.createElement('div');
  if (className) panel.classList.add(className);
  const heading = document.createElement('strong');
  heading.textContent = title;
  const body = document.createElement('p');
  body.textContent = text || 'No assessment recorded.';
  panel.append(heading, body);
  container.append(panel);
  return panel;
}

function renderFactChecks(item, container) {
  const panel = document.createElement('div');
  panel.className = 'community-analysis-wide community-fact-check-panel';

  const heading = document.createElement('strong');
  heading.textContent = 'AI-assisted fact check';
  panel.append(heading);

  const summary = document.createElement('p');
  summary.textContent = item.ai_fact_check_summary || 'No fact-check summary recorded.';
  panel.append(summary);

  const checks = Array.isArray(item.ai_fact_checks) ? item.ai_fact_checks : [];
  if (checks.length) {
    const list = document.createElement('div');
    list.className = 'fact-check-list';
    for (const check of checks) {
      const row = document.createElement('div');
      row.className = 'fact-check-row';

      const verdict = document.createElement('span');
      verdict.className = 'fact-verdict';
      verdict.dataset.verdict = check.verdict || 'not_checked';
      verdict.textContent = verdictLabel(check.verdict);

      const claim = document.createElement('b');
      claim.textContent = check.claim || 'Claim';

      const explanation = document.createElement('p');
      explanation.textContent = check.explanation || '';

      row.append(verdict, claim, explanation);
      if (check.needs_editor_verification) {
        const verify = document.createElement('em');
        verify.textContent = 'Editor verification recommended';
        row.append(verify);
      }
      list.append(row);
    }
    panel.append(list);
  }

  const rawSources = Array.isArray(item.ai_fact_check_sources) ? item.ai_fact_check_sources : [];
  const sources = rawSources
    .map((source) => ({
      url: safeHttpUrl(source?.url),
      title: typeof source?.title === 'string' ? source.title.trim() : '',
    }))
    .filter((source) => source.url);

  if (sources.length) {
    const sourceWrap = document.createElement('div');
    sourceWrap.className = 'fact-check-sources';
    const sourceLabel = document.createElement('span');
    sourceLabel.textContent = 'Sources consulted: ';
    sourceWrap.append(sourceLabel);
    sources.forEach((source, index) => {
      const link = document.createElement('a');
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = source.title || new URL(source.url).hostname;
      sourceWrap.append(link);
      if (index < sources.length - 1) sourceWrap.append(document.createTextNode(' · '));
    });
    panel.append(sourceWrap);
  }

  container.append(panel);
}

function renderAiAnalysis(item, card) {
  const box = card.querySelector('.community-ai-box');

  const note = card.querySelector('.community-ai-note');
  note.textContent = item.ai_editor_notes || (item.ai_reprocess_requested_at ? 'A fresh AI editorial review is queued.' : item.moderation_status === 'pending' ? 'Waiting for the AI editorial workflow.' : 'No AI editorial note was recorded.');

  const flags = Array.isArray(item.ai_risk_flags) ? item.ai_risk_flags : [];
  card.querySelector('.community-risk-flags').textContent = flags.length ? flags.join(' · ') : 'None flagged';

  const recommendation = appendAnalysisPanel(
    box,
    'Editorial recommendation',
    recommendationLabel(item.ai_editorial_recommendation),
    'community-recommendation-panel',
  );
  recommendation.dataset.recommendation = item.ai_editorial_recommendation || 'pending';

  appendAnalysisPanel(box, 'Civility / disagreement', item.ai_civility_assessment, 'community-civility-panel');
  appendAnalysisPanel(box, 'Harm / privacy / defamation', item.ai_harm_assessment, 'community-harm-panel');
  renderFactChecks(item, box);

  const stamp = document.createElement('div');
  stamp.className = 'community-analysis-wide community-ai-stamp';
  const status = isCurrentAiReview(item)
    ? `AI editorial review v${item.ai_review_version} completed ${formatDate(item.ai_processed_at)} using ${item.ai_model || 'configured model'}.`
    : item.ai_reprocess_requested_at
      ? `Fresh AI review queued ${formatDate(item.ai_reprocess_requested_at)}. Previous analysis is shown only for context until the new pass completes.`
      : 'This submission does not yet have the current AI editorial review.';
  stamp.textContent = status;
  box.append(stamp);
}

function renderSubmission(item) {
  const card = els.template.content.firstElementChild.cloneNode(true);
  card.dataset.submissionId = item.id;

  card.querySelector('.submission-type-badge').textContent = labelType(item.submission_type);
  const status = card.querySelector('.submission-status-badge');
  status.textContent = labelStatus(item.moderation_status);
  status.dataset.status = item.moderation_status;

  const risk = card.querySelector('.risk-badge');
  risk.textContent = riskLabel(item.ai_risk_level, item.ai_processed_at);
  risk.dataset.risk = !item.ai_processed_at ? 'pending' : Number(item.ai_risk_level ?? 0) >= 70 ? 'high' : Number(item.ai_risk_level ?? 0) >= 35 ? 'medium' : 'low';

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

  renderAiAnalysis(item, card);

  const actionGroup = card.querySelector('.community-actions > div');
  const rerun = document.createElement('button');
  rerun.type = 'button';
  rerun.className = 'button ghost community-reprocess-button';
  rerun.textContent = item.ai_processed_at ? 'Re-run AI review' : 'Run AI review';
  rerun.addEventListener('click', () => queueAiReview(item, card));
  actionGroup.prepend(rerun);

  card.querySelector('.community-save-button').addEventListener('click', () => saveSubmission(item, card));
  card.querySelector('.community-reject-button').addEventListener('click', () => saveSubmission(item, card, 'rejected'));
  card.querySelector('.community-approve-button').addEventListener('click', () => saveSubmission(item, card, 'approved'));

  const approveButton = card.querySelector('.community-approve-button');
  if (!isCurrentAiReview(item)) {
    approveButton.disabled = true;
    approveButton.title = 'A current AI editorial review is required before publication.';
  }
  if (item.moderation_status === 'approved' || item.moderation_status === 'published') {
    approveButton.disabled = true;
  }
  if (item.moderation_status === 'rejected') {
    card.querySelector('.community-reject-button').disabled = true;
  }
  if (item.ai_reprocess_requested_at) {
    rerun.disabled = true;
    rerun.textContent = 'AI review queued';
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
      'ai_fact_check_summary','ai_fact_checks','ai_fact_check_sources','ai_civility_assessment','ai_harm_assessment','ai_editorial_recommendation',
      'ai_reprocess_requested_at','ai_review_version','moderator_notes','editor_byline','publication_location','created_at','reviewed_at','published_at'
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
