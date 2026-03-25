/** Settings page. */
import { api } from '../api.js';
import { showToast } from '../app.js';

const TONE_OPTIONS = {
  Analytical: {
    summary: 'Structured, evidence-first summaries.',
    detail: 'Best when you want direct takeaways, explicit reasoning, and a more technical voice.',
  },
  Creative: {
    summary: 'More narrative and connective.',
    detail: 'Best when you want the output to feel more editorial, fluid, and easier to read end to end.',
  },
  Minimalist: {
    summary: 'Compressed and terse.',
    detail: 'Best when you want shorter summaries with less framing and only the highest-signal points.',
  },
};

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function channelAvatar(channel) {
  if (channel.avatar_url) {
    return `<img class="w-full h-full object-cover" src="/api/channels/${encodeURIComponent(channel.channel_id)}/avatar" alt="${esc(channel.name || channel.handle || channel.channel_id)}" loading="lazy" />`;
  }

  return `${(channel.name || channel.handle || '?')[0].toUpperCase()}`;
}

export async function renderSettings(container) {
  const [settings, channels, modelPricing] = await Promise.all([
    api.getSettings(),
    api.getChannels(),
    api.getModelPricing(),
  ]);
  const channelCount = channels.length;

  const channelRows = channels.map(c => `
    <div class="flex items-center justify-between p-4 bg-surface-container-lowest hover:bg-surface-container-low transition-colors rounded-lg group">
      <div class="flex items-center gap-4">
        <div class="w-10 h-10 rounded-full overflow-hidden bg-surface-variant flex items-center justify-center text-sm font-bold text-on-surface">
          ${channelAvatar(c)}
        </div>
        <div>
          <div class="font-bold text-on-surface">${esc(c.name || c.channel_id)}</div>
          <div class="text-xs text-on-surface-variant">${c.handle ? '@' + esc(c.handle) : esc(c.channel_id)}</div>
        </div>
      </div>
      <button data-delete="${c.channel_id}" class="delete-ch opacity-0 group-hover:opacity-100 p-2 text-error hover:bg-error-container/20 rounded-md transition-all">
        <span class="material-symbols-outlined">delete</span>
      </button>
    </div>`).join('');

  const toneCards = Object.entries(TONE_OPTIONS).map(([tone, copy]) =>
    `<button data-tone="${tone}" class="tone-chip text-left p-4 rounded-xl border transition-all ${tone === settings.system_tone ? 'bg-secondary-container text-on-secondary-container border-primary/30 shadow-lg' : 'bg-surface-container-high text-on-surface-variant border-outline-variant/10 hover:bg-surface-variant'}">
      <div class="flex items-center justify-between gap-4 mb-2">
        <span class="text-sm font-bold tracking-tight">${tone}</span>
        <span class="material-symbols-outlined text-base ${tone === settings.system_tone ? 'opacity-100' : 'opacity-30'}">check_circle</span>
      </div>
      <p class="text-xs font-semibold uppercase tracking-widest ${tone === settings.system_tone ? 'text-on-secondary-container/80' : 'text-on-surface-variant'}">${copy.summary}</p>
    </button>`
  ).join('');

  const pricingRows = modelPricing.map(p => `
    <div class="flex items-center justify-between p-4 bg-surface-container-lowest hover:bg-surface-container-low transition-colors rounded-lg group">
      <div class="flex-1">
        <div class="font-bold text-on-surface">${esc(p.model_name)}</div>
        <div class="text-xs text-on-surface-variant mt-1">
          Input: $${p.input_price_per_1m.toFixed(2)}/1M
          ${p.cached_input_price_per_1m !== null ? ` | Cached: $${p.cached_input_price_per_1m.toFixed(2)}/1M` : ''}
          | Output: $${p.output_price_per_1m.toFixed(2)}/1M
        </div>
      </div>
      <div class="flex gap-2 ml-4">
        <button data-edit-pricing="${p.id}" class="edit-pricing opacity-0 group-hover:opacity-100 p-2 text-primary hover:bg-primary-container/20 rounded-md transition-all">
          <span class="material-symbols-outlined">edit</span>
        </button>
        <button data-delete-pricing="${p.id}" class="delete-pricing opacity-0 group-hover:opacity-100 p-2 text-error hover:bg-error-container/20 rounded-md transition-all">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    </div>`).join('');

  const selectedToneCopy = TONE_OPTIONS[settings.system_tone] || TONE_OPTIONS.Analytical;

  container.innerHTML = `
    <main class="w-full max-w-none px-6 pt-8 pb-28 sm:px-8 xl:px-12 2xl:px-16">
      <div class="max-w-6xl mx-auto space-y-6">

        <!-- Channel List -->
        <section class="p-6 bg-surface-container rounded-xl">
          <div class="flex justify-between items-center gap-4 mb-4">
            <div class="flex items-center gap-3">
              <span class="material-symbols-outlined text-primary">smart_display</span>
              <div>
                <h2 class="text-xl font-bold tracking-tight">Channel List</h2>
                <p class="text-xs text-on-surface-variant">${channelCount} ${channelCount === 1 ? 'channel' : 'channels'} subscribed</p>
              </div>
            </div>
            <button id="settings-add-ch" class="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary font-bold text-sm rounded-lg elevation-1 active:scale-95 transition-all">
              <span class="material-symbols-outlined text-sm">add</span> Add
            </button>
          </div>
          <div class="overflow-y-auto pr-2 space-y-2" style="max-height:24rem" id="channel-list">
            ${channelRows || '<p class="text-on-surface-variant text-sm py-4">No channels added yet.</p>'}
          </div>
        </section>

        <!-- Inference Engine -->
        <section class="p-6 bg-surface-container rounded-xl">
          <div class="flex items-center gap-3 mb-6">
            <span class="material-symbols-outlined text-primary">neurology</span>
            <h2 class="text-xl font-bold tracking-tight">Inference Engine</h2>
          </div>

          <div class="mb-6">
            <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-widest mb-3">LLM Provider</label>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3" id="provider-group">
              ${[
                { value: 'azure', label: 'Azure OpenAI', desc: 'Microsoft Azure hosted models' },
                { value: 'openai', label: 'OpenAI', desc: 'Direct OpenAI API (api.openai.com)' },
                { value: 'openai-compatible', label: 'OpenAI-Compatible', desc: 'Ollama, vLLM, LiteLLM, Groq, etc.' },
              ].map(p => {
                const active = p.value === (settings.llm_provider || 'azure');
                const btnClass = active
                  ? 'bg-secondary-container text-on-secondary-container border-primary/30 elevation-1'
                  : 'bg-surface-container-high text-on-surface-variant border-outline-variant/10 hover:bg-surface-variant';
                const iconClass = active ? 'opacity-100' : 'opacity-30';
                const descClass = active ? 'text-on-secondary-container/80' : 'text-on-surface-variant';
                return '<button data-provider="' + p.value + '" class="provider-chip text-left p-4 rounded-xl border transition-all ' + btnClass + '">'
                  + '<div class="flex items-center justify-between gap-2 mb-1">'
                  + '<span class="text-sm font-bold">' + p.label + '</span>'
                  + '<span class="material-symbols-outlined text-base ' + iconClass + '">check_circle</span>'
                  + '</div>'
                  + '<p class="text-xs ' + descClass + '">' + p.desc + '</p>'
                  + '</button>';
              }).join('')}
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="space-y-4">
              <div>
                <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-widest mb-2">Model</label>
                <input id="s-model" type="text" value="${esc(settings.llm_model)}"
                  class="w-full bg-surface-container-lowest rounded-lg border-2 border-outline-variant/20 focus:ring-0 focus:border-primary text-on-surface p-3 transition-colors font-mono text-sm" />
              </div>
              <div id="endpoint-row">
                <label id="endpoint-label" class="block text-xs font-semibold text-on-surface-variant uppercase tracking-widest mb-2">API Endpoint</label>
                <input id="s-endpoint" type="url" value="${esc(settings.llm_endpoint)}"
                  class="w-full bg-surface-container-lowest rounded-lg border-2 border-outline-variant/20 focus:ring-0 focus:border-primary text-on-surface p-3 transition-colors font-mono text-sm" />
                <p id="endpoint-hint" class="mt-1 text-[10px] text-on-surface-variant uppercase tracking-tighter"></p>
              </div>
              <div id="api-version-row">
                <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-widest mb-2">API Version</label>
                <input id="s-api-version" type="text" value="${esc(settings.azure_api_version || '2025-03-01-preview')}"
                  class="w-full bg-surface-container-lowest rounded-lg border-2 border-outline-variant/20 focus:ring-0 focus:border-primary text-on-surface p-3 transition-colors font-mono text-sm" />
                <p class="mt-1 text-[10px] text-on-surface-variant uppercase tracking-tighter">e.g. 2025-03-01-preview</p>
              </div>
            </div>
            <div class="space-y-4">
              <div>
                <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-widest mb-2">API Key</label>
                <div class="relative">
                  <input id="s-key" type="password" value="${esc(settings.llm_api_key)}"
                    class="w-full bg-surface-container-lowest rounded-lg border-2 border-outline-variant/20 focus:ring-0 focus:border-primary text-on-surface p-3 transition-colors font-mono text-sm pr-12" />
                  <button id="toggle-key-vis" class="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary transition-colors">
                    <span class="material-symbols-outlined text-sm">visibility</span>
                  </button>
                </div>
                <p class="mt-1 text-[10px] text-on-surface-variant uppercase tracking-tighter">Stored locally in the application database</p>
              </div>
            </div>
          </div>
        </section>

        <!-- Output & Scheduling -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <section class="p-6 bg-surface-container rounded-xl">
            <div class="flex items-center gap-3 mb-5">
              <span class="material-symbols-outlined text-primary">language</span>
              <h2 class="text-xl font-bold tracking-tight">Output</h2>
            </div>
            <div class="space-y-4">
              <div>
                <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-widest mb-2">Summary Language</label>
                <select id="s-lang" class="w-full bg-surface-container-lowest rounded-lg border-2 border-outline-variant/20 focus:ring-0 focus:border-primary text-on-surface p-3 transition-colors">
                  ${['English', 'German', 'Italian', 'French', 'Spanish', 'Japanese', 'Portuguese'].map(l =>
                    `<option ${l === settings.summary_language ? 'selected' : ''}>${l}</option>`
                  ).join('')}
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-widest mb-2">System Tone</label>
                <div class="grid grid-cols-1 gap-2" id="tone-group">${toneCards}</div>
                <div id="tone-description" class="mt-3 p-3 bg-surface-container-lowest rounded-lg border border-outline-variant/10">
                  <p id="tone-title" class="text-sm font-bold text-on-surface mb-1">${settings.system_tone}</p>
                  <p id="tone-copy" class="text-xs text-on-surface-variant leading-relaxed">${selectedToneCopy.detail}</p>
                </div>
              </div>
            </div>
          </section>

          <section class="p-6 bg-surface-container rounded-xl">
            <div class="flex items-center gap-3 mb-5">
              <span class="material-symbols-outlined text-primary">schedule</span>
              <h2 class="text-xl font-bold tracking-tight">Scheduling</h2>
            </div>
            <div class="space-y-4">
              <div>
                <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-widest mb-2">Poll Interval (minutes)</label>
                <input id="s-poll" type="number" min="1" value="${esc(settings.poll_interval_minutes)}"
                  class="w-full bg-surface-container-lowest rounded-lg border-2 border-outline-variant/20 focus:ring-0 focus:border-primary text-on-surface p-3 transition-colors font-mono text-sm" />
                <p class="mt-1 text-[10px] text-on-surface-variant">How often to check subscribed channels for new videos.</p>
              </div>
              <div>
                <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-widest mb-2">Max Video Age (days)</label>
                <input id="s-age" type="number" min="1" value="${esc(settings.max_video_age_days)}"
                  class="w-full bg-surface-container-lowest rounded-lg border-2 border-outline-variant/20 focus:ring-0 focus:border-primary text-on-surface p-3 transition-colors font-mono text-sm" />
                <p class="mt-1 text-[10px] text-on-surface-variant">Only process videos published within this many days.</p>
              </div>
            </div>
          </section>
        </div>

        <!-- Whisper Fallback -->
        <section class="p-6 bg-surface-container rounded-xl">
          <div class="flex items-center justify-between mb-6">
            <div class="flex items-center gap-3">
              <span class="material-symbols-outlined text-primary">mic</span>
              <div>
                <h2 class="text-xl font-bold tracking-tight">Whisper Transcription Fallback</h2>
                <p class="text-xs text-on-surface-variant">Transcribe audio via Whisper API when subtitles are unavailable.</p>
              </div>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input id="s-whisper" type="checkbox" class="sr-only peer" ${settings.whisper_fallback === 'true' ? 'checked' : ''} />
              <div class="w-14 h-7 bg-surface-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-primary-container"></div>
            </label>
          </div>
          <div class="flex gap-2 mb-5">
            ${[{ value: 'openai', label: 'OpenAI', icon: 'cloud' },
               { value: 'azure', label: 'Azure OpenAI', icon: 'azure' }].map(p => {
              const active = p.value === (settings.whisper_provider || 'openai');
              return `<button data-wprovider="${p.value}" class="whisper-provider-chip flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all border-2 ${
                active ? 'bg-primary-container text-on-primary-container border-primary/30' : 'bg-surface-container-high text-on-surface-variant border-outline-variant/10 hover:bg-surface-variant'
              }"><span class="material-symbols-outlined text-sm ${active ? 'opacity-100' : 'opacity-30'}">${p.value === 'azure' ? 'deployed_code' : 'cloud'}</span>${p.label}</button>`;
            }).join('')}
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label id="whisper-model-label" class="block text-xs font-semibold text-on-surface-variant uppercase tracking-widest mb-2">Model</label>
              <input id="s-wmodel" type="text" value="${esc(settings.whisper_model || 'whisper-1')}"
                class="w-full bg-surface-container-lowest rounded-lg border-2 border-outline-variant/20 focus:ring-0 focus:border-primary text-on-surface p-3 transition-colors font-mono text-sm" />
              <p id="whisper-model-hint" class="text-[11px] text-on-surface-variant mt-1"></p>
            </div>
            <div>
              <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-widest mb-2">API Key</label>
              <input id="s-wkey" type="password" value="${esc(settings.whisper_key)}" placeholder="Leave blank to use main API key"
                class="w-full bg-surface-container-lowest rounded-lg border-2 border-outline-variant/20 focus:ring-0 focus:border-primary text-on-surface p-3 transition-colors font-mono text-sm" />
              <p class="text-[11px] text-on-surface-variant mt-1">Optional — falls back to the main LLM API key if empty.</p>
            </div>
            <div>
              <label id="whisper-endpoint-label" class="block text-xs font-semibold text-on-surface-variant uppercase tracking-widest mb-2">Endpoint</label>
              <input id="s-wendpoint" type="url" value="${esc(settings.whisper_endpoint)}"
                class="w-full bg-surface-container-lowest rounded-lg border-2 border-outline-variant/20 focus:ring-0 focus:border-primary text-on-surface p-3 transition-colors font-mono text-sm" />
              <p id="whisper-endpoint-hint" class="text-[11px] text-on-surface-variant mt-1"></p>
            </div>
            <div id="whisper-api-version-row">
              <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-widest mb-2">API Version</label>
              <input id="s-wapi-version" type="text" value="${esc(settings.whisper_api_version || '2025-03-01-preview')}"
                class="w-full bg-surface-container-lowest rounded-lg border-2 border-outline-variant/20 focus:ring-0 focus:border-primary text-on-surface p-3 transition-colors font-mono text-sm" />
              <p class="text-[11px] text-on-surface-variant mt-1">e.g. 2025-03-01-preview</p>
            </div>
          </div>
        </section>

        <!-- Model Pricing -->
        <section class="p-6 bg-surface-container rounded-xl">
          <div class="flex justify-between items-center gap-4 mb-4">
            <button id="pricing-toggle" class="flex items-center gap-3 flex-1 text-left hover:text-primary transition-colors">
              <span class="material-symbols-outlined text-primary">expand_more</span>
              <div>
                <h2 class="text-xl font-bold tracking-tight">Model Pricing</h2>
                <p class="text-xs text-on-surface-variant">Cost estimation per model.</p>
              </div>
            </button>
            <button id="pricing-add-btn" class="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary font-bold text-sm rounded-lg elevation-1 active:scale-95 transition-all">
              <span class="material-symbols-outlined text-sm">add</span> Add
            </button>
          </div>
          <div id="pricing-content" class="hidden space-y-2">
            <div id="pricing-list" class="space-y-2">
              ${pricingRows || '<p class="text-on-surface-variant text-sm py-4">No models configured yet.</p>'}
            </div>
          </div>
        </section>

        <!-- Database Export / Import -->
        <section class="p-6 bg-surface-container rounded-xl">
          <div class="flex items-center gap-3 mb-4">
            <span class="material-symbols-outlined text-primary">database</span>
            <div>
              <h2 class="text-xl font-bold tracking-tight">Database</h2>
              <p class="text-xs text-on-surface-variant">Export or import the full application database (settings, channels, videos, summaries).</p>
            </div>
          </div>
          <div class="flex flex-wrap gap-3">
            <button id="db-export-btn" class="flex items-center gap-2 px-4 py-2.5 bg-primary text-on-primary font-bold text-sm rounded-lg elevation-1 active:scale-95 transition-all">
              <span class="material-symbols-outlined text-sm">download</span> Export Database
            </button>
            <label id="db-import-label" class="flex items-center gap-2 px-4 py-2.5 bg-surface-container-high text-on-surface-variant font-bold text-sm rounded-lg border-2 border-outline-variant/20 hover:bg-surface-variant cursor-pointer transition-all active:scale-95">
              <span class="material-symbols-outlined text-sm">upload</span> Import Database
              <input id="db-import-input" type="file" accept=".db,.sqlite,.sqlite3" class="hidden" />
            </label>
          </div>
        </section>
      </div>
    </main>

    <!-- Sticky Save Bar -->
    <div class="fixed bottom-0 left-0 right-0 z-40 border-t border-outline-variant/10" style="background:var(--header-bg)">
      <div class="max-w-6xl mx-auto px-6 py-3 flex items-center justify-end gap-3 sm:px-8 xl:px-12 2xl:px-16">
        <button id="discard-btn" class="text-on-surface-variant font-bold hover:text-on-surface transition-colors px-4 py-2 text-sm">Discard</button>
        <button id="save-btn" class="px-6 py-2.5 bg-primary text-on-primary font-bold text-sm rounded-lg elevation-1 active:scale-95 transition-all hover:elevation-2">
          Save Settings
        </button>
      </div>
    </div>

    <!-- Add/Edit Model Pricing Modal -->
    <div id="pricing-modal" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
      <div class="bg-surface-container rounded-xl max-w-md w-full p-8 space-y-6">
        <div>
          <h3 id="pricing-modal-title" class="text-2xl font-bold">Add Model Pricing</h3>
          <p class="text-sm text-on-surface-variant mt-2">Configure the token costs for an LLM model.</p>
        </div>
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-widest mb-2">Model Name</label>
            <input id="pricing-model-name" type="text" placeholder="e.g., gpt-4.1, claude-3-opus"
              class="w-full bg-surface-container-lowest rounded-lg border-2 border-outline-variant/20 focus:ring-0 focus:border-primary text-on-surface p-3 transition-colors" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-widest mb-2">Input $/1M</label>
              <input id="pricing-input" type="number" step="0.01" placeholder="0.00"
                class="w-full bg-surface-container-lowest rounded-lg border-2 border-outline-variant/20 focus:ring-0 focus:border-primary text-on-surface p-3 transition-colors font-mono text-sm" />
            </div>
            <div>
              <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-widest mb-2">Output $/1M</label>
              <input id="pricing-output" type="number" step="0.01" placeholder="0.00"
                class="w-full bg-surface-container-lowest rounded-lg border-2 border-outline-variant/20 focus:ring-0 focus:border-primary text-on-surface p-3 transition-colors font-mono text-sm" />
            </div>
          </div>
          <div>
            <label class="block text-xs font-semibold text-on-surface-variant uppercase tracking-widest mb-2">Cached Input $/1M (optional)</label>
            <input id="pricing-cached" type="number" step="0.01" placeholder="Leave blank if not supported"
              class="w-full bg-surface-container-lowest rounded-lg border-2 border-outline-variant/20 focus:ring-0 focus:border-primary text-on-surface p-3 transition-colors font-mono text-sm" />
          </div>
        </div>
        <div class="flex gap-3">
          <button id="pricing-cancel" class="flex-1 px-4 py-3 bg-surface-container-high text-on-surface-variant rounded-lg font-bold hover:bg-surface-variant transition-colors">
            Cancel
          </button>
          <button id="pricing-save" class="flex-1 px-4 py-3 bg-primary text-on-primary rounded-lg font-bold hover:brightness-110 transition-colors">
            Save Model
          </button>
        </div>
      </div>
    </div>`;

  // ── Event binding ──────────────────────────────────────────────────
  let selectedTone = settings.system_tone;

  function syncToneUi() {
    const title = container.querySelector('#tone-title');
    const copy = container.querySelector('#tone-copy');
    const toneInfo = TONE_OPTIONS[selectedTone] || TONE_OPTIONS.Analytical;

    if (title) title.textContent = selectedTone;
    if (copy) copy.textContent = toneInfo.detail;

    container.querySelectorAll('.tone-chip').forEach(btn => {
      const active = btn.dataset.tone === selectedTone;
      btn.classList.toggle('bg-secondary-container', active);
      btn.classList.toggle('text-on-secondary-container', active);
      btn.classList.toggle('border-primary/30', active);
      btn.classList.toggle('shadow-lg', active);
      btn.classList.toggle('bg-surface-container-high', !active);
      btn.classList.toggle('text-on-surface-variant', !active);
      btn.classList.toggle('border-outline-variant/10', !active);
      btn.classList.toggle('hover:bg-surface-variant', !active);

      const icon = btn.querySelector('.material-symbols-outlined');
      if (icon) {
        icon.classList.toggle('opacity-100', active);
        icon.classList.toggle('opacity-30', !active);
      }
    });
  }

  container.querySelectorAll('.tone-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedTone = btn.dataset.tone;
      syncToneUi();
    });
  });

  syncToneUi();

  // ── Provider selection ──────────────────────────────────────────────
  let selectedProvider = settings.llm_provider || 'azure';

  function syncProviderUi() {
    container.querySelectorAll('.provider-chip').forEach(btn => {
      const active = btn.dataset.provider === selectedProvider;
      btn.classList.toggle('bg-secondary-container', active);
      btn.classList.toggle('text-on-secondary-container', active);
      btn.classList.toggle('border-primary/30', active);
      btn.classList.toggle('elevation-1', active);
      btn.classList.toggle('bg-surface-container', !active);
      btn.classList.toggle('text-on-surface-variant', !active);
      btn.classList.toggle('border-outline-variant/10', !active);
      btn.classList.toggle('hover:bg-surface-variant', !active);

      const icon = btn.querySelector('.material-symbols-outlined');
      if (icon) {
        icon.classList.toggle('opacity-100', active);
        icon.classList.toggle('opacity-30', !active);
      }
    });

    const endpointRow = container.querySelector('#endpoint-row');
    const endpointHint = container.querySelector('#endpoint-hint');
    const endpointLabel = container.querySelector('#endpoint-label');

    const apiVersionRow = container.querySelector('#api-version-row');

    if (selectedProvider === 'openai') {
      endpointRow.style.display = 'none';
    } else {
      endpointRow.style.display = '';
    }

    if (apiVersionRow) {
      apiVersionRow.style.display = selectedProvider === 'azure' ? '' : 'none';
    }

    if (endpointLabel) {
      if (selectedProvider === 'azure') endpointLabel.textContent = 'Azure Endpoint';
      else if (selectedProvider === 'openai-compatible') endpointLabel.textContent = 'Base URL';
      else endpointLabel.textContent = 'API Endpoint';
    }

    if (endpointHint) {
      if (selectedProvider === 'azure') endpointHint.textContent = 'e.g. https://myresource.openai.azure.com/';
      else if (selectedProvider === 'openai-compatible') endpointHint.textContent = 'e.g. http://localhost:11434/v1 for Ollama';
      else endpointHint.textContent = '';
    }
  }

  container.querySelectorAll('.provider-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedProvider = btn.dataset.provider;
      syncProviderUi();
    });
  });

  syncProviderUi();

  // Toggle key visibility
  container.querySelector('#toggle-key-vis')?.addEventListener('click', () => {
    const inp = container.querySelector('#s-key');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // ── Whisper provider selection ──────────────────────────────────────
  let selectedWhisperProvider = settings.whisper_provider || 'openai';

  function syncWhisperProviderUi() {
    container.querySelectorAll('.whisper-provider-chip').forEach(btn => {
      const active = btn.dataset.wprovider === selectedWhisperProvider;
      btn.classList.toggle('bg-primary-container', active);
      btn.classList.toggle('text-on-primary-container', active);
      btn.classList.toggle('border-primary/30', active);
      btn.classList.toggle('bg-surface-container-high', !active);
      btn.classList.toggle('text-on-surface-variant', !active);
      btn.classList.toggle('border-outline-variant/10', !active);
      btn.classList.toggle('hover:bg-surface-variant', !active);

      const icon = btn.querySelector('.material-symbols-outlined');
      if (icon) {
        icon.classList.toggle('opacity-100', active);
        icon.classList.toggle('opacity-30', !active);
      }
    });

    const wVersionRow = container.querySelector('#whisper-api-version-row');
    const wEndpointLabel = container.querySelector('#whisper-endpoint-label');
    const wEndpointHint = container.querySelector('#whisper-endpoint-hint');
    const wModelLabel = container.querySelector('#whisper-model-label');
    const wModelHint = container.querySelector('#whisper-model-hint');
    const wEndpointInput = container.querySelector('#s-wendpoint');

    if (wVersionRow) {
      wVersionRow.style.display = selectedWhisperProvider === 'azure' ? '' : 'none';
    }
    if (wEndpointLabel) {
      wEndpointLabel.textContent = selectedWhisperProvider === 'azure' ? 'Azure Endpoint' : 'Endpoint (optional)';
    }
    if (wEndpointInput) {
      wEndpointInput.placeholder = selectedWhisperProvider === 'azure'
        ? 'https://myresource.openai.azure.com/'
        : 'Leave blank for default OpenAI API';
    }
    if (wEndpointHint) {
      wEndpointHint.textContent = selectedWhisperProvider === 'azure'
        ? 'Required — your Azure OpenAI resource base URL.'
        : 'Optional — only needed if using a proxy or custom endpoint.';
    }
    if (wModelLabel) {
      wModelLabel.textContent = selectedWhisperProvider === 'azure' ? 'Deployment Name' : 'Model';
    }
    if (wModelHint) {
      wModelHint.textContent = selectedWhisperProvider === 'azure'
        ? 'The deployment name in your Azure resource (e.g. whisper_model).'
        : 'OpenAI model name (e.g. whisper-1).';
    }
  }

  container.querySelectorAll('.whisper-provider-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedWhisperProvider = btn.dataset.wprovider;
      syncWhisperProviderUi();
    });
  });

  syncWhisperProviderUi();

  // Delete channel
  container.querySelectorAll('.delete-ch').forEach(btn => {
    btn.addEventListener('click', async () => {
      const chId = btn.dataset.delete;
      if (!confirm('Remove this channel and all its videos?')) return;
      try {
        await api.deleteChannel(chId);
        showToast('Removed', 'Channel deleted.');
        renderSettings(container);
      } catch (e) { showToast('Error', e.message); }
    });
  });

  // Add channel from settings page
  container.querySelector('#settings-add-ch')?.addEventListener('click', () => {
    document.getElementById('add-modal').classList.replace('hidden', 'flex');
    requestAnimationFrame(() => document.getElementById('add-input')?.focus());
  });

  // Save settings
  container.querySelector('#save-btn')?.addEventListener('click', async () => {
    const payload = {
      llm_provider: selectedProvider,
      llm_endpoint: container.querySelector('#s-endpoint').value,
      llm_api_key: container.querySelector('#s-key').value,
      llm_model: container.querySelector('#s-model').value,
      azure_api_version: container.querySelector('#s-api-version').value,
      summary_language: container.querySelector('#s-lang').value,
      poll_interval_minutes: container.querySelector('#s-poll').value,
      max_video_age_days: container.querySelector('#s-age').value,
      subtitle_language: settings.subtitle_language || 'en',
      whisper_fallback: container.querySelector('#s-whisper').checked ? 'true' : 'false',
      whisper_provider: selectedWhisperProvider,
      whisper_endpoint: container.querySelector('#s-wendpoint').value,
      whisper_key: container.querySelector('#s-wkey').value,
      whisper_model: container.querySelector('#s-wmodel').value,
      whisper_api_version: container.querySelector('#s-wapi-version').value,
      system_tone: selectedTone,
    };
    try {
      await api.putSettings(payload);
      showToast('Saved', 'Configuration synchronized.');
    } catch (e) { showToast('Error', e.message); }
  });

  // Discard
  container.querySelector('#discard-btn')?.addEventListener('click', () => renderSettings(container));

  // ── Model Pricing Management ────────────────────────────────────────

  let editingPricingId = null;

  // Accordion toggle
  container.querySelector('#pricing-toggle')?.addEventListener('click', () => {
    const content = document.getElementById('pricing-content');
    const toggle = document.querySelector('#pricing-toggle span');
    content.classList.toggle('hidden');
    toggle.textContent = content.classList.contains('hidden') ? 'expand_more' : 'expand_less';
  });

  container.querySelector('#pricing-add-btn')?.addEventListener('click', () => {
    editingPricingId = null;
    document.getElementById('pricing-modal-title').textContent = 'Add Model Pricing';
    document.getElementById('pricing-model-name').disabled = false;
    document.getElementById('pricing-model-name').value = '';
    document.getElementById('pricing-input').value = '';
    document.getElementById('pricing-output').value = '';
    document.getElementById('pricing-cached').value = '';
    document.getElementById('pricing-modal').classList.remove('hidden');
    document.getElementById('pricing-model-name').focus();
  });

  container.querySelector('#pricing-cancel')?.addEventListener('click', () => {
    document.getElementById('pricing-modal').classList.add('hidden');
  });

  container.querySelector('#pricing-save')?.addEventListener('click', async () => {
    const modelName = document.getElementById('pricing-model-name').value.trim();
    const inputPrice = parseFloat(document.getElementById('pricing-input').value || '0');
    const outputPrice = parseFloat(document.getElementById('pricing-output').value || '0');
    const cachedInput = document.getElementById('pricing-cached').value.trim();

    if (!modelName) {
      showToast('Error', 'Model name is required.');
      return;
    }
    if (isNaN(inputPrice) || isNaN(outputPrice)) {
      showToast('Error', 'Input and output prices must be valid numbers.');
      return;
    }

    try {
      if (editingPricingId) {
        // Delete old and add new (since model_name is unique)
        await api.deleteModelPricing(editingPricingId);
      }
      await api.addModelPricing({
        model_name: modelName,
        input_price_per_1m: inputPrice,
        output_price_per_1m: outputPrice,
        cached_input_price_per_1m: cachedInput ? parseFloat(cachedInput) : null,
      });
      showToast('Saved', `Model pricing for ${modelName} updated.`);
      document.getElementById('pricing-modal').classList.add('hidden');
      renderSettings(container);
    } catch (e) {
      showToast('Error', e.message);
    }
  });

  container.querySelectorAll('.edit-pricing').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pricingId = btn.dataset.editPricing;
      const pricing = modelPricing.find(p => p.id == pricingId);
      if (!pricing) return;
      
      editingPricingId = pricingId;
      document.getElementById('pricing-modal-title').textContent = 'Edit Model Pricing';
      document.getElementById('pricing-model-name').disabled = true;
      document.getElementById('pricing-model-name').value = pricing.model_name;
      document.getElementById('pricing-input').value = pricing.input_price_per_1m;
      document.getElementById('pricing-output').value = pricing.output_price_per_1m;
      document.getElementById('pricing-cached').value = pricing.cached_input_price_per_1m || '';
      document.getElementById('pricing-modal').classList.remove('hidden');
      document.getElementById('pricing-input').focus();
    });
  });

  container.querySelectorAll('.delete-pricing').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pricingId = btn.dataset.deletePricing;
      if (!confirm('Remove this model pricing?')) return;
      try {
        await api.deleteModelPricing(pricingId);
        showToast('Removed', 'Model pricing deleted.');
        renderSettings(container);
      } catch (e) {
        showToast('Error', e.message);
      }
    });
  });

  // Close modal on backdrop click
  document.getElementById('pricing-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'pricing-modal') {
      document.getElementById('pricing-modal').classList.add('hidden');
    }
  });

  // ── Database Export / Import ────────────────────────────────────────

  container.querySelector('#db-export-btn')?.addEventListener('click', async () => {
    try {
      const blob = await api.exportDb();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `synthesis-backup-${new Date().toISOString().slice(0, 10)}.db`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Exported', 'Database downloaded.');
    } catch (e) {
      showToast('Error', e.message);
    }
  });

  container.querySelector('#db-import-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm('This will replace ALL current data (channels, videos, summaries, settings) with the imported database. Continue?')) {
      e.target.value = '';
      return;
    }
    try {
      await api.importDb(file);
      showToast('Imported', 'Database restored. Reloading settings…');
      renderSettings(container);
    } catch (err) {
      showToast('Error', err.message);
    }
    e.target.value = '';
  });
}

