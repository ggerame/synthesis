/* Synthesis – background service worker.
   Handles all API communication with the Synthesis backend. */

const DEFAULT_ENDPOINT = 'http://localhost:8000';

async function getEndpoint() {
  const { endpoint } = await chrome.storage.sync.get({ endpoint: DEFAULT_ENDPOINT });
  return endpoint.replace(/\/+$/, '');
}

async function apiGet(path) {
  const endpoint = await getEndpoint();
  const res = await fetch(`${endpoint}${path}`);
  if (res.status === 404) return { _notFound: true };
  if (!res.ok) throw new Error(`Backend returned ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const endpoint = await getEndpoint();
  const res = await fetch(`${endpoint}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

async function apiPut(path, body) {
  const endpoint = await getEndpoint();
  const res = await fetch(`${endpoint}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

async function apiPatch(path, body) {
  const endpoint = await getEndpoint();
  const res = await fetch(`${endpoint}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

async function apiDelete(path) {
  const endpoint = await getEndpoint();
  const res = await fetch(`${endpoint}${path}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

// ── Message handlers ───────────────────────────────────────────────

const handlers = {
  async checkVideo({ videoId }) {
    const data = await apiGet(`/api/videos/${encodeURIComponent(videoId)}`);
    if (data._notFound) return { found: false };
    return { found: true, video: data };
  },

  async queueVideo({ videoUrl }) {
    return apiPost('/api/videos/summarize', { url: videoUrl });
  },

  async retryVideo({ videoId }) {
    return apiPost(`/api/videos/${encodeURIComponent(videoId)}/retry`);
  },

  async patchVideo({ videoId, data }) {
    return apiPatch(`/api/videos/${encodeURIComponent(videoId)}`, data);
  },

  async healthCheck() {
    return apiGet('/api/health');
  },

  async getEndpointUrl() {
    return { endpoint: await getEndpoint() };
  },

  // ── Settings ─────────────────────────────────────────────────────
  async getSettings() {
    return apiGet('/api/settings');
  },

  async putSettings({ payload }) {
    return apiPut('/api/settings', payload);
  },

  // ── Channels ─────────────────────────────────────────────────────
  async getChannels() {
    return apiGet('/api/channels');
  },

  async addChannel({ data }) {
    return apiPost('/api/channels', data);
  },

  async deleteChannel({ channelId }) {
    return apiDelete(`/api/channels/${encodeURIComponent(channelId)}`);
  },

  // ── Model Pricing ────────────────────────────────────────────────
  async getModelPricing() {
    return apiGet('/api/settings/pricing');
  },

  async addModelPricing({ data }) {
    return apiPost('/api/settings/pricing', data);
  },

  async deleteModelPricing({ pricingId }) {
    return apiDelete(`/api/settings/pricing/${pricingId}`);
  },

  // ── System ───────────────────────────────────────────────────────
  async refresh() {
    return apiPost('/api/refresh');
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg.action];
  if (!handler) return;
  handler(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ error: e.message }));
  return true; // keep the message channel open for async response
});

// ── Icon state ─────────────────────────────────────────────────────

function setIconEnabled(enabled) {
  const suffix = enabled ? '' : '-disabled';
  chrome.action.setIcon({
    path: {
      16: `icons/icon16${suffix}.png`,
      48: `icons/icon48${suffix}.png`,
    },
  });
}

// Sync icon on startup
chrome.storage.sync.get({ enabled: true }, ({ enabled }) => setIconEnabled(enabled));

// Sync icon when storage changes (popup toggles it)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.enabled != null) {
    setIconEnabled(changes.enabled.newValue);
  }
});


