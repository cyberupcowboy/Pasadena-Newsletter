import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/+esm';

export const SUPABASE_URL = 'https://eedpedkvymohcubdaoey.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_6RReetP9MPYS_xn0k6xzrw_AVBbgBRs';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export function formatDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', options).format(new Date(value));
}

export function formatDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

export function labelCategory(value) {
  if (!value) return 'Community';
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function publisherFromUrl(value) {
  try {
    const host = new URL(value).hostname.replace(/^www\./, '').toLowerCase();
    const known = {
      'marylandmatters.org': 'Maryland Matters',
      'wbaltv.com': 'WBAL-TV 11',
      'foxbaltimore.com': 'FOX45 Baltimore',
      'wtop.com': 'WTOP News',
      'apnews.com': 'Associated Press',
      'reuters.com': 'Reuters',
      'npr.org': 'NPR',
      'foxnews.com': 'Fox News',
      'cnn.com': 'CNN',
      'thehill.com': 'The Hill',
      'eyeonannapolis.net': 'Eye On Annapolis',
      'aacounty.org': 'Anne Arundel County',
      'aacps.org': 'AACPS',
      'aahealth.org': 'Anne Arundel County Health Department',
      'news.maryland.gov': 'State of Maryland',
    };
    return known[host] || host;
  } catch {
    return 'Original source';
  }
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function storyHref(storyId, prefix = '.') {
  return `${prefix}/story/?id=${encodeURIComponent(storyId)}`;
}
