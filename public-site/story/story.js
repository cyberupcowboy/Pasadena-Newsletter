import { supabase, formatDate, formatDateTime, labelCategory, publisherFromUrl } from '../lib/current.js';

const params = new URLSearchParams(location.search);
const storyId = params.get('id');
let story = null;
let transparency = null;
let session = null;

const $ = (selector) => document.querySelector(selector);
const els = {
  loading: $('#storyLoading'), error: $('#storyError'), article: $('#storyArticle'),
  category: $('#storyCategory'), scope: $('#storyScope'), headline: $('#storyHeadline'), summary: $('#storySummary'), meta: $('#storyMeta'),
  original: $('#originalSource'), correctionBox: $('#correctionBox'), correctionDate: $('#correctionDate'), correctionText: $('#correctionText'),
  origin: $('#originLabel'), byline: $('#bylineLabel'), ai: $('#aiLabel'), publisher: $('#publisherLabel'),
  framingSection: $('#framingSection'), framingLabel: $('#framingLabel'), framingConfidence: $('#framingConfidence'), framingReason: $('#framingReason'),
  explainSummary: $('#explainSummary'), why: $('#whyItMatters'), background: $('#backgroundText'), keepInMind: $('#keepInMind'),
  howReported: $('#howReported'), sourceList: $('#sourceList'), timelineSection: $('#timelineSection'), timelineList: $('#timelineList'),
  errorForm: $('#errorReportForm'), errorEmail: $('#errorEmail'), errorMessage: $('#errorMessage'), errorStatus: $('#errorReportStatus'),
  signedOut: $('#signedOutCommentAuth'), signedIn: $('#signedInCommentAuth'), commentLoginForm: $('#commentLoginForm'), commentEmail: $('#commentEmail'),
  commentAuthStatus: $('#commentAuthStatus'), commentSessionLabel: $('#commentSessionLabel'), commentSignOut: $('#commentSignOut'),
  commentForm: $('#commentForm'), commentDisplayName: $('#commentDisplayName'), commentBody: $('#commentBody'), commentStatus: $('#commentStatus'), commentList: $('#commentList'),
};

function setHidden(el, hidden) { el?.classList.toggle('hidden', hidden); }

function originLabel(value) {
  return ({
    aggregated_source: 'Curated source brief',
    staff_report: 'Staff report',
    press_release: 'Press release summary',
    community_submission: 'Community submission',
    public_record: 'Public-record brief',
    other: 'Current brief',
  })[value] || 'Curated source brief';
}

function scopeLabel(value) {
  return ({ local: 'Local', state: 'Maryland', national: 'National' })[value] || 'Local';
}

function framingText(value) {
  return ({
    left: 'Left-leaning framing', center: 'Center / straight framing', right: 'Right-leaning framing',
    mixed: 'Mixed framing', unclear: 'Unclear framing', not_political: 'Nonpolitical',
  })[value] || 'Unclear framing';
}

function confidenceText(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'Confidence not scored';
  if (n >= 80) return 'High confidence';
  if (n >= 55) return 'Medium confidence';
  return 'Low confidence';
}

function defaultHowReported() {
  return `The Pasadena Current reviewed a report from ${publisherFromUrl(story.source_url)}, generated a concise local brief with AI assistance, and required human editorial approval before publishing this page. The original reporting remains with the source linked above.`;
}

function defaultWhyItMatters() {
  if ((story.content_scope || 'local') !== 'local') return 'This story was selected for the Maryland or national desk because it may affect Pasadena readers beyond the immediate neighborhood.';
  if (story.location_text) return `This development is connected to ${story.location_text} and was selected because of its relevance to people living in and around Pasadena.`;
  return 'The Current selected this item because it has direct or practical relevance to Pasadena-area readers.';
}

async function loadStory() {
  if (!storyId) throw new Error('No story was specified.');
  const [storyResult, transparencyResult] = await Promise.all([
    supabase.from('published_stories').select('*').eq('story_id', storyId).maybeSingle(),
    supabase.from('story_transparency').select('*').eq('story_id', storyId).maybeSingle(),
  ]);
  if (storyResult.error) throw storyResult.error;
  if (!storyResult.data) throw new Error('This story is not published or no longer available.');
  story = storyResult.data;
  transparency = transparencyResult.data || {};
  renderStory();
  await loadTimeline();
}

function renderStory() {
  document.title = `${story.headline} — The Pasadena Current`;
  els.category.textContent = labelCategory(story.category);
  els.scope.textContent = scopeLabel(story.content_scope);
  els.headline.textContent = story.headline;
  els.summary.textContent = story.summary || '';
  els.meta.textContent = [
    story.location_text,
    story.source_published_at ? `Source published ${formatDateTime(story.source_published_at)}` : null,
    story.approved_at ? `Current approved ${formatDateTime(story.approved_at)}` : null,
    story.updated_at && story.updated_at !== story.approved_at ? `Updated ${formatDateTime(story.updated_at)}` : null,
  ].filter(Boolean).join(' · ');
  els.original.href = story.source_url;
  els.original.textContent = `Read original reporting at ${publisherFromUrl(story.source_url)} →`;

  els.origin.textContent = originLabel(transparency.editorial_origin);
  els.byline.textContent = transparency.public_byline || 'Pasadena Current Desk';
  els.ai.textContent = transparency.ai_assisted === false ? 'No AI assistance recorded' : 'AI-assisted · human reviewed';
  els.publisher.textContent = publisherFromUrl(story.source_url);

  if (transparency.correction_note) {
    els.correctionDate.textContent = `Correction${transparency.correction_at ? ` — ${formatDate(transparency.correction_at)}` : ''}`;
    els.correctionText.textContent = transparency.correction_note;
    setHidden(els.correctionBox, false);
  }

  if (story.political_content && story.political_slant !== 'not_political') {
    els.framingLabel.textContent = framingText(story.political_slant);
    els.framingConfidence.textContent = confidenceText(story.political_slant_confidence);
    els.framingReason.textContent = story.political_slant_reason || 'The framing classifier did not record a detailed explanation.';
    setHidden(els.framingSection, false);
  }

  els.explainSummary.textContent = story.summary || 'No summary is available.';
  els.why.textContent = transparency.why_it_matters || defaultWhyItMatters();
  els.background.textContent = [
    `Category: ${labelCategory(story.category)}.`,
    story.location_text ? `Location: ${story.location_text}.` : null,
    `Original reporting: ${publisherFromUrl(story.source_url)}.`,
  ].filter(Boolean).join(' ');
  els.keepInMind.textContent = story.political_content
    ? 'Perspective analysis describes presentation and sourcing choices; it is not a truth score. Follow the original source and related coverage for the full context.'
    : 'This is a concise Current brief, not a replacement for the full source report. Follow the original source for complete reporting and quoted material.';

  els.howReported.textContent = transparency.how_reported || defaultHowReported();
  const sourceItem = document.createElement('li');
  const sourceLink = document.createElement('a');
  sourceLink.href = story.source_url;
  sourceLink.target = '_blank';
  sourceLink.rel = 'noopener noreferrer';
  sourceLink.textContent = `${publisherFromUrl(story.source_url)} — ${story.source_title || 'original report'}`;
  sourceItem.append(sourceLink);
  els.sourceList.replaceChildren(sourceItem);

  setHidden(els.loading, true);
  setHidden(els.article, false);
}

async function loadTimeline() {
  let related = [];
  const topic = transparency.topic_key;
  if (topic) {
    const { data: metaRows } = await supabase.from('story_transparency').select('story_id').eq('topic_key', topic).neq('story_id', storyId).limit(12);
    const ids = (metaRows || []).map((row) => row.story_id);
    if (ids.length) {
      const { data } = await supabase.from('published_stories')
        .select('story_id,headline,summary,source_published_at,approved_at,category')
        .in('story_id', ids)
        .order('source_published_at', { ascending: true, nullsFirst: false });
      related = data || [];
    }
  }

  if (!related.length && story.category) {
    const { data } = await supabase.from('published_stories')
      .select('story_id,headline,summary,source_published_at,approved_at,category')
      .eq('category', story.category)
      .neq('story_id', storyId)
      .order('source_published_at', { ascending: false, nullsFirst: false })
      .limit(5);
    related = (data || []).reverse();
  }

  if (!related.length) return;
  els.timelineList.replaceChildren();
  const fragment = document.createDocumentFragment();
  related.slice(-8).forEach((item) => {
    const row = document.createElement('article'); row.className = 'timeline-item';
    const time = document.createElement('time'); time.textContent = formatDate(item.source_published_at || item.approved_at);
    const link = document.createElement('a'); link.href = `./?id=${encodeURIComponent(item.story_id)}`;
    const title = document.createElement('h3'); title.textContent = item.headline;
    const copy = document.createElement('p'); copy.textContent = item.summary || '';
    link.append(title); row.append(time, link, copy); fragment.append(row);
  });
  els.timelineList.append(fragment);
  setHidden(els.timelineSection, false);
}

async function reportError(event) {
  event.preventDefault();
  els.errorStatus.textContent = 'Sending to the editor…'; els.errorStatus.dataset.kind = 'info';
  const { error } = await supabase.from('reader_error_reports').insert({
    story_id: storyId,
    reporter_email: els.errorEmail.value.trim() || null,
    message: els.errorMessage.value.trim(),
  });
  if (error) {
    els.errorStatus.textContent = 'We could not submit that report. Please try again.'; els.errorStatus.dataset.kind = 'error';
    return;
  }
  els.errorStatus.textContent = 'Thanks. The correction request is in the editor queue.'; els.errorStatus.dataset.kind = 'success';
  els.errorForm.reset();
}

async function renderAuth() {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  const signedIn = Boolean(session?.user);
  setHidden(els.signedOut, signedIn);
  setHidden(els.signedIn, !signedIn);
  setHidden(els.commentForm, !signedIn);
  if (signedIn) {
    els.commentSessionLabel.textContent = `Signed in as ${session.user.email}`;
    const savedName = localStorage.getItem('pasadena-current-display-name');
    if (savedName && !els.commentDisplayName.value) els.commentDisplayName.value = savedName;
  }
  await loadComments();
}

async function sendMagicLink(event) {
  event.preventDefault();
  els.commentAuthStatus.textContent = 'Sending sign-in link…'; els.commentAuthStatus.dataset.kind = 'info';
  const { error } = await supabase.auth.signInWithOtp({
    email: els.commentEmail.value.trim(),
    options: { emailRedirectTo: window.location.href },
  });
  if (error) {
    els.commentAuthStatus.textContent = error.message; els.commentAuthStatus.dataset.kind = 'error';
  } else {
    els.commentAuthStatus.textContent = 'Check your email for the sign-in link.'; els.commentAuthStatus.dataset.kind = 'success';
  }
}

async function submitComment(event) {
  event.preventDefault();
  if (!session?.user) return;
  const displayName = els.commentDisplayName.value.trim();
  const body = els.commentBody.value.trim();
  els.commentStatus.textContent = 'Submitting for moderation…'; els.commentStatus.dataset.kind = 'info';
  const { error } = await supabase.from('community_comments').insert({
    story_id: storyId,
    community_submission_id: null,
    user_id: session.user.id,
    display_name: displayName,
    body,
  });
  if (error) {
    els.commentStatus.textContent = error.message.includes('60 seconds') ? 'Please wait at least 60 seconds between comments.' : 'We could not submit that comment.';
    els.commentStatus.dataset.kind = 'error';
    return;
  }
  localStorage.setItem('pasadena-current-display-name', displayName);
  els.commentBody.value = '';
  els.commentStatus.textContent = 'Submitted. Safe comments appear after the moderation pass; uncertain ones go to a human editor.';
  els.commentStatus.dataset.kind = 'success';
  await loadComments();
}

async function loadComments() {
  if (!storyId) return;
  const { data, error } = await supabase.from('community_comments')
    .select('id,user_id,display_name,body,moderation_status,created_at')
    .eq('story_id', storyId)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) return;
  els.commentList.replaceChildren();
  const rows = data || [];
  if (!rows.length) {
    const empty = document.createElement('p'); empty.className = 'form-status'; empty.textContent = 'No public comments yet. You can start the conversation.';
    els.commentList.append(empty); return;
  }
  const fragment = document.createDocumentFragment();
  rows.forEach((comment) => {
    const card = document.createElement('article'); card.className = 'comment-card';
    if (comment.moderation_status !== 'approved') card.classList.add('comment-pending');
    const header = document.createElement('header');
    const name = document.createElement('strong'); name.textContent = comment.display_name;
    const time = document.createElement('time'); time.textContent = formatDateTime(comment.created_at);
    const body = document.createElement('p'); body.textContent = comment.body;
    header.append(name, time); card.append(header, body); fragment.append(card);
  });
  els.commentList.append(fragment);
}

els.errorForm.addEventListener('submit', reportError);
els.commentLoginForm.addEventListener('submit', sendMagicLink);
els.commentForm.addEventListener('submit', submitComment);
els.commentSignOut.addEventListener('click', async () => { await supabase.auth.signOut(); await renderAuth(); });
supabase.auth.onAuthStateChange((_event, newSession) => { session = newSession; renderAuth(); });

try {
  await loadStory();
  await renderAuth();
} catch (error) {
  setHidden(els.loading, true);
  els.error.textContent = error.message || 'Could not load this Current brief.';
  setHidden(els.error, false);
}
