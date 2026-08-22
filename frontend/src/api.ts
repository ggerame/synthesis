export const LANGUAGES = ['English', 'German', 'Italian', 'French', 'Spanish', 'Japanese', 'Portuguese'] as const;
export type Language = typeof LANGUAGES[number];

export interface Settings {
  llm_provider: string; llm_endpoint: string; llm_api_key: string; llm_model: string;
  azure_api_version: string; summary_language: Language; language_preference_set: 'true' | 'false';
  poll_interval_minutes: string; max_video_age_days: string;
  whisper_fallback: string; whisper_provider: string; whisper_endpoint: string;
  whisper_key: string; whisper_model: string; whisper_api_version: string; system_tone: string;
}
export interface Channel { id: number; channel_id: string; name: string; handle: string; feed_url: string; avatar_url: string; added_at: string }
export interface Pricing { id: number; model_name: string; input_price_per_1m: number; cached_input_price_per_1m: number | null; output_price_per_1m: number }
export interface Summary { id: number; video_id: string; summary_text: string; key_points: string[]; language: string; primary_topic: string; llm_model: string; prompt_version: string; prompt_tokens: number; completion_tokens: number; total_tokens: number; llm_cost_usd: number | null; created_at: string }
export interface Chapter { id: number; timestamp_seconds: number; title: string; description: string; sort_order: number }
export interface Video {
  id: number; channel_id: string; video_id: string; title: string; url: string; thumbnail_url: string;
  published_at: string; discovered_at: string; is_read: boolean; duration_seconds: number | null;
  channel_name: string; channel_handle: string; channel_avatar_url: string; has_summary?: boolean;
  llm_model?: string; prompt_tokens?: number; completion_tokens?: number; total_tokens?: number;
  llm_cost_usd?: number | null; processing_status: string; processing_error: string;
  processing_attempts: number; processing_max_attempts: number; next_retry_at: string;
  processing_updated_at: string; summary?: Summary | null; chapters?: Chapter[];
}
export interface VideoPage { items: Video[]; total: number; page: number; limit: number }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      message = typeof body.detail === 'string' ? body.detail : message;
    } catch { /* response was not JSON */ }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  videos: (params: Record<string, string | number>) => request<VideoPage>(`/api/videos?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`),
  video: (id: string) => request<Video>(`/api/videos/${encodeURIComponent(id)}`),
  patchVideo: (id: string, body: { is_read: boolean }) => request(`/api/videos/${encodeURIComponent(id)}`, json('PATCH', body)),
  retryVideo: (id: string) => request(`/api/videos/${encodeURIComponent(id)}/retry`, json('POST')),
  deleteVideo: (id: string) => request(`/api/videos/${encodeURIComponent(id)}`, json('DELETE')),
  deleteCheck: (id: string) => request<{ will_redownload: boolean }>(`/api/videos/${encodeURIComponent(id)}/delete-check`),
  summarize: (url: string) => request<{ video_id: string }>('/api/videos/summarize', json('POST', { url })),
  purge: () => request<{ deleted: number }>('/api/videos/purge-old-read', json('DELETE')),
  channels: () => request<Channel[]>('/api/channels'),
  addChannel: (body: { handle?: string; channel_id?: string }) => request<Channel>('/api/channels', json('POST', body)),
  deleteChannel: (id: string) => request(`/api/channels/${encodeURIComponent(id)}`, json('DELETE')),
  settings: () => request<Settings>('/api/settings'),
  saveSettings: (body: Settings) => request<Settings>('/api/settings', json('PUT', body)),
  pricing: () => request<Pricing[]>('/api/settings/pricing'),
  savePricing: (body: Omit<Pricing, 'id'>) => request<Pricing>('/api/settings/pricing', json('POST', body)),
  deletePricing: (id: number) => request(`/api/settings/pricing/${id}`, json('DELETE')),
  refresh: () => request('/api/refresh', json('POST')),
  totalCost: () => request<{ total_cost_usd: number }>('/api/stats/cost'),
  exportDb: async () => { const response = await fetch('/api/settings/export-db'); if (!response.ok) throw new Error('Export failed'); return response.blob(); },
  importDb: (file: File) => { const body = new FormData(); body.append('file', file); return request('/api/settings/import-db', { method: 'POST', body }); },
};
