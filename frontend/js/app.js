/** Client-side hash router, global state, page mounting. */

import { api } from './api.js';
import { renderFeed } from './pages/feed.js';
import { renderDetail } from './pages/detail.js';
import { renderSettings } from './pages/settings.js';

const appEl = document.getElementById('app');

// ── Toast helper ──────────────────────────────────────────────────────
export function showToast(title, msg) {
  const t = document.getElementById('toast');
  document.getElementById('toast-title').textContent = title;
  document.getElementById('toast-msg').textContent = msg;
  t.classList.remove('translate-y-24', 'opacity-0', 'pointer-events-none');
  setTimeout(() => t.classList.add('translate-y-24', 'opacity-0', 'pointer-events-none'), 3000);
}

// ── Router ────────────────────────────────────────────────────────────
function getRoute() {
  const hash = location.hash || '#/';
  if (hash.startsWith('#/video/')) return { page: 'detail', id: hash.slice(8) };
  if (hash === '#/settings') return { page: 'settings' };
  return { page: 'feed' };
}

function updateNavHighlight(page) {
  document.querySelectorAll('.nav-link').forEach(a => {
    const p = a.dataset.page;
    if (p === page) {
      a.style.color = 'var(--header-accent)';
      a.classList.add('font-semibold');
    } else {
      a.style.color = 'var(--header-muted)';
      a.classList.remove('font-semibold');
    }
  });
}


function setPageHeader(page, detailTitle) {
  const titleEl = document.getElementById('page-title');
  const subtitleEl = document.getElementById('page-subtitle');
  if (!titleEl || !subtitleEl) return;
  if (page === 'feed') {
    titleEl.textContent = 'The Feed';
    subtitleEl.textContent = 'A curated intelligence stream of your latest videos.';
  } else if (page === 'settings') {
    titleEl.textContent = 'Configuration';
    subtitleEl.textContent = 'Adjust your intelligence parameters, API endpoints, and whisper transcription protocols.';
  } else if (page === 'detail') {
    titleEl.textContent = detailTitle || 'Video Detail';
    subtitleEl.textContent = 'Summary, chapters, and analysis for this video.';
  } else {
    titleEl.textContent = '';
    subtitleEl.textContent = '';
  }
}

async function route() {
  const r = getRoute();
  updateNavHighlight(r.page);
  if (r.page === 'detail') {
    // Show loading first, then update header after fetching video
    setPageHeader('detail', '');
    appEl.innerHTML = '<div class="flex items-center justify-center py-32"><span class="material-symbols-outlined text-primary animate-spin text-4xl">progress_activity</span></div>';
    try {
      // Fetch video title for header
      const v = await api.getVideo(r.id);
      setPageHeader('detail', v.title);
      await renderDetail(appEl, r.id);
    } catch (err) {
      appEl.innerHTML = `<div class="max-w-xl mx-auto py-32 text-center"><p class="text-error text-lg">${err.message}</p></div>`;
    }
  } else if (r.page === 'settings') {
    setPageHeader('settings');
    appEl.innerHTML = '<div class="flex items-center justify-center py-32"><span class="material-symbols-outlined text-primary animate-spin text-4xl">progress_activity</span></div>';
    try {
      await renderSettings(appEl);
    } catch (err) {
      appEl.innerHTML = `<div class="max-w-xl mx-auto py-32 text-center"><p class="text-error text-lg">${err.message}</p></div>`;
    }
  } else {
    setPageHeader('feed');
    appEl.innerHTML = '<div class="flex items-center justify-center py-32"><span class="material-symbols-outlined text-primary animate-spin text-4xl">progress_activity</span></div>';
    try {
      await renderFeed(appEl);
    } catch (err) {
      appEl.innerHTML = `<div class="max-w-xl mx-auto py-32 text-center"><p class="text-error text-lg">${err.message}</p></div>`;
    }
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);

// ── Total cost badge ──────────────────────────────────────────────────
async function refreshTotalCost() {
  try {
    const { total_cost_usd } = await api.totalCost();
    const el = document.getElementById('total-cost-value');
    if (el) el.textContent = `$${total_cost_usd.toFixed(4)}`;
  } catch (_) { /* silent */ }
}
window.addEventListener('DOMContentLoaded', refreshTotalCost);
// Also refresh after every route change (new summaries may have been created)
window.addEventListener('hashchange', refreshTotalCost);

// ── Global buttons ────────────────────────────────────────────────────
document.getElementById('btn-refresh').addEventListener('click', async () => {
  try {
    await api.refresh();
    showToast('Synchronized', 'Feed poll started.');
    // Re-render the current page so any queued / in-progress videos appear
    await route();
    refreshTotalCost();
  } catch (e) { showToast('Error', e.message); }
});

// ── Theme toggle ──────────────────────────────────────────────────────
function updateThemeIcon() {
  const icon = document.getElementById('theme-icon');
  icon.textContent = document.documentElement.classList.contains('dark') ? 'light_mode' : 'dark_mode';
}
updateThemeIcon();

document.getElementById('btn-theme').addEventListener('click', () => {
  document.documentElement.classList.toggle('dark');
  const isDark = document.documentElement.classList.contains('dark');
  localStorage.setItem('synthesis-theme', isDark ? 'dark' : 'light');
  updateThemeIcon();
});

// Smart add modal — detects video URL vs channel handle/ID
const addModal = document.getElementById('add-modal');
const addInput = document.getElementById('add-input');
const addHint = document.getElementById('add-hint');
let addPending = false;

function detectInputType(val) {
  if (/(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/)/.test(val)) return 'video';
  if (val.startsWith('UC') && val.length > 10) return 'channel_id';
  // YouTube channel URL: extract handle
  const chanMatch = val.match(/youtube\.com\/(@[A-Za-z0-9._-]+)/);
  if (chanMatch) return 'channel_url';
  const chanIdMatch = val.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]+)/);
  if (chanIdMatch) return 'channel_id_url';
  return 'handle';
}

function extractValue(val, type) {
  if (type === 'channel_url') {
    const m = val.match(/youtube\.com\/@([A-Za-z0-9._-]+)/);
    return m ? m[1] : val;
  }
  if (type === 'channel_id_url') {
    const m = val.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]+)/);
    return m ? m[1] : val;
  }
  return val;
}

addInput.addEventListener('input', () => {
  const val = addInput.value.trim();
  if (!val) { addHint.textContent = ''; return; }
  const type = detectInputType(val);
  if (type === 'video') addHint.textContent = 'Detected: Video URL \u2014 will summarize this single video';
  else if (type === 'channel_id' || type === 'channel_id_url') addHint.textContent = 'Detected: Channel ID \u2014 will subscribe to this channel';
  else if (type === 'channel_url') addHint.textContent = 'Detected: Channel URL \u2014 will subscribe to this channel';
  else addHint.textContent = 'Detected: Handle — will subscribe to this channel';
});

document.getElementById('btn-add').addEventListener('click', () => {
  if (addPending) return;
  addInput.value = '';
  addHint.textContent = '';
  addModal.classList.replace('hidden', 'flex');
  requestAnimationFrame(() => addInput.focus());
});
document.getElementById('add-cancel').addEventListener('click', () => addModal.classList.replace('flex', 'hidden'));
document.getElementById('add-confirm').addEventListener('click', async () => {
  if (addPending) return;
  const val = addInput.value.trim();
  if (!val) return;
  const type = detectInputType(val);
  const extracted = extractValue(val, type);

  addPending = true;
  addModal.classList.replace('flex', 'hidden');
  addInput.value = '';
  addHint.textContent = '';

  try {
    if (type === 'video') {
      await api.summarizeUrl(val);
      showToast('Queued', 'Video added to the processing queue.');
    } else if (type === 'channel_id' || type === 'channel_id_url') {
      await api.addChannel({ channel_id: extracted });
      showToast('Channel Added', 'Channel subscribed and initial fetch started.');
    } else {
      await api.addChannel({ handle: extracted });
      showToast('Channel Added', 'Channel subscribed and initial fetch started.');
    }
    await route();
  } catch (e) {
    showToast('Error', e.message);
  } finally {
    addPending = false;
  }
});
