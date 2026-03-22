/** The Feed — gallery grid page. */
import { api } from '../api.js';
import { showToast } from '../app.js';

const ACTIVE_STATUSES = new Set(['queued', 'downloading', 'transcribing', 'summarizing']);

function processingCopy(status) {
  if (status === 'downloading') return { label: 'Downloading', detail: 'Fetching metadata, transcript, and assets.' };
  if (status === 'transcribing') return { label: 'Transcribing', detail: 'Subtitles unavailable — transcribing audio with Whisper.' };
  if (status === 'summarizing') return { label: 'Summarizing', detail: 'Generating the analysis and structured breakdown.' };
  return { label: 'Queued', detail: 'Waiting to start processing.' };
}

function fmtTokenCount(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString();
}

function fmtUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (n > 0 && n < 0.000001) return '<$0.000001';
  return `$${n.toFixed(6)}`;
}

function relativeTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function channelAvatar(v, bgColor) {
  if (v.channel_avatar_url) {
    return `<img class="w-full h-full object-cover" src="/api/channels/${encodeURIComponent(v.channel_id)}/avatar" alt="${esc(v.channel_name || v.channel_handle || 'Channel')}" loading="lazy" />`;
  }

  return `<div class="w-full h-full ${bgColor} flex items-center justify-center"><span class="text-[10px] font-bold">${initials(v.channel_name || 'YT')}</span></div>`;
}

function videoCard(v) {
  const status = v.processing_status || 'ready';
  const isProcessing = ACTIVE_STATUSES.has(status);
  const isFailed = status === 'failed';
  const isRead = v.is_read;
  const readOverlay = isRead && !isProcessing && !isFailed ? '<div class="absolute inset-0 bg-surface/60 backdrop-grayscale-[0.5]"></div>' : '';
  let badge = isRead
    ? '<span class="bg-surface-container-lowest/80 backdrop-blur-md text-on-surface-variant text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full">Read</span>'
    : '<span class="bg-primary text-on-primary text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full">Unread</span>';

  if (isProcessing) {
    const copy = processingCopy(status);
    badge = `<span class="bg-primary/90 text-on-primary text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full">${copy.label}</span>`;
  } else if (isFailed) {
    badge = '<span class="bg-error text-on-error text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full">Failed</span>';
  }

  const thumb = v.thumbnail_url
    ? `<img class="w-full h-full object-cover" src="${v.thumbnail_url}" alt="" loading="lazy" />`
    : '<div class="w-full h-full flex items-center justify-center bg-surface-container-lowest text-on-surface-variant text-sm">No Thumbnail</div>';
  const bgColors = ['bg-primary-container', 'bg-secondary-container', 'bg-tertiary-container', 'bg-inverse-primary', 'bg-outline'];
  const bgColor = bgColors[Math.abs(hashCode(v.channel_id)) % bgColors.length];
  const channelLabel = esc(v.channel_name || v.channel_handle || 'One-off import');
  const hasSummaryMeta = Boolean(v.has_summary);
  const modelLabel = v.llm_model ? esc(v.llm_model) : 'Unknown model';
  const tokenLabel = `${fmtTokenCount(v.total_tokens)} tokens`;
  const costLabel = fmtUsd(v.llm_cost_usd);
  const usageMeta = hasSummaryMeta
    ? `<div class="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-on-surface-variant">
         <span class="px-2 py-1 rounded-md bg-surface-container-lowest/80">${modelLabel}</span>
         <span class="px-2 py-1 rounded-md bg-surface-container-lowest/80">${tokenLabel}</span>
         ${costLabel ? `<span class="px-2 py-1 rounded-md bg-surface-container-lowest/80">${costLabel}</span>` : ''}
       </div>`
    : '';

  let footer = `
        <div class="flex items-center justify-between text-xs text-outline font-medium">
          <span>${formatDate(v.published_at)}</span>
          <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">schedule</span> ${relativeTime(v.published_at)}</span>
        </div>
        ${usageMeta}`;
  let failedActions = '';

  if (isProcessing) {
    const copy = processingCopy(status);
    footer = `
        <div class="space-y-3">
          <p class="text-sm text-primary font-semibold">${copy.label}</p>
          <p class="text-sm text-on-surface-variant leading-relaxed">${copy.detail}</p>
          <div class="h-2 rounded-full bg-surface-container-highest overflow-hidden">
            <div class="h-full w-2/3 bg-primary animate-pulse rounded-full"></div>
          </div>
        </div>`;
  } else if (isFailed) {
    footer = `
        <div class="space-y-2">
          <p class="text-sm font-semibold text-error">Processing failed</p>
          <p class="text-sm text-on-surface-variant leading-relaxed">${esc(v.processing_error || 'Open the tile to inspect the item and retry later.')}</p>
        </div>`;
    failedActions = `
      <div class="flex items-center gap-3 px-6 pb-6 pt-1">
        <button data-retry-video="${v.video_id}" class="retry-video inline-flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-semibold transition-all hover:brightness-110 active:scale-95 md-state-layer">
          <span class="material-symbols-outlined text-base">refresh</span>
          Retry
        </button>
      </div>`;
  }

  return `
    <article class="group relative bg-surface-container rounded-xl overflow-hidden hover:bg-surface-container-high transition-all duration-200 elevation-1 hover:elevation-2">
      <button data-delete-video="${v.video_id}" class="delete-video absolute right-4 top-4 z-10 h-10 w-10 rounded-full bg-surface-container-lowest/85 text-on-surface-variant opacity-0 shadow-lg backdrop-blur-md transition-all duration-200 hover:text-error group-hover:opacity-100 active:scale-95" title="Delete video">
        <span class="material-symbols-outlined text-[20px]">delete</span>
      </button>
      <a href="#/video/${v.video_id}" class="block">
        <div class="relative aspect-video">
          ${thumb}
          ${readOverlay}
          ${isProcessing ? '<div class="absolute inset-0 bg-black/20"></div>' : ''}
          <div class="absolute top-4 left-4">${badge}</div>
          ${isProcessing ? '<div class="absolute bottom-4 right-4 w-10 h-10 rounded-full bg-surface-container-lowest/80 backdrop-blur-md flex items-center justify-center"><span class="material-symbols-outlined text-primary animate-spin">progress_activity</span></div>' : ''}
        </div>
        <div class="p-6">
          <div class="flex items-center gap-2 mb-3">
            <div class="w-6 h-6 rounded-full overflow-hidden bg-surface-container-lowest">
              ${channelAvatar(v, bgColor)}
            </div>
            <span class="text-xs font-medium text-on-surface-variant">${channelLabel}</span>
          </div>
          <h3 class="text-xl font-bold leading-snug mb-4 whitespace-normal break-words group-hover:text-primary transition-colors">${esc(v.title)}</h3>
          ${footer}
        </div>
      </a>
      ${failedActions}
    </article>`;
}

function hashCode(s) {
  let h = 0;
  for (let i = 0; i < (s || '').length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

export async function renderFeed(container) {
  let status = 'all';
  let channelId = '';
  let sortBy = 'published';
  let sortOrder = 'desc';
  let page = 1;
  let perPage = 24;
  let refreshTimer = 0;

  const channels = await api.getChannels();

  async function load() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = 0;
    }
    const params = { status, page, limit: perPage, sort: sortBy, order: sortOrder };
    if (channelId) params.channel_id = channelId;
    const data = await api.getVideos(params);
    render(data, channels);
  }

  function render(data, channels) {
    const filterChips = ['all', 'unread', 'read', 'failed'].map(s =>
      `<button data-status="${s}" class="filter-chip ${s === status ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-high'} px-5 py-2.5 rounded-lg font-medium text-sm transition-all whitespace-nowrap">${s.charAt(0).toUpperCase() + s.slice(1)}</button>`
    ).join('');

    const selectedChannel = channels.find(c => c.channel_id === channelId);
    const channelLabel = selectedChannel ? esc(selectedChannel.name || selectedChannel.handle || selectedChannel.channel_id) : 'All Channels';
    const channelAvatarThumb = selectedChannel && selectedChannel.avatar_url
      ? `<img class="w-5 h-5 rounded-full object-cover" src="/api/channels/${encodeURIComponent(selectedChannel.channel_id)}/avatar" />`
      : '';

    const channelItems = [
      `<button data-ch-value="" class="ch-option flex items-center gap-3 w-full px-4 py-2.5 text-sm text-left hover:bg-surface-container-high transition-colors ${!channelId ? 'text-primary font-semibold' : 'text-on-surface'}">All Channels</button>`
    ].concat(channels.map(c => {
      const av = c.avatar_url
        ? `<img class="w-6 h-6 rounded-full object-cover shrink-0" src="/api/channels/${encodeURIComponent(c.channel_id)}/avatar" />`
        : `<div class="w-6 h-6 rounded-full bg-surface-variant flex items-center justify-center shrink-0"><span class="text-[10px] font-bold text-on-surface">${initials(c.name || 'YT')}</span></div>`;
      const active = c.channel_id === channelId;
      return `<button data-ch-value="${c.channel_id}" class="ch-option flex items-center gap-3 w-full px-4 py-2.5 text-sm text-left hover:bg-surface-container-high transition-colors ${active ? 'text-primary font-semibold' : 'text-on-surface'}">${av}<span class="truncate">${esc(c.name || c.handle || c.channel_id)}</span></button>`;
    })).join('');

    const sortFields = [
      { sort: 'published', label: 'Published' },
      { sort: 'analyzed',  label: 'Analyzed' },
    ];
    const sortLabel = sortFields.find(s => s.sort === sortBy)?.label || 'Published';
    const sortItems = sortFields.map(s => {
      return `<button data-sort-value="${s.sort}" class="sort-option w-full px-4 py-2.5 text-sm text-left hover:bg-surface-container-high transition-colors ${s.sort === sortBy ? 'text-primary font-semibold' : 'text-on-surface'}">${s.label}</button>`;
    }).join('');
    const dirIcon = sortOrder === 'desc' ? 'arrow_downward' : 'arrow_upward';
    const dirTip = sortOrder === 'desc' ? 'Newest first' : 'Oldest first';

    const cards = data.items.map(videoCard).join('');
    const totalPages = Math.ceil(data.total / data.limit) || 1;

    container.innerHTML = `
      <main class="w-full max-w-none px-6 py-12 sm:px-8 xl:px-12 2xl:px-16">
        <section class="flex flex-wrap items-center gap-3 mb-10">
          <div class="flex items-center bg-surface-container rounded-xl p-1.5 gap-1">
            ${filterChips}
          </div>
          <div class="relative" id="channel-dropdown">
            <button id="channel-toggle" class="flex items-center gap-2 bg-surface-container rounded-xl px-4 h-11 text-sm text-on-surface hover:bg-surface-container-high transition-colors">
              ${channelAvatarThumb}
              <span class="truncate max-w-[10rem]">${channelLabel}</span>
              <span class="material-symbols-outlined text-base text-on-surface-variant ml-1">expand_more</span>
            </button>
            <div id="channel-menu" class="hidden absolute top-full left-0 mt-1 z-50 bg-surface-container-high rounded-xl py-2 shadow-xl border border-outline-variant/10 min-w-[14rem] max-h-72 overflow-y-auto">
              ${channelItems}
            </div>
          </div>
          <div class="flex items-center gap-1">
            <div class="relative" id="sort-dropdown">
              <button id="sort-toggle" class="flex items-center gap-2 bg-surface-container rounded-xl px-4 h-11 text-sm text-on-surface hover:bg-surface-container-high transition-colors">
                <span>${sortLabel}</span>
                <span class="material-symbols-outlined text-base text-on-surface-variant ml-1">expand_more</span>
              </button>
              <div id="sort-menu" class="hidden absolute top-full left-0 mt-1 z-50 bg-surface-container-high rounded-xl py-2 shadow-xl border border-outline-variant/10 min-w-[10rem]">
                ${sortItems}
              </div>
            </div>
            <button id="sort-dir-toggle" title="${dirTip}" class="flex items-center justify-center bg-surface-container rounded-xl w-11 h-11 text-on-surface hover:bg-surface-container-high transition-colors">
              <span class="material-symbols-outlined text-xl">${dirIcon}</span>
            </button>
          </div>
        </section>
        <div class="asymmetric-grid gap-8">
          ${cards || '<p class="col-span-full text-center text-on-surface-variant py-16 text-lg">No videos yet. Add channels and refresh feeds to get started.</p>'}
        </div>
        <div class="flex justify-center items-center gap-3 mt-12">
          ${totalPages > 1 ? `
          <button id="prev-page" class="px-4 py-2 bg-secondary-container text-on-secondary-container rounded-lg text-sm font-semibold ${page <= 1 ? 'opacity-30 pointer-events-none' : 'hover:bg-surface-container-high md-state-layer'}">Previous</button>
          <span class="px-4 py-2 text-on-surface-variant text-sm">${page} / ${totalPages}</span>
          <button id="next-page" class="px-4 py-2 bg-secondary-container text-on-secondary-container rounded-lg text-sm font-semibold ${page >= totalPages ? 'opacity-30 pointer-events-none' : 'hover:bg-surface-container-high md-state-layer'}">Next</button>
          ` : ''}
          <select id="per-page" class="bg-surface-container text-on-surface text-sm rounded-lg px-3 py-2 border-none outline-none cursor-pointer hover:bg-surface-container-high transition-colors">
            ${[12, 24, 48, 96].map(n => `<option value="${n}" ${n === perPage ? 'selected' : ''}>${n} / page</option>`).join('')}
          </select>
        </div>
      </main>`;

    // Bind events
    container.querySelectorAll('.filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        status = btn.dataset.status;
        page = 1;
        load();
      });
    });

    const chFilter = container.querySelector('#channel-toggle');
    const chMenu = container.querySelector('#channel-menu');
    if (chFilter) chFilter.addEventListener('click', (e) => {
      e.stopPropagation();
      sortMenu?.classList.add('hidden');
      chMenu.classList.toggle('hidden');
    });
    container.querySelectorAll('.ch-option').forEach(btn => {
      btn.addEventListener('click', () => {
        channelId = btn.dataset.chValue;
        page = 1;
        load();
      });
    });

    const sortToggle = container.querySelector('#sort-toggle');
    const sortMenu = container.querySelector('#sort-menu');
    if (sortToggle) sortToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      chMenu?.classList.add('hidden');
      sortMenu.classList.toggle('hidden');
    });
    container.querySelectorAll('.sort-option').forEach(btn => {
      btn.addEventListener('click', () => {
        sortBy = btn.dataset.sortValue;
        page = 1;
        load();
      });
    });

    const sortDirToggle = container.querySelector('#sort-dir-toggle');
    if (sortDirToggle) sortDirToggle.addEventListener('click', () => {
      sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
      page = 1;
      load();
    });

    // Close dropdowns on outside click
    const closeDropdowns = (e) => {
      if (!container.querySelector('#channel-dropdown')?.contains(e.target)) chMenu?.classList.add('hidden');
      if (!container.querySelector('#sort-dropdown')?.contains(e.target)) sortMenu?.classList.add('hidden');
    };
    document.addEventListener('click', closeDropdowns);
    // Clean up on next render
    container._cleanupDropdowns?.();
    container._cleanupDropdowns = () => document.removeEventListener('click', closeDropdowns);

    const prev = container.querySelector('#prev-page');
    const next = container.querySelector('#next-page');
    if (prev) prev.addEventListener('click', () => { page--; load(); });
    if (next) next.addEventListener('click', () => { page++; load(); });

    const perPageSelect = container.querySelector('#per-page');
    if (perPageSelect) perPageSelect.addEventListener('change', () => {
      perPage = Number(perPageSelect.value);
      page = 1;
      load();
    });

    container.querySelectorAll('.retry-video').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api.retryVideo(btn.dataset.retryVideo);
          showToast('Retry started', 'Video added back to the processing queue.');
          await load();
        } catch (err) {
          showToast('Error', err.message);
        }
      });
    });

    container.querySelectorAll('.delete-video').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const check = await api.checkVideoDelete(btn.dataset.deleteVideo);
          const msg = check.will_redownload
            ? 'This video belongs to a subscribed channel and is within the automatic download range. It will be downloaded again on the next poll.\n\nDelete anyway?'
            : 'Delete this video from the library?';
          if (!confirm(msg)) return;
          await api.deleteVideo(btn.dataset.deleteVideo);
          showToast('Deleted', 'Video removed from the library.');
          await load();
        } catch (err) {
          showToast('Error', err.message);
        }
      });
    });

    if (data.items.some(item => ACTIVE_STATUSES.has(item.processing_status))) {
      refreshTimer = window.setTimeout(() => {
        if (!location.hash || location.hash === '#/') load().catch(err => showToast('Error', err.message));
      }, 3000);
    }
  }

  await load();
}
