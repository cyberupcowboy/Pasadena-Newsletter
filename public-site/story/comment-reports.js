import { supabase } from '../lib/current.js';

const storyId = new URLSearchParams(location.search).get('id');
let approvedComments = [];

async function loadApproved() {
  if (!storyId) return;
  const { data } = await supabase.from('community_comments')
    .select('id,display_name,body,created_at')
    .eq('story_id', storyId)
    .eq('moderation_status', 'approved')
    .order('created_at', { ascending: true })
    .limit(100);
  approvedComments = data || [];
  attach();
}

function findMatch(card) {
  const name = card.querySelector('header strong')?.textContent || '';
  const body = card.querySelector(':scope > p')?.textContent || '';
  return approvedComments.find((comment) => comment.display_name === name && comment.body === body);
}

function attach() {
  document.querySelectorAll('.comment-card:not(.comment-pending)').forEach((card) => {
    if (card.querySelector('.comment-report-button')) return;
    const comment = findMatch(card);
    if (!comment) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'comment-report-button';
    button.textContent = 'Report';
    button.addEventListener('click', async () => {
      const reason = window.prompt('What should the editor review about this comment?');
      if (!reason?.trim() || reason.trim().length < 3) return;
      button.disabled = true;
      button.textContent = 'Reporting…';
      const { error } = await supabase.from('comment_reports').insert({ comment_id: comment.id, reason: reason.trim() });
      button.textContent = error ? 'Could not report' : 'Reported';
      if (error) { button.disabled = false; button.title = error.message; }
    });
    card.append(button);
  });
}

const observer = new MutationObserver(attach);
observer.observe(document.querySelector('#commentList'), { childList: true, subtree: true });
loadApproved();
