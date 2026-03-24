/** Fetch wrapper for all REST API calls. */

const BASE = '';

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

export const api = {
  // Videos
  getVideos(params = {}) {
    const q = new URLSearchParams(params).toString();
    return request('GET', `/api/videos${q ? '?' + q : ''}`);
  },
  getVideo(videoId) {
    return request('GET', `/api/videos/${encodeURIComponent(videoId)}`);
  },
  patchVideo(videoId, data) {
    return request('PATCH', `/api/videos/${encodeURIComponent(videoId)}`, data);
  },
  retryVideo(videoId) {
    return request('POST', `/api/videos/${encodeURIComponent(videoId)}/retry`);
  },
  deleteVideo(videoId) {
    return request('DELETE', `/api/videos/${encodeURIComponent(videoId)}`);
  },
  checkVideoDelete(videoId) {
    return request('GET', `/api/videos/${encodeURIComponent(videoId)}/delete-check`);
  },
  summarizeUrl(url) {
    return request('POST', '/api/videos/summarize', { url });
  },
  purgeOldReadVideos() {
    return request('DELETE', '/api/videos/purge-old-read');
  },

  // Channels
  getChannels() {
    return request('GET', '/api/channels');
  },
  addChannel(data) {
    return request('POST', '/api/channels', data);
  },
  deleteChannel(channelId) {
    return request('DELETE', `/api/channels/${encodeURIComponent(channelId)}`);
  },

  // Settings
  getSettings() {
    return request('GET', '/api/settings');
  },
  putSettings(data) {
    return request('PUT', '/api/settings', data);
  },
  getModelPricing() {
    return request('GET', '/api/settings/pricing');
  },
  addModelPricing(data) {
    return request('POST', '/api/settings/pricing', data);
  },
  deleteModelPricing(pricingId) {
    return request('DELETE', `/api/settings/pricing/${pricingId}`);
  },

  // Database
  exportDb() {
    return fetch('/api/settings/export-db').then(res => {
      if (!res.ok) throw new Error(`${res.status}: export failed`);
      return res.blob();
    });
  },
  async importDb(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/settings/import-db', { method: 'POST', body: form });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text}`);
    }
    return res.json();
  },

  // System
  refresh() {
    return request('POST', '/api/refresh');
  },
  health() {
    return request('GET', '/api/health');
  },
  totalCost() {
    return request('GET', '/api/stats/cost');
  },
};
