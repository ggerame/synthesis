/* Synthesis – full settings page logic. */

const DEFAULT_ENDPOINT = 'http://localhost:8000';

const TONE_INFO = {
  Analytical: { summary: 'Structured, evidence-first summaries.', detail: 'Best when you want direct takeaways, explicit reasoning, and a more technical voice.' },
  Creative:   { summary: 'More narrative and connective.',        detail: 'Best when you want the output to feel more editorial, fluid, and easier to read end to end.' },
  Minimalist: { summary: 'Compressed and terse.',                 detail: 'Best when you want shorter summaries with less framing and only the highest-signal points.' },
};

// ── Helpers ──────────────────────────────────────────────────────────

function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

function $(id) { return document.getElementById(id); }

function send(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, resp => {
      if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
      else resolve(resp);
    });
  });
}

function showToast(title, msg) {
  const t = $('toast');
  $('toast-title').textContent = title;
  $('toast-msg').textContent = msg;
  t.classList.remove('opt-hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add('opt-hidden'), 3000);
}

function normalise(url) { return url.replace(/\/+$/, ''); }

async function ensureHostPermission(url) {
  try {
    const origin = new URL(url).origin;
    return await chrome.permissions.request({ origins: [`${origin}/*`] });
  } catch { return false; }
}

function showConnStatus(text, ok) {
  const el = $('conn-status');
  el.textContent = text;
  el.className = `opt-status ${ok ? 'opt-status-ok' : 'opt-status-err'}`;
}

// ── State ────────────────────────────────────────────────────────────

let settings = {};
let channels = [];
let modelPricing = [];
let selectedProvider = 'azure';
let selectedTone = 'Analytical';
let selectedWhisperProvider = 'openai';
let editingPricingId = null;
let backendEndpoint = DEFAULT_ENDPOINT;

// ── Boot ─────────────────────────────────────────────────────────

async function boot() {
  // Load extension-local endpoint
  const { endpoint } = await chrome.storage.sync.get({ endpoint: DEFAULT_ENDPOINT });
  $('endpoint').value = endpoint;
  backendEndpoint = normalise(endpoint);

  // Load backend data
  const [settingsRes, channelsRes, pricingRes] = await Promise.all([
    send({ action: 'getSettings' }),
    send({ action: 'getChannels' }),
    send({ action: 'getModelPricing' }),
  ]);

  if (settingsRes?.error) {
    showConnStatus(`Cannot load settings: ${settingsRes.error}`, false);
    return;
  }

  settings = settingsRes || {};
  channels = Array.isArray(channelsRes) ? channelsRes : [];
  modelPricing = Array.isArray(pricingRes) ? pricingRes : [];

  populateFields();
}

function populateFields() {
  selectedProvider = settings.llm_provider || 'azure';
  selectedTone = settings.system_tone || 'Analytical';
  selectedWhisperProvider = settings.whisper_provider || 'openai';

  $('s-model').value = settings.azure_openai_model || '';
  $('s-key').value = settings.azure_openai_key || '';
  $('s-llm-endpoint').value = settings.azure_openai_endpoint || '';
  $('s-api-version').value = settings.azure_api_version || '2025-03-01-preview';
  $('s-lang').value = settings.summary_language || 'English';
  $('s-poll').value = settings.poll_interval_minutes || '30';
  $('s-age').value = settings.max_video_age_days || '30';
  $('s-whisper').checked = settings.whisper_fallback === 'true';
  $('s-wmodel').value = settings.whisper_model || 'whisper-1';
  $('s-wkey').value = settings.whisper_key || '';
  $('s-wendpoint').value = settings.whisper_endpoint || '';
  $('s-wapi-version').value = settings.whisper_api_version || '2025-03-01-preview';

  syncProviderUi();
  syncToneUi();
  syncWhisperProviderUi();
  renderChannels();
  renderPricing();
}

// ── Provider chips ───────────────────────────────────────────────────

function syncChipGroup(container, activeAttr, activeVal) {
  container.querySelectorAll('.opt-chip').forEach(btn => {
    const a = btn.dataset[activeAttr] === activeVal;
    btn.classList.toggle('active', a);
  });
}

function syncProviderUi() {
  syncChipGroup($('provider-group'), 'provider', selectedProvider);

  const show = (id, v) => { const el = $(id); if (el) el.style.display = v ? '' : 'none'; };
  show('endpoint-row', selectedProvider !== 'openai');
  show('api-version-row', selectedProvider === 'azure');

  const lbl = $('endpoint-label');
  const hint = $('endpoint-hint');
  if (lbl) lbl.textContent = selectedProvider === 'azure' ? 'Azure Endpoint' : selectedProvider === 'openai-compatible' ? 'Base URL' : 'API Endpoint';
  if (hint) hint.textContent = selectedProvider === 'azure' ? 'e.g. https://myresource.openai.azure.com/' : selectedProvider === 'openai-compatible' ? 'e.g. http://localhost:11434/v1 for Ollama' : '';
}

$('provider-group').addEventListener('click', e => {
  const btn = e.target.closest('.opt-chip');
  if (!btn) return;
  selectedProvider = btn.dataset.provider;
  syncProviderUi();
});

// ── Tone chips ───────────────────────────────────────────────────────

function syncToneUi() {
  syncChipGroup($('tone-group'), 'tone', selectedTone);
  const info = TONE_INFO[selectedTone] || TONE_INFO.Analytical;
  $('tone-title').textContent = selectedTone;
  $('tone-copy').textContent = info.detail;
}

$('tone-group').addEventListener('click', e => {
  const btn = e.target.closest('.opt-chip');
  if (!btn) return;
  selectedTone = btn.dataset.tone;
  syncToneUi();
});

// ── Whisper provider chips ───────────────────────────────────────────

function syncWhisperProviderUi() {
  syncChipGroup($('whisper-provider-group'), 'wprovider', selectedWhisperProvider);

  const isAzure = selectedWhisperProvider === 'azure';
  const show = (id, v) => { const el = $(id); if (el) el.style.display = v ? '' : 'none'; };
  show('whisper-api-version-row', isAzure);

  const lbl = $('whisper-endpoint-label');
  const hint = $('whisper-endpoint-hint');
  const mlbl = $('whisper-model-label');
  const mhint = $('whisper-model-hint');
  if (lbl) lbl.textContent = isAzure ? 'Azure Endpoint' : 'Endpoint (optional)';
  if (hint) hint.textContent = isAzure ? 'Required — your Azure OpenAI resource base URL.' : 'Optional — only needed if using a proxy or custom endpoint.';
  if (mlbl) mlbl.textContent = isAzure ? 'Deployment Name' : 'Model';
  if (mhint) mhint.textContent = isAzure ? 'The deployment name in your Azure resource.' : 'OpenAI model name (e.g. whisper-1).';
}

$('whisper-provider-group').addEventListener('click', e => {
  const btn = e.target.closest('.opt-chip');
  if (!btn) return;
  selectedWhisperProvider = btn.dataset.wprovider;
  syncWhisperProviderUi();
});

// ── Key visibility toggle ────────────────────────────────────────────

$('toggle-key-vis').addEventListener('click', () => {
  const inp = $('s-key');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

// ── Channels ─────────────────────────────────────────────────────────

function channelAvatarHtml(c) {
  if (c.avatar_url) {
    const src = `${backendEndpoint}/api/channels/${encodeURIComponent(c.channel_id)}/avatar`;
    return `<img class="opt-avatar-img" src="${src}" alt="${esc(c.name || '')}" />`;
  }
  const letter = (c.name || c.handle || '?')[0].toUpperCase();
  return `<span class="opt-avatar-letter">${letter}</span>`;
}

function renderChannels() {
  $('channel-count').textContent = `${channels.length} channel${channels.length === 1 ? '' : 's'} subscribed`;
  const list = $('channel-list');
  if (!channels.length) { list.innerHTML = '<p class="opt-list-empty">No channels added yet.</p>'; return; }
  list.innerHTML = channels.map(c => `
    <div class="opt-list-item">
      <div class="opt-avatar">${channelAvatarHtml(c)}</div>
      <div class="opt-list-item-text">
        <span class="opt-list-item-title">${esc(c.name || c.channel_id)}</span>
        <span class="opt-list-item-sub">${c.handle ? '@' + esc(c.handle) : esc(c.channel_id)}</span>
      </div>
      <button class="opt-btn-danger ch-delete" data-id="${esc(c.channel_id)}" title="Remove"><span class="material-symbols-outlined">delete</span></button>
    </div>`).join('');

  list.querySelectorAll('.ch-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this channel and all its videos?')) return;
      const res = await send({ action: 'deleteChannel', channelId: btn.dataset.id });
      if (res?.error) { showToast('Error', res.error); return; }
      channels = channels.filter(c => c.channel_id !== btn.dataset.id);
      renderChannels();
      showToast('Removed', 'Channel deleted.');
    });
  });
}

$('add-channel-btn').addEventListener('click', () => {
  $('add-channel-form').classList.remove('opt-hidden');
  $('add-channel-input').focus();
});
$('add-channel-cancel').addEventListener('click', () => {
  $('add-channel-form').classList.add('opt-hidden');
  $('add-channel-input').value = '';
});
$('add-channel-confirm').addEventListener('click', async () => {
  const val = $('add-channel-input').value.trim();
  if (!val) return;

  // Detect type (same logic as main app)
  const isVideo = /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/)/.test(val);
  const isChannelId = val.startsWith('UC') && val.length > 10;
  const chanMatch = val.match(/youtube\.com\/(@[A-Za-z0-9._-]+)/);
  const chanIdMatch = val.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]+)/);

  let res;
  if (isVideo) {
    res = await send({ action: 'queueVideo', videoUrl: val });
    if (!res?.error) showToast('Queued', 'Video added to the processing queue.');
  } else if (isChannelId || chanIdMatch) {
    const id = chanIdMatch ? chanIdMatch[1] : val;
    res = await send({ action: 'addChannel', data: { channel_id: id } });
    if (!res?.error) showToast('Added', 'Channel subscribed.');
  } else {
    const handle = chanMatch ? chanMatch[1].replace('@', '') : val.replace('@', '');
    res = await send({ action: 'addChannel', data: { handle } });
    if (!res?.error) showToast('Added', 'Channel subscribed.');
  }

  if (res?.error) { showToast('Error', res.error); return; }

  // Refresh channel list from backend
  const fresh = await send({ action: 'getChannels' });
  if (Array.isArray(fresh)) channels = fresh;
  renderChannels();

  $('add-channel-form').classList.add('opt-hidden');
  $('add-channel-input').value = '';
});

// ── Model Pricing ────────────────────────────────────────────────────

function renderPricing() {
  const list = $('pricing-list');
  if (!modelPricing.length) { list.innerHTML = '<p class="opt-list-empty">No models configured yet.</p>'; return; }
  list.innerHTML = modelPricing.map(p => `
    <div class="opt-list-item">
      <div class="opt-list-item-text">
        <span class="opt-list-item-title">${esc(p.model_name)}</span>
        <span class="opt-list-item-sub">Input: $${p.input_price_per_1m.toFixed(2)}/1M${p.cached_input_price_per_1m != null ? ` | Cached: $${p.cached_input_price_per_1m.toFixed(2)}/1M` : ''} | Output: $${p.output_price_per_1m.toFixed(2)}/1M</span>
      </div>
      <div style="display:flex;gap:4px;margin-left:auto">
        <button class="opt-btn-icon-only pr-edit" data-id="${p.id}" title="Edit"><span class="material-symbols-outlined">edit</span></button>
        <button class="opt-btn-danger pr-delete" data-id="${p.id}" title="Remove"><span class="material-symbols-outlined">delete</span></button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.pr-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this model pricing?')) return;
      const res = await send({ action: 'deleteModelPricing', pricingId: parseInt(btn.dataset.id) });
      if (res?.error) { showToast('Error', res.error); return; }
      modelPricing = modelPricing.filter(p => p.id !== parseInt(btn.dataset.id));
      renderPricing();
      showToast('Removed', 'Model pricing deleted.');
    });
  });

  list.querySelectorAll('.pr-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = modelPricing.find(m => m.id === parseInt(btn.dataset.id));
      if (!p) return;
      editingPricingId = p.id;
      $('p-model').value = p.model_name;
      $('p-model').disabled = true;
      $('p-input').value = p.input_price_per_1m;
      $('p-output').value = p.output_price_per_1m;
      $('p-cached').value = p.cached_input_price_per_1m ?? '';
      $('pricing-form').classList.remove('opt-hidden');
      $('p-input').focus();
    });
  });
}

$('pricing-add-btn').addEventListener('click', () => {
  editingPricingId = null;
  $('p-model').value = ''; $('p-model').disabled = false;
  $('p-input').value = ''; $('p-output').value = ''; $('p-cached').value = '';
  $('pricing-form').classList.remove('opt-hidden');
  $('p-model').focus();
});
$('pricing-cancel').addEventListener('click', () => $('pricing-form').classList.add('opt-hidden'));
$('pricing-save').addEventListener('click', async () => {
  const model = $('p-model').value.trim();
  const inp = parseFloat($('p-input').value || '0');
  const out = parseFloat($('p-output').value || '0');
  const cached = $('p-cached').value.trim();
  if (!model) { showToast('Error', 'Model name required.'); return; }

  if (editingPricingId) await send({ action: 'deleteModelPricing', pricingId: editingPricingId });
  const res = await send({ action: 'addModelPricing', data: {
    model_name: model,
    input_price_per_1m: inp,
    output_price_per_1m: out,
    cached_input_price_per_1m: cached ? parseFloat(cached) : null,
  }});
  if (res?.error) { showToast('Error', res.error); return; }

  const fresh = await send({ action: 'getModelPricing' });
  if (Array.isArray(fresh)) modelPricing = fresh;
  renderPricing();
  $('pricing-form').classList.add('opt-hidden');
  showToast('Saved', `Pricing for ${model} updated.`);
});

// ── Connection test ──────────────────────────────────────────────────

$('test-btn').addEventListener('click', async () => {
  const endpoint = normalise($('endpoint').value.trim() || DEFAULT_ENDPOINT);
  try { new URL(endpoint); } catch { showConnStatus('Invalid URL format.', false); return; }

  // Temporarily save so the background worker uses it for the test
  await chrome.storage.sync.set({ endpoint });
  showConnStatus('Connecting…', true);

  const res = await send({ action: 'healthCheck' });
  if (res?.error) showConnStatus(`Connection failed: ${res.error}`, false);
  else showConnStatus(`Connected — database: ${res.database}, LLM: ${res.openai}`, true);
});

// ── Save all settings ────────────────────────────────────────────────

$('save-btn').addEventListener('click', async () => {
  // 1. Save extension endpoint
  const raw = $('endpoint').value.trim();
  const endpoint = normalise(raw || DEFAULT_ENDPOINT);
  try { new URL(endpoint); } catch { showToast('Error', 'Invalid endpoint URL.'); return; }

  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(endpoint)) {
    const granted = await ensureHostPermission(endpoint);
    if (!granted) { showToast('Error', 'Host permission denied.'); return; }
  }
  await chrome.storage.sync.set({ endpoint });

  // 2. Save backend settings
  const payload = {
    llm_provider: selectedProvider,
    azure_openai_endpoint: $('s-llm-endpoint').value,
    azure_openai_key: $('s-key').value,
    azure_openai_model: $('s-model').value,
    azure_api_version: $('s-api-version').value,
    summary_language: $('s-lang').value,
    poll_interval_minutes: $('s-poll').value,
    max_video_age_days: $('s-age').value,
    subtitle_language: settings.subtitle_language || 'en',
    whisper_fallback: $('s-whisper').checked ? 'true' : 'false',
    whisper_provider: selectedWhisperProvider,
    whisper_endpoint: $('s-wendpoint').value,
    whisper_key: $('s-wkey').value,
    whisper_model: $('s-wmodel').value,
    whisper_api_version: $('s-wapi-version').value,
    system_tone: selectedTone,
  };

  const res = await send({ action: 'putSettings', payload });
  if (res?.error) { showToast('Error', res.error); return; }
  settings = res;
  showToast('Saved', 'All settings saved.');
});

// ── Discard ──────────────────────────────────────────────────────────

$('discard-btn').addEventListener('click', () => {
  populateFields();
  showToast('Discarded', 'Changes reverted.');
});

// ── Init ─────────────────────────────────────────────────────────────

boot();
