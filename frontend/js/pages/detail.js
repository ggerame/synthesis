/** Video Detail page. */
import { api } from '../api.js';
import { showToast } from '../app.js';

const ACTIVE_STATUSES = new Set(['queued', 'downloading', 'transcribing', 'summarizing']);

function processingCopy(status) {
  if (status === 'downloading') return { label: 'Downloading', detail: 'Fetching metadata, subtitles, and transcript now.' };
  if (status === 'transcribing') return { label: 'Transcribing', detail: 'Subtitles unavailable — transcribing audio with Whisper.' };
  if (status === 'summarizing') return { label: 'Summarizing', detail: 'Generating the final analysis, key points, and chapters.' };
  return { label: 'Queued', detail: 'This video is waiting for processing to start.' };
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function channelAvatar(v) {
  if (v.channel_avatar_url) {
    return `<img class="w-full h-full object-cover" src="/api/channels/${encodeURIComponent(v.channel_id)}/avatar" alt="${esc(v.channel_name || 'Channel')}" loading="lazy" />`;
  }

  return `<div class="w-full h-full bg-primary-container flex items-center justify-center text-primary text-xs font-bold">${initials(v.channel_name || 'YT')}</div>`;
}

function fmtTimestamp(secs) {
  const h = String(Math.floor(secs / 3600)).padStart(2, '0');
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function ytUrlWithTime(url, secs) {
  if (!url) return '#';
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}t=${secs}`;
}

function fmtTokenCount(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString();
}

function fmtUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'N/A';
  if (n > 0 && n < 0.000001) return '< $0.000001';
  return `$${n.toFixed(6)}`;
}

export async function renderDetail(container, videoId) {
  const v = await api.getVideo(videoId);
  const summary = v.summary;
  const chapters = v.chapters || [];
  const keyPoints = summary ? summary.key_points : [];
  const isProcessing = ACTIVE_STATUSES.has(v.processing_status);
  const isFailed = v.processing_status === 'failed';

  const thumbImg = v.thumbnail_url
    ? `<img alt="${esc(v.title)}" class="w-full h-full object-cover" src="${v.thumbnail_url}" />`
    : '<div class="w-full h-full bg-surface-container-lowest"></div>';

  const sourcePreview = `
    <div class="bg-surface-container rounded-xl overflow-hidden elevation-2 relative">
      <div class="relative aspect-[16/10] bg-surface-container-lowest">
        ${thumbImg}
      </div>
      <div class="p-6 space-y-4">
        <div>
          <p class="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">Source Video</p>
          <p class="text-sm text-on-surface-variant leading-relaxed">Open the original video in a new tab when you need full playback.</p>
        </div>
        <a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer"
           class="block w-full py-3 bg-primary text-on-primary rounded-lg font-bold elevation-1 hover:elevation-2 transition-all text-center">
          <span class="material-symbols-outlined text-sm align-middle mr-1">open_in_new</span>
          Watch on YouTube
        </a>
      </div>
    </div>`;

  const chapterItems = chapters.map((ch) => {
    const ts = fmtTimestamp(ch.timestamp_seconds);
    return `
      <a href="${ytUrlWithTime(v.url, ch.timestamp_seconds)}" target="_blank" rel="noopener noreferrer"
         class="w-full text-left p-4 rounded-lg hover:bg-surface-container-high transition-all group flex items-start gap-4">
        <span class="font-mono text-primary text-sm pt-1">${ts}</span>
        <div class="flex-1">
          <p class="font-semibold text-on-surface group-hover:text-primary transition-colors">${esc(ch.title)}</p>
          <p class="text-xs text-on-surface-variant mt-1 leading-snug">${esc(ch.description)}</p>
        </div>
      </a>`;
  }).join('');

  const llmModel = summary ? (summary.llm_model || 'Unknown model') : '';
  const llmCost = summary && summary.llm_cost_usd ? fmtUsd(summary.llm_cost_usd) : 'Not available';

  const statCards = summary ? `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
      <div class="bg-surface-container-low p-6 rounded-xl border-l-2 border-primary">
        <p class="text-xs text-on-surface-variant uppercase tracking-widest mb-1">Total Tokens</p>
        <p class="text-2xl font-bold text-on-surface">${fmtTokenCount(summary.total_tokens)}</p>
        <p class="text-xs text-on-surface-variant mt-2">${fmtTokenCount(summary.prompt_tokens)} input • ${fmtTokenCount(summary.completion_tokens)} output</p>
      </div>
      <div class="bg-surface-container-low p-6 rounded-xl border-l-2 border-tertiary">
        <p class="text-xs text-on-surface-variant uppercase tracking-widest mb-1">Estimated Cost</p>
        <p class="text-2xl font-bold text-on-surface">${llmCost}</p>
        <p class="text-xs text-on-surface-variant mt-2">${esc(llmModel)}</p>
      </div>
    </div>` : `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
      <div class="bg-surface-container-low p-6 rounded-xl border-l-2 border-primary">
        <p class="text-xs text-on-surface-variant uppercase tracking-widest mb-1">Total Tokens</p>
        <p class="text-2xl font-bold text-on-surface">Not available</p>
      </div>
      <div class="bg-surface-container-low p-6 rounded-xl border-l-2 border-tertiary">
        <p class="text-xs text-on-surface-variant uppercase tracking-widest mb-1">Estimated Cost</p>
        <p class="text-2xl font-bold text-on-surface">Not available</p>
      </div>
    </div>`;

  const processingPanel = isProcessing
    ? (() => {
        const copy = processingCopy(v.processing_status);
        return `
          <div class="bg-surface-container-low rounded-xl p-6 border border-primary/20 space-y-3">
            <div class="flex items-center gap-3 text-primary">
              <span class="material-symbols-outlined animate-spin">progress_activity</span>
              <span class="text-sm font-bold uppercase tracking-widest">${copy.label}</span>
            </div>
            <p class="text-on-surface-variant leading-relaxed">${copy.detail}</p>
            <div class="h-2 rounded-full bg-surface-container-highest overflow-hidden">
              <div class="h-full w-2/3 bg-primary animate-pulse rounded-full"></div>
            </div>
          </div>`;
      })()
    : '';

  const failedPanel = isFailed
    ? `
      <div class="bg-surface-container-low rounded-xl p-6 border border-error/20 space-y-3">
        <div class="flex items-center gap-3 text-error">
          <span class="material-symbols-outlined">error</span>
          <span class="text-sm font-bold uppercase tracking-widest">Processing Failed</span>
        </div>
        <p class="text-on-surface-variant leading-relaxed">${esc(v.processing_error || 'The video could not be analyzed. You can retry it later.')}</p>
      </div>`
    : '';

  const summaryHtml = summary ? summary.summary_text.split('\n\n').map(p =>
    `<p class="text-lg text-on-surface-variant leading-relaxed font-light">${esc(p)}</p>`
  ).join('') : `${processingPanel || failedPanel || '<p class="text-on-surface-variant">No summary yet.</p>'}`;

  const keyPointsHtml = keyPoints.length ? `
    <ul class="list-disc list-inside space-y-2 text-on-surface-variant">
      ${keyPoints.map(kp => `<li>${esc(kp)}</li>`).join('')}
    </ul>` : '';

  const engineLine = summary && summary.llm_model
    ? `This analysis was generated automatically by Synthesis using ${esc(summary.llm_model)}.`
    : 'This analysis was generated automatically by Synthesis.';

  const readBtn = v.is_read
    ? `<button id="toggle-read" class="px-4 py-2 bg-secondary-container text-on-secondary-container rounded-lg text-sm font-semibold md-state-layer">Mark Unread</button>`
    : `<button id="toggle-read" class="px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-semibold md-state-layer">Mark Read</button>`;
  const retryBtn = isFailed
    ? `<button id="retry-video" class="px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-semibold md-state-layer">Retry Analysis</button>`
    : '';
  const deleteBtn = `<button id="delete-video" class="px-4 py-2 bg-surface-container-high text-error rounded-lg text-sm font-semibold hover:bg-error-container/20 transition-colors md-state-layer">Delete Video</button>`;

  container.innerHTML = `
    <main class="w-full max-w-none px-6 py-12 sm:px-8 xl:px-12 2xl:px-16 lg:grid lg:grid-cols-12 lg:gap-16">
      <div class="lg:col-span-8 space-y-12">
        <!-- Executive Summary -->
        <section class="space-y-6">
          <div class="flex items-center gap-3">
            <div class="h-px flex-1 bg-gradient-to-r from-transparent via-outline-variant/30 to-transparent"></div>
            <h2 class="text-sm font-bold tracking-widest text-primary uppercase">Executive Summary</h2>
            <div class="h-px flex-1 bg-gradient-to-r from-transparent via-outline-variant/30 to-transparent"></div>
          </div>
          <div class="space-y-4">
            <h1 class="text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight whitespace-normal break-words">${esc(v.title)}</h1>
            <div class="flex items-center gap-3 flex-wrap">
              <span class="inline-flex items-center gap-3 rounded-full bg-surface-container-low px-3 py-2">
                <span class="h-8 w-8 overflow-hidden rounded-full bg-surface-container-lowest">
                  ${channelAvatar(v)}
                </span>
                <span class="text-sm text-on-surface-variant">${esc(v.channel_name || v.channel_handle || 'Channel')}</span>
              </span>
              ${readBtn}
              ${retryBtn}
              ${deleteBtn}
            </div>
            ${summaryHtml}
          </div>
          ${keyPointsHtml ? `
          <div class="space-y-4 pt-2">
            <h3 class="text-sm font-bold tracking-widest text-primary uppercase">Key Points</h3>
            ${keyPointsHtml}
          </div>` : ''}
          ${statCards}
        </section>
      </div>

      <!-- Right column -->
      <aside class="lg:col-span-4 mt-12 lg:mt-0 space-y-8">
        ${sourcePreview}

        ${chapters.length ? `
        <div class="bg-surface-container rounded-xl p-8 elevation-2 relative overflow-hidden">
          <div class="absolute -top-24 -right-24 h-48 w-48 bg-primary/10 blur-[80px] rounded-full"></div>
          <h3 class="text-xl font-bold mb-8 flex items-center gap-2">
            <span class="material-symbols-outlined text-primary">segment</span>
            Structured Chapters
          </h3>
          <div class="space-y-2">${chapterItems}</div>
        </div>` : ''}

        <div class="bg-surface-container-low rounded-xl p-8 space-y-6">
          <div class="space-y-4">
            <h4 class="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Metadata</h4>
            ${summary ? `<div class="flex flex-wrap gap-2">
              <span class="px-3 py-1 rounded-lg bg-secondary-container text-on-secondary-container text-xs font-medium">${esc(summary.language)}</span>
              <span class="px-3 py-1 rounded-lg bg-secondary-container text-on-secondary-container text-xs font-medium">${esc(summary.primary_topic)}</span>
            </div>` : ''}
          </div>
          <div class="pt-6 border-t border-outline-variant/10 space-y-4">
            <div class="flex justify-between items-center text-sm">
              <span class="text-on-surface-variant">Published</span>
              <span class="text-on-surface font-semibold">${v.published_at ? new Date(v.published_at).toLocaleDateString() : 'N/A'}</span>
            </div>
            ${summary ? `<div class="flex justify-between items-center text-sm">
              <span class="text-on-surface-variant">Analyzed</span>
              <span class="text-on-surface font-semibold">${new Date(summary.created_at).toLocaleDateString()}</span>
            </div>` : ''}
            <div class="flex justify-between items-center text-sm">
              <span class="text-on-surface-variant">Status</span>
              <span class="text-on-surface font-semibold capitalize">${esc(v.processing_status || 'ready')}</span>
            </div>
            ${summary ? `<div class="flex justify-between items-center gap-4 text-sm">
              <span class="text-on-surface-variant">LLM Model</span>
              <span class="text-on-surface font-semibold text-right break-all">${esc(llmModel)}</span>
            </div>` : ''}
            ${summary ? `<div class="flex justify-between items-center text-sm">
              <span class="text-on-surface-variant">Tokens</span>
              <span class="text-on-surface font-semibold">${fmtTokenCount(summary.total_tokens)}</span>
            </div>` : ''}
            ${summary ? `<div class="flex justify-between items-center text-sm">
              <span class="text-on-surface-variant">Input / Output</span>
              <span class="text-on-surface font-semibold">${fmtTokenCount(summary.prompt_tokens)} / ${fmtTokenCount(summary.completion_tokens)}</span>
            </div>` : ''}
            ${summary ? `<div class="flex justify-between items-center text-sm">
              <span class="text-on-surface-variant">Estimated Cost</span>
              <span class="text-on-surface font-semibold">${llmCost}</span>
            </div>` : ''}
            <div class="flex justify-between items-center text-sm">
              <span class="text-on-surface-variant">Source</span>
              <a href="${esc(v.url)}" target="_blank" rel="noopener noreferrer" class="text-primary font-semibold hover:underline">YouTube</a>
            </div>
          </div>
        </div>
      </aside>
    </main>

    <section class="w-full max-w-none px-6 pb-24 sm:px-8 xl:px-12 2xl:px-16">
      <div class="bg-surface-container-lowest rounded-2xl p-10 border border-outline-variant/10 relative overflow-hidden">
        <div class="absolute top-0 right-0 p-8">
          <span class="material-symbols-outlined text-8xl text-primary/5 select-none">neurology</span>
        </div>
        <div class="relative z-10 max-w-2xl">
          <h3 class="text-2xl font-bold mb-4">Synthesis Intelligence Engine</h3>
          <p class="text-on-surface-variant mb-8 leading-relaxed">
            ${engineLine}
          </p>
          <a href="#/" class="px-6 py-3 rounded-lg border border-primary text-primary font-bold hover:bg-primary/5 transition-colors md-state-layer">
            Back to Library
          </a>
        </div>
      </div>
    </section>`;

  // Toggle read/unread
  container.querySelector('#toggle-read')?.addEventListener('click', async () => {
    await api.patchVideo(v.video_id, { is_read: !v.is_read });
    showToast('Updated', v.is_read ? 'Marked as unread' : 'Marked as read');
    renderDetail(container, videoId);
  });

  container.querySelector('#retry-video')?.addEventListener('click', async () => {
    try {
      await api.retryVideo(v.video_id);
      showToast('Retry started', 'Video added back to the processing queue.');
      renderDetail(container, videoId);
    } catch (err) {
      showToast('Error', err.message);
    }
  });

  container.querySelector('#delete-video')?.addEventListener('click', async () => {
    try {
      const check = await api.checkVideoDelete(v.video_id);
      const msg = check.will_redownload
        ? 'This video belongs to a subscribed channel and is within the automatic download range. It will be downloaded again on the next poll.\n\nDelete anyway?'
        : 'Delete this video from the library?';
      if (!confirm(msg)) return;
      await api.deleteVideo(v.video_id);
      showToast('Deleted', 'Video removed from the library.');
      location.hash = '#/';
    } catch (err) {
      showToast('Error', err.message);
    }
  });

  if (isProcessing) {
    window.setTimeout(() => {
      if (location.hash === `#/video/${videoId}`) renderDetail(container, videoId);
    }, 3000);
  }
}
