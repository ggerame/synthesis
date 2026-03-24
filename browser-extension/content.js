/* Synthesis – YouTube content script.
   Detects watch pages, queries the backend for summaries,
   and injects a panel into the YouTube UI. */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────
  const CONTAINER_ID = 'synthesis-ext-root';
  const POLL_INTERVAL_MS = 5000;
  const MAX_POLL_ATTEMPTS = 120; // ~10 min

  // ── State ──────────────────────────────────────────────────────────
  let currentVideoId = null;
  let pollTimer = null;
  let pollCount = 0;

  // ── Utilities ──────────────────────────────────────────────────────

  function getVideoId() {
    try {
      return new URL(window.location.href).searchParams.get('v') || null;
    } catch {
      return null;
    }
  }

  function isWatchPage() {
    return window.location.pathname === '/watch' && !!getVideoId();
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve(resp);
        }
      });
    });
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function fmtTime(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function seekTo(seconds) {
    const video = document.querySelector('video');
    if (video) video.currentTime = seconds;
  }

  // ── DOM helpers ────────────────────────────────────────────────────

  function waitForElement(selector, maxWait = 5000) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) { resolve(existing); return; }

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => { observer.disconnect(); resolve(document.querySelector(selector)); }, maxWait);
    });
  }

  function getOrCreateContainer() {
    let c = document.getElementById(CONTAINER_ID);
    if (c) return c;

    c = document.createElement('div');
    c.id = CONTAINER_ID;

    // Try: below metadata, before comments
    const below = document.querySelector('ytd-watch-flexy #below');
    if (below) {
      const comments = below.querySelector('ytd-comments');
      if (comments) { below.insertBefore(c, comments); return c; }
      below.appendChild(c);
      return c;
    }
    // Fallback: primary column
    const primary = document.querySelector('ytd-watch-flexy #primary');
    if (primary) { primary.appendChild(c); return c; }

    return null;
  }

  function removeContainer() {
    const c = document.getElementById(CONTAINER_ID);
    if (c) c.remove();
  }

  // ── SVG icons (inline) ────────────────────────────────────────────

  const ICON_LOGO = `<svg class="synth-icon" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.5 14.5-4.5-4.5 1.41-1.42L10.5 13.67l6.09-6.09L18 9l-7.5 7.5Z"/></svg>`;
  const ICON_WARN = `<svg class="synth-icon" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z"/></svg>`;
  const ICON_ADD = `<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`;
  const ICON_CHEVRON = `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>`;
  const ICON_READ = `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"/></svg>`;
  const ICON_UNREAD = `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>`;

  // ── Render functions ───────────────────────────────────────────────

  function renderLoading(container) {
    container.innerHTML = `
      <div class="synth-card">
        <div class="synth-header">
          <div class="synth-logo">${ICON_LOGO}<span class="synth-title">Synthesis</span></div>
        </div>
        <div class="synth-body">
          <div class="synth-loading"><div class="synth-spinner"></div><span>Checking for summary…</span></div>
        </div>
      </div>`;
  }

  function renderSummary(container, video) {
    const s = video.summary;
    const chapters = video.chapters || [];
    const keyPoints = s ? (s.key_points || []) : [];

    const summaryHtml = s
      ? s.summary_text.split('\n\n').map((p) => `<p class="synth-paragraph">${esc(p)}</p>`).join('')
      : '';

    const keyPointsHtml = keyPoints.length
      ? `<div class="synth-section"><h4 class="synth-section-title">Key Points</h4>
           <ul class="synth-key-points">${keyPoints.map((kp) => `<li>${esc(kp)}</li>`).join('')}</ul></div>`
      : '';

    const chaptersHtml = chapters.length
      ? `<div class="synth-section"><h4 class="synth-section-title">Chapters</h4>
           <div class="synth-chapters">${chapters.map((ch) => `
             <button class="synth-chapter" data-time="${ch.timestamp_seconds}">
               <span class="synth-chapter-time">${fmtTime(ch.timestamp_seconds)}</span>
               <div class="synth-chapter-info">
                 <span class="synth-chapter-title">${esc(ch.title)}</span>
                 ${ch.description ? `<span class="synth-chapter-desc">${esc(ch.description)}</span>` : ''}
               </div>
             </button>`).join('')}
           </div></div>`
      : '';

    const metaHtml = s
      ? `<div class="synth-meta">
           ${s.language ? `<span class="synth-tag">${esc(s.language)}</span>` : ''}
           ${s.primary_topic ? `<span class="synth-tag">${esc(s.primary_topic)}</span>` : ''}
         </div>`
      : '';

    const fmtTokens = (n) => { const v = Number(n || 0); return Number.isFinite(v) ? v.toLocaleString() : '0'; };
    const fmtUsd = (n) => { const v = Number(n); if (!Number.isFinite(v)) return 'N/A'; if (v > 0 && v < 0.000001) return '< $0.000001'; return `$${v.toFixed(6)}`; };

    const statsHtml = s
      ? `<div class="synth-section"><h4 class="synth-section-title">LLM Usage</h4>
           <div class="synth-stats">
             <div class="synth-stat"><span class="synth-stat-label">Tokens</span><span class="synth-stat-value">${fmtTokens(s.total_tokens)}</span><span class="synth-stat-detail">${fmtTokens(s.prompt_tokens)} in · ${fmtTokens(s.completion_tokens)} out</span></div>
             <div class="synth-stat"><span class="synth-stat-label">Cost</span><span class="synth-stat-value">${s.llm_cost_usd != null ? fmtUsd(s.llm_cost_usd) : 'N/A'}</span>${s.llm_model ? `<span class="synth-stat-detail">${esc(s.llm_model)}</span>` : ''}</div>
           </div></div>`
      : '';

    const isRead = video.is_read;
    const readBtnLabel = isRead ? 'Mark Unread' : 'Mark Read';
    const readBtnSvg = isRead ? ICON_UNREAD : ICON_READ;

    container.innerHTML = `
      <div class="synth-card">
        <div class="synth-header">
          <div class="synth-logo">${ICON_LOGO}<span class="synth-title">Synthesis</span>
            <span class="synth-badge synth-badge-ready">Ready</span>
          </div>
          <div class="synth-header-actions">
            <button class="synth-read-btn" id="synth-mark-read" title="${readBtnLabel}">
              <span class="synth-read-icon" id="synth-read-svg">${readBtnSvg}</span>
              <span id="synth-read-label">${readBtnLabel}</span>
            </button>
            <button class="synth-collapse-btn" id="synth-toggle" title="Collapse">${ICON_CHEVRON}</button>
          </div>
        </div>
        <div class="synth-body" id="synth-body">
          ${metaHtml}
          <div class="synth-section"><h4 class="synth-section-title">Summary</h4>${summaryHtml}</div>
          ${keyPointsHtml}
          ${chaptersHtml}
          ${statsHtml}
        </div>
      </div>`;

    // Mark read/unread
    let currentIsRead = isRead;
    const markBtn = container.querySelector('#synth-mark-read');
    if (markBtn) {
      markBtn.addEventListener('click', async () => {
        const next = !currentIsRead;
        const res = await sendMessage({ action: 'patchVideo', videoId: video.video_id, data: { is_read: next } });
        if (res && !res.error) {
          currentIsRead = next;
          const svgEl = markBtn.querySelector('#synth-read-svg');
          const label = markBtn.querySelector('#synth-read-label');
          svgEl.innerHTML = currentIsRead ? ICON_UNREAD : ICON_READ;
          label.textContent = currentIsRead ? 'Mark Unread' : 'Mark Read';
          markBtn.title = currentIsRead ? 'Mark Unread' : 'Mark Read';
        }
      });
    }

    // Chapter click → seek
    container.querySelectorAll('.synth-chapter').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = parseInt(btn.dataset.time, 10);
        if (!isNaN(t)) seekTo(t);
      });
    });

    // Collapse toggle
    const tog = container.querySelector('#synth-toggle');
    const body = container.querySelector('#synth-body');
    if (tog && body) {
      tog.addEventListener('click', () => {
        body.classList.toggle('synth-collapsed');
        tog.classList.toggle('synth-rotated');
      });
    }
  }

  function renderNotFound(container, videoId) {
    container.innerHTML = `
      <div class="synth-card">
        <div class="synth-header">
          <div class="synth-logo">${ICON_WARN}<span class="synth-title">Synthesis</span></div>
        </div>
        <div class="synth-body">
          <p class="synth-empty-text">No summary available for this video.</p>
          <button class="synth-queue-btn" id="synth-queue">${ICON_ADD} Queue for Analysis</button>
        </div>
      </div>`;

    container.querySelector('#synth-queue').addEventListener('click', () => queueCurrentVideo(videoId));
  }

  function renderProcessing(container, status) {
    const labels = { queued: 'Queued', downloading: 'Downloading', transcribing: 'Transcribing', summarizing: 'Summarizing' };
    const label = labels[status] || 'Processing';
    container.innerHTML = `
      <div class="synth-card">
        <div class="synth-header">
          <div class="synth-logo">${ICON_LOGO}<span class="synth-title">Synthesis</span>
            <span class="synth-badge synth-badge-processing">${esc(label)}</span>
          </div>
        </div>
        <div class="synth-body">
          <div class="synth-loading"><div class="synth-spinner"></div><span>${esc(label)}… This may take a few minutes.</span></div>
          <div class="synth-progress-bar"><div class="synth-progress-fill synth-progress-animate"></div></div>
        </div>
      </div>`;
  }

  function renderFailed(container, errorMsg, videoId) {
    container.innerHTML = `
      <div class="synth-card synth-card-error">
        <div class="synth-header">
          <div class="synth-logo">${ICON_WARN}<span class="synth-title">Synthesis</span>
            <span class="synth-badge synth-badge-failed">Failed</span>
          </div>
        </div>
        <div class="synth-body">
          <p class="synth-error-text">${esc(errorMsg || 'Processing failed for this video.')}</p>
          <button class="synth-retry-btn" id="synth-retry-analysis">Retry Analysis</button>
        </div>
      </div>`;

    container.querySelector('#synth-retry-analysis').addEventListener('click', async () => {
      const res = await sendMessage({ action: 'retryVideo', videoId });
      if (res && !res.error) startPolling(videoId);
    });
  }

  function renderBackendError(container, message) {
    container.innerHTML = `
      <div class="synth-card synth-card-error">
        <div class="synth-header">
          <div class="synth-logo">${ICON_WARN}<span class="synth-title">Synthesis</span></div>
        </div>
        <div class="synth-body">
          <p class="synth-error-text">${esc(message)}</p>
          <button class="synth-retry-btn" id="synth-retry-conn">Retry</button>
        </div>
      </div>`;

    container.querySelector('#synth-retry-conn').addEventListener('click', () => {
      currentVideoId = null; // force re-check
      checkCurrentVideo();
    });
  }

  // ── Polling ────────────────────────────────────────────────────────

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    pollCount = 0;
  }

  function startPolling(videoId) {
    stopPolling();
    const container = getOrCreateContainer();
    if (!container) return;
    renderProcessing(container, 'queued');

    pollTimer = setInterval(async () => {
      pollCount++;
      if (pollCount > MAX_POLL_ATTEMPTS) {
        stopPolling();
        renderBackendError(container, 'Polling timed out. The video may still be processing — check your Synthesis dashboard.');
        return;
      }
      if (getVideoId() !== videoId) { stopPolling(); return; }

      const result = await sendMessage({ action: 'checkVideo', videoId });
      if (!result || result.error) return; // keep polling

      if (result.found) {
        const st = result.video.processing_status;
        if (st === 'ready') { stopPolling(); renderSummary(container, result.video); }
        else if (st === 'failed') { stopPolling(); renderFailed(container, result.video.processing_error, videoId); }
        else { renderProcessing(container, st); }
      }
    }, POLL_INTERVAL_MS);
  }

  // ── Core actions ───────────────────────────────────────────────────

  async function queueCurrentVideo(videoId) {
    const container = getOrCreateContainer();
    if (!container) return;
    renderProcessing(container, 'queued');

    const videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    const result = await sendMessage({ action: 'queueVideo', videoUrl });

    if (result && result.error) {
      renderBackendError(container, `Failed to queue: ${result.error}`);
      return;
    }
    startPolling(videoId);
  }

  async function checkCurrentVideo() {
    if (!extensionEnabled) return;
    const videoId = getVideoId();
    if (!videoId || !isWatchPage()) {
      removeContainer();
      stopPolling();
      currentVideoId = null;
      return;
    }
    if (videoId === currentVideoId) return;
    currentVideoId = videoId;
    stopPolling();

    // Wait for YouTube to render the target area
    await waitForElement('ytd-watch-flexy #below');

    const container = getOrCreateContainer();
    if (!container) return;
    renderLoading(container);

    const result = await sendMessage({ action: 'checkVideo', videoId });

    if (result && result.error) {
      const isNetwork = /fetch|network|disconnected/i.test(result.error);
      renderBackendError(container,
        isNetwork
          ? 'Cannot reach Synthesis backend. Check your endpoint in the extension options.'
          : result.error);
      return;
    }

    if (result && result.found) {
      const st = result.video.processing_status;
      if (st === 'ready') renderSummary(container, result.video);
      else if (st === 'failed') renderFailed(container, result.video.processing_error, videoId);
      else startPolling(videoId);
    } else {
      renderNotFound(container, videoId);
    }
  }

  // ── Enable/disable support ─────────────────────────────────────────

  let extensionEnabled = true;

  chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
    extensionEnabled = enabled;
    if (!enabled) { removeContainer(); stopPolling(); }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'toggleEnabled') {
      extensionEnabled = msg.enabled;
      if (!extensionEnabled) {
        removeContainer();
        stopPolling();
        currentVideoId = null;
      } else if (isWatchPage()) {
        currentVideoId = null;
        checkCurrentVideo();
      }
    }
  });

  // ── Navigation detection ───────────────────────────────────────────

  function onNavigate() {
    if (!extensionEnabled) return;
    const newId = getVideoId();
    if (newId !== currentVideoId) {
      currentVideoId = null;
      stopPolling();
      if (isWatchPage()) setTimeout(checkCurrentVideo, 300);
      else removeContainer();
    }
  }

  document.addEventListener('yt-navigate-finish', onNavigate);
  window.addEventListener('popstate', onNavigate);

  // Initial check
  if (isWatchPage()) {
    chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
      if (enabled) waitForElement('ytd-watch-flexy #below').then(() => checkCurrentVideo());
    });
  }
})();
