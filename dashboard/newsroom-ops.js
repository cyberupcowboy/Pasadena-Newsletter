import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm';

const SUPABASE_URL = 'https://eedpedkvymohcubdaoey.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_6RReetP9MPYS_xn0k6xzrw_AVBbgBRs';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

let currentTab = 'comments';
let storyMap = new Map();
let trustRows = new Map();
let observer = null;

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function ensureOpsShell() {
  let section = document.querySelector('#newsroomOps');
  if (section) return section;
  section = document.createElement('section');
  section.id = 'newsroomOps';
  section.className = 'newsroom-ops';
  section.innerHTML = `
    <div class="ops-heading"><div><p class="eyebrow">Trust & participation</p><h2>Newsroom operations</h2><p class="subhead">Moderate discussion, handle reader corrections, and manage the transparency shown on public story briefs.</p></div><button id="opsRefresh" class="button ghost" type="button">Refresh desk</button></div>
    <div class="ops-tabs" role="tablist">
      <button class="ops-tab" data-ops-tab="comments" type="button">Comment review <span class="ops-count" data-count="comments">0</span></button>
      <button class="ops-tab" data-ops-tab="comment_reports" type="button">Comment reports <span class="ops-count" data-count="comment_reports">0</span></button>
      <button class="ops-tab" data-ops-tab="corrections" type="button">Correction requests <span class="ops-count" data-count="corrections">0</span></button>
      <button class="ops-tab" data-ops-tab="newsletters" type="button">Newsletter drafts <span class="ops-count" data-count="newsletters">0</span></button>
    </div>
    <section id="opsPanel" class="ops-panel"></section>`;
  document.querySelector('#dashboard')?.append(section);
  section.querySelectorAll('.ops-tab').forEach((button) => button.addEventListener('click', () => {
    currentTab = button.dataset.opsTab;
    renderOps();
  }));
  section.querySelector('#opsRefresh').addEventListener('click', loadOps);
  return section;
}

const opsData = { comments: [], comment_reports: [], corrections: [], newsletters: [] };

async function loadStoryMap() {
  const { data } = await supabase.from('published_stories').select('story_id,headline,source_url').limit(500);
  storyMap = new Map((data || []).map((row) => [row.story_id, row]));
}

async function loadOps() {
  ensureOpsShell();
  await loadStoryMap();
  const [comments, commentReports, corrections, newsletters] = await Promise.all([
    supabase.from('community_comments')
      .select('id,story_id,community_submission_id,display_name,body,moderation_status,ai_risk_score,ai_risk_flags,ai_moderation_reason,ai_processed_at,created_at')
      .in('moderation_status', ['review','pending','rejected'])
      .order('created_at', { ascending: false }).limit(100),
    supabase.from('comment_reports')
      .select('id,comment_id,reason,status,created_at,resolution_note')
      .in('status', ['new','reviewing']).order('created_at', { ascending: false }).limit(100),
    supabase.from('reader_error_reports')
      .select('id,story_id,reporter_email,message,status,resolution_note,created_at')
      .in('status', ['new','reviewing']).order('created_at', { ascending: false }).limit(100),
    supabase.from('newsletter_editions')
      .select('id,edition_type,issue_date,subject,body,status,generated_at,approved_at,sent_at')
      .order('issue_date', { ascending: false }).limit(20),
  ]);
  opsData.comments = comments.data || [];
  opsData.comment_reports = commentReports.data || [];
  opsData.corrections = corrections.data || [];
  opsData.newsletters = newsletters.data || [];
  renderOps();
  await attachTrustEditors();
}

function setCount(name, value) {
  const node = document.querySelector(`[data-count="${name}"]`);
  if (node) node.textContent = value;
}

function renderOps() {
  const shell = ensureOpsShell();
  shell.querySelectorAll('.ops-tab').forEach((button) => button.dataset.active = String(button.dataset.opsTab === currentTab));
  setCount('comments', opsData.comments.filter((x) => x.moderation_status !== 'rejected').length);
  setCount('comment_reports', opsData.comment_reports.length);
  setCount('corrections', opsData.corrections.length);
  setCount('newsletters', opsData.newsletters.filter((x) => x.status === 'draft').length);
  const panel = shell.querySelector('#opsPanel');
  panel.replaceChildren();
  if (currentTab === 'comments') renderComments(panel);
  else if (currentTab === 'comment_reports') renderCommentReports(panel);
  else if (currentTab === 'corrections') renderCorrections(panel);
  else renderNewsletters(panel);
}

function emptyCard(panel, text) {
  const card = document.createElement('div'); card.className = 'ops-card'; card.textContent = text; panel.append(card);
}

function riskLevel(score) {
  const n = Number(score ?? 0);
  if (n >= 70) return 'high';
  if (n >= 35) return 'medium';
  return 'low';
}

function actionButton(label, className, handler) {
  const button = document.createElement('button'); button.type = 'button'; button.className = `button ${className}`; button.textContent = label; button.addEventListener('click', handler); return button;
}

async function updateComment(id, status, card) {
  card.querySelector('.ops-message').textContent = 'Saving…';
  const { error } = await supabase.from('community_comments').update({ moderation_status: status, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) { card.querySelector('.ops-message').textContent = error.message; return; }
  await loadOps();
}

function renderComments(panel) {
  const rows = opsData.comments;
  if (!rows.length) return emptyCard(panel, 'No comments need editorial attention.');
  rows.forEach((comment) => {
    const card = document.createElement('article'); card.className = 'ops-card';
    const top = document.createElement('div'); top.className = 'ops-card-top';
    const copy = document.createElement('div');
    const meta = document.createElement('p'); meta.className = 'ops-meta'; meta.textContent = `${comment.display_name} · ${formatDate(comment.created_at)} · ${comment.moderation_status}`;
    const story = storyMap.get(comment.story_id);
    const title = document.createElement('h3'); title.textContent = story?.headline || 'Community discussion comment';
    const body = document.createElement('p'); body.textContent = comment.body;
    const reason = document.createElement('p'); reason.className = 'ops-meta'; reason.textContent = comment.ai_moderation_reason ? `AI: ${comment.ai_moderation_reason}` : 'AI screening pending.';
    copy.append(meta,title,body,reason);
    const risk = document.createElement('span'); risk.className = 'ops-risk'; risk.dataset.risk = riskLevel(comment.ai_risk_score); risk.textContent = `Risk ${comment.ai_risk_score ?? '—'}`;
    top.append(copy,risk);
    const actions = document.createElement('div'); actions.className = 'ops-actions';
    actions.append(
      actionButton('Approve', 'primary', () => updateComment(comment.id, 'approved', card)),
      actionButton('Reject', 'danger', () => updateComment(comment.id, 'rejected', card)),
    );
    if (story) { const open = document.createElement('a'); open.className = 'button ghost'; open.href = `../story/?id=${encodeURIComponent(comment.story_id)}`; open.target = '_blank'; open.textContent = 'Open story'; actions.append(open); }
    const msg = document.createElement('span'); msg.className = 'ops-message'; actions.append(msg);
    card.append(top,actions); panel.append(card);
  });
}

async function updateReport(table, id, status, resolution, card) {
  const msg = card.querySelector('.ops-message'); msg.textContent = 'Saving…';
  const patch = { status, resolution_note: resolution || null, reviewed_at: new Date().toISOString() };
  const { error } = await supabase.from(table).update(patch).eq('id', id);
  if (error) { msg.textContent = error.message; return; }
  await loadOps();
}

function reportCard(report, type) {
  const card = document.createElement('article'); card.className = 'ops-card';
  const story = type === 'correction' ? storyMap.get(report.story_id) : null;
  const meta = document.createElement('p'); meta.className = 'ops-meta'; meta.textContent = `${formatDate(report.created_at)} · ${report.status}`;
  const title = document.createElement('h3'); title.textContent = type === 'correction' ? (story?.headline || 'Reader correction request') : 'Reported community comment';
  const text = document.createElement('p'); text.textContent = type === 'correction' ? report.message : report.reason;
  if (type === 'correction' && report.reporter_email) { const email = document.createElement('p'); email.className = 'ops-meta'; email.textContent = `Reader contact: ${report.reporter_email}`; card.append(meta,title,text,email); }
  else card.append(meta,title,text);
  const resolution = document.createElement('textarea'); resolution.rows = 2; resolution.placeholder = 'Internal resolution note'; resolution.value = report.resolution_note || '';
  const actions = document.createElement('div'); actions.className = 'ops-actions'; actions.append(resolution);
  const table = type === 'correction' ? 'reader_error_reports' : 'comment_reports';
  actions.append(
    actionButton('Reviewing', 'ghost', () => updateReport(table, report.id, 'reviewing', resolution.value.trim(), card)),
    actionButton('Resolve', 'primary', () => updateReport(table, report.id, 'resolved', resolution.value.trim(), card)),
    actionButton('Dismiss', 'danger', () => updateReport(table, report.id, 'dismissed', resolution.value.trim(), card)),
  );
  if (story) { const open = document.createElement('a'); open.className = 'button ghost'; open.href = `../story/?id=${encodeURIComponent(report.story_id)}`; open.target = '_blank'; open.textContent = 'Open story'; actions.append(open); }
  const msg = document.createElement('span'); msg.className = 'ops-message'; actions.append(msg);
  card.append(actions); return card;
}

function renderCommentReports(panel) {
  if (!opsData.comment_reports.length) return emptyCard(panel, 'No reported comments need review.');
  opsData.comment_reports.forEach((report) => panel.append(reportCard(report, 'comment')));
}
function renderCorrections(panel) {
  if (!opsData.corrections.length) return emptyCard(panel, 'No reader correction requests are waiting.');
  opsData.corrections.forEach((report) => panel.append(reportCard(report, 'correction')));
}

function renderNewsletters(panel) {
  if (!opsData.newsletters.length) return emptyCard(panel, 'No stored newsletter drafts yet. The scheduled generator will populate this desk.');
  opsData.newsletters.forEach((edition) => {
    const card = document.createElement('article'); card.className = 'ops-card';
    const meta = document.createElement('p'); meta.className = 'ops-meta'; meta.textContent = `${edition.edition_type.replace('_',' ')} · ${edition.issue_date} · ${edition.status}`;
    const title = document.createElement('h3'); title.textContent = edition.subject;
    const body = document.createElement('p'); body.textContent = edition.body;
    const actions = document.createElement('div'); actions.className = 'ops-actions';
    const copy = actionButton('Copy draft', 'ghost', async () => { await navigator.clipboard.writeText(edition.body); copy.textContent = 'Copied'; });
    actions.append(copy);
    if (edition.status === 'draft') actions.append(actionButton('Mark approved', 'primary', async () => {
      await supabase.from('newsletter_editions').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', edition.id); await loadOps();
    }));
    card.append(meta,title,body,actions); panel.append(card);
  });
}

function trustEditor(card, storyId, row = {}) {
  if (card.querySelector('.story-trust-editor')) return;
  const details = document.createElement('details'); details.className = 'story-trust-editor';
  details.innerHTML = `<summary>Public transparency / correction metadata</summary><div class="trust-editor-grid">
    <label>Published as<select class="trust-origin"><option value="aggregated_source">Curated source brief</option><option value="staff_report">Staff report</option><option value="press_release">Press release summary</option><option value="community_submission">Community submission</option><option value="public_record">Public-record brief</option><option value="other">Other</option></select></label>
    <label>Public byline<input class="trust-byline" type="text" maxlength="120"></label>
    <label>Neighborhood<input class="trust-neighborhood" type="text" maxlength="120" placeholder="Lake Shore"></label>
    <label>Timeline/topic key<input class="trust-topic" type="text" maxlength="120" placeholder="mountain-road-development"></label>
    <label class="wide">Why it matters<textarea class="trust-why" rows="3"></textarea></label>
    <label class="wide">How we reported this<textarea class="trust-how" rows="3"></textarea></label>
    <label class="wide">Visible correction notice<textarea class="trust-correction" rows="3" placeholder="Leave blank unless a correction should appear publicly"></textarea></label>
    <div class="trust-editor-actions"><span class="ops-message"></span><button class="button primary trust-save" type="button">Save public metadata</button></div>
  </div>`;
  const set = (selector, value) => { const node = details.querySelector(selector); if (node) node.value = value || ''; };
  set('.trust-origin', row.editorial_origin || 'aggregated_source'); set('.trust-byline', row.public_byline || 'Pasadena Current Desk');
  set('.trust-neighborhood', row.neighborhood); set('.trust-topic', row.topic_key); set('.trust-why', row.why_it_matters); set('.trust-how', row.how_reported); set('.trust-correction', row.correction_note);
  details.querySelector('.trust-save').addEventListener('click', async () => {
    const msg = details.querySelector('.ops-message'); msg.textContent = 'Saving…';
    const correction = details.querySelector('.trust-correction').value.trim();
    const patch = {
      story_id: storyId,
      editorial_origin: details.querySelector('.trust-origin').value,
      public_byline: details.querySelector('.trust-byline').value.trim() || 'Pasadena Current Desk',
      ai_assisted: true,
      neighborhood: details.querySelector('.trust-neighborhood').value.trim() || null,
      topic_key: details.querySelector('.trust-topic').value.trim() || null,
      why_it_matters: details.querySelector('.trust-why').value.trim() || null,
      how_reported: details.querySelector('.trust-how').value.trim() || null,
      correction_note: correction || null,
      correction_at: correction ? (row.correction_at || new Date().toISOString()) : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('story_transparency').upsert(patch, { onConflict: 'story_id' });
    msg.textContent = error ? error.message : 'Saved. Public story brief metadata updated.';
    if (!error) { trustRows.set(storyId, { ...row, ...patch }); }
  });
  card.append(details);
}

async function attachTrustEditors() {
  const cards = [...document.querySelectorAll('.story-card[data-story-id]')].filter((card) => !card.querySelector('.story-trust-editor'));
  if (!cards.length) return;
  const ids = cards.map((card) => card.dataset.storyId).filter(Boolean);
  const missing = ids.filter((id) => !trustRows.has(id));
  if (missing.length) {
    const { data } = await supabase.from('story_transparency').select('*').in('story_id', missing);
    (data || []).forEach((row) => trustRows.set(row.story_id, row));
    missing.forEach((id) => { if (!trustRows.has(id)) trustRows.set(id, {}); });
  }
  cards.forEach((card) => trustEditor(card, card.dataset.storyId, trustRows.get(card.dataset.storyId) || {}));
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver(() => attachTrustEditors());
  observer.observe(document.body, { childList: true, subtree: true });
}

async function syncSession(session) {
  if (!session?.user) return;
  ensureOpsShell();
  startObserver();
  await loadOps();
}

const { data: initial } = await supabase.auth.getSession();
await syncSession(initial.session);
supabase.auth.onAuthStateChange((_event, session) => syncSession(session));
