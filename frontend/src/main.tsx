import React, { FormEvent, createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, LANGUAGES, type Channel, type Language, type Pricing, type Settings, type Video, type VideoPage } from './api';
import { detectBrowserLanguage, languageLabels, localeFor, parseRoute, translate, type MessageKey } from './i18n';
import './styles.css';

const ACTIVE = new Set(['queued', 'downloading', 'transcribing', 'summarizing']);
const PAGE_SIZES = [15, 30, 60] as const;
const LANGUAGE_BADGES: Record<Language, string> = { English: 'EN', German: 'DE', Italian: 'IT', French: 'FR', Spanish: 'ES', Japanese: 'JA', Portuguese: 'PT' };
type T = (key: MessageKey, values?: Record<string, string | number>) => string;
type ConfirmFn = (message: string, destructive?: boolean) => Promise<boolean>;
type SelectOption = { value: string; label: string; badge?: string; avatar?: string; fallback?: string; icon?: React.ReactNode };
const ConfirmContext = createContext<ConfirmFn>(async () => false);

function ManagedConfirm({ t, children }: { t: T; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const activeRequest = useRef<{ message: string; destructive: boolean; resolve: (value: boolean) => void } | null>(null);
  const [request, setRequest] = useState<{ message: string; destructive: boolean; resolve: (value: boolean) => void } | null>(null);
  const ask = useCallback<ConfirmFn>((message, destructive = false) => new Promise(resolve => {
    activeRequest.current?.resolve(false);
    const next = { message, destructive, resolve };
    activeRequest.current = next;
    setRequest(next);
  }), []);
  const finish = useCallback((value: boolean) => {
    const current = activeRequest.current;
    if (!current) return;
    activeRequest.current = null;
    current.resolve(value);
    setRequest(null);
  }, []);
  useEffect(() => {
    const dialog = ref.current;
    if (request && dialog && !dialog.open) dialog.showModal();
    if (!request && dialog?.open) dialog.close();
  }, [request]);
  return <ConfirmContext.Provider value={ask}>{children}<dialog ref={ref} className={`dialog confirm-dialog ${request?.destructive ? 'is-destructive' : ''}`} aria-labelledby="confirm-title" aria-describedby="confirm-message" onCancel={event => { event.preventDefault(); finish(false); }} onClick={event => { if (event.target === ref.current) finish(false); }}><div className="eyebrow">Synthesis</div><h2 id="confirm-title">{t('confirm')}</h2><p id="confirm-message">{request?.message}</p><div className="dialog-actions"><button type="button" className="button ghost" onClick={() => finish(false)}>{t('cancel')}</button><button type="button" className="button primary" onClick={() => finish(true)}>{t('confirm')}</button></div></dialog></ConfirmContext.Provider>;
}

function formatDate(value: string, language: Language, relative = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  if (relative) {
    const days = Math.round((date.getTime() - Date.now()) / 86_400_000);
    if (Math.abs(days) < 7) return new Intl.RelativeTimeFormat(localeFor(language), { numeric: 'auto' }).format(days, 'day');
  }
  return new Intl.DateTimeFormat(localeFor(language), { dateStyle: 'medium' }).format(date);
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function inputType(value: string): { kind: 'video' | 'channel'; payload: { handle?: string; channel_id?: string } } {
  if (/(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/)/i.test(value)) return { kind: 'video', payload: {} };
  const id = value.match(/(?:youtube\.com\/channel\/)?(UC[A-Za-z0-9_-]+)/)?.[1];
  if (id) return { kind: 'channel', payload: { channel_id: id } };
  const handle = value.match(/(?:youtube\.com\/)?@?([A-Za-z0-9._-]+)/)?.[1] || value.replace(/^@/, '');
  return { kind: 'channel', payload: { handle } };
}

function Logo() {
  return <span className="logo-mark" aria-hidden="true">S</span>;
}

function Spinner() { return <span className="spinner" aria-hidden="true" />; }
function GridIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3" width="5" height="5" rx="1" /><rect x="12" y="3" width="5" height="5" rx="1" /><rect x="3" y="12" width="5" height="5" rx="1" /><rect x="12" y="12" width="5" height="5" rx="1" /></svg>; }
function ChevronIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>; }
function CheckIcon() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4.5 10 3.2 3.2 7.8-7.4" /></svg>; }
function ReadIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12 2.3 2.4 4.8-5" /></svg>; }
function TrashIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg>; }

function AddDialog({ open, onClose, onDone, t }: { open: boolean; onClose: () => void; onDone: (message: string) => void; t: T }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      const parsed = inputType(value.trim());
      if (parsed.kind === 'video') { await api.summarize(value.trim()); onDone(t('queuedToast')); }
      else { await api.addChannel(parsed.payload); onDone(t('channelAdded')); }
      setValue(''); onClose();
    } catch (error) { onDone(`${t('error')}: ${(error as Error).message}`); }
    finally { setBusy(false); }
  }
  return <dialog ref={ref} className="dialog" onClose={onClose}>
    <form onSubmit={submit}>
      <div className="eyebrow">Synthesis</div><h2>{t('addTitle')}</h2><p>{t('addHelp')}</p>
      <label>{t('add')}<input autoFocus value={value} onChange={e => setValue(e.target.value)} placeholder="https://youtube.com/watch?v=… or @channel" /></label>
      <div className="dialog-actions"><button type="button" className="button ghost" onClick={onClose}>{t('cancel')}</button><button className="button primary" disabled={busy}>{busy ? <Spinner /> : t('add')}</button></div>
    </form>
  </dialog>;
}

function Status({ video, t, language }: { video: Video; t: T; language: Language }) {
  const status = video.processing_status || 'ready';
  const key = (['queued', 'downloading', 'transcribing', 'summarizing', 'ready', 'failed'].includes(status) ? status : 'processing') as MessageKey;
  return <div className={`status status-${status}`}>
    <span className="status-dot" /><span>{t(key)}</span>
    {video.processing_attempts > 0 && status !== 'ready' && <small>{t('attempt', { current: video.processing_attempts, max: video.processing_max_attempts || 3 })}</small>}
    {video.next_retry_at && <small>{t('retryAt', { time: new Intl.DateTimeFormat(localeFor(language), { timeStyle: 'short' }).format(new Date(video.next_retry_at)) })}</small>}
  </div>;
}

function VideoCard({ video, t, language, reload, notify }: { video: Video; t: T; language: Language; reload: () => void; notify: (message: string) => void }) {
  const ask = useContext(ConfirmContext);
  async function remove(event: React.MouseEvent) {
    event.stopPropagation();
    try {
      const check = await api.deleteCheck(video.video_id);
      if (!await ask(check.will_redownload ? t('redownloadConfirm') : t('deleteConfirm'), true)) return;
      await api.deleteVideo(video.video_id); reload();
    } catch (error) { notify((error as Error).message); }
  }
  async function retry(event: React.MouseEvent) { event.stopPropagation(); try { await api.retryVideo(video.video_id); reload(); } catch (error) { notify((error as Error).message); } }
  async function toggleRead(event: React.MouseEvent) { event.stopPropagation(); try { await api.patchVideo(video.video_id, { is_read: !video.is_read }); reload(); } catch (error) { notify((error as Error).message); } }
  return <article className={`video-card ${video.is_read ? 'is-read' : ''}`} tabIndex={0} role="link" onClick={() => { location.hash = `#/video/${video.video_id}`; }} onKeyDown={e => { if (e.target === e.currentTarget && e.key === 'Enter') location.hash = `#/video/${video.video_id}`; }}>
    <div className="thumb-wrap"><img src={video.thumbnail_url} alt="" loading="lazy" />{!video.is_read && <span className="unread-dot" />}{video.duration_seconds && <span className="duration">{formatTime(video.duration_seconds)}</span>}</div>
    <div className="card-body">
      <div className="channel-line">{video.channel_avatar_url && <img src={`/api/channels/${encodeURIComponent(video.channel_id)}/avatar`} alt="" />}<span>{video.channel_name || video.channel_handle}</span><time>{formatDate(video.published_at, language, true)}</time></div>
      <h3>{video.title}</h3>
      {video.processing_status !== 'ready' && <Status video={video} t={t} language={language} />}
      {video.processing_error && video.processing_status !== 'ready' && <p className="error-copy">{video.processing_error}</p>}
      <footer>{video.llm_model && <span>{video.llm_model}</span>}{video.total_tokens ? <span>{new Intl.NumberFormat(localeFor(language)).format(video.total_tokens)} {t('tokens').toLowerCase()}</span> : null}{video.llm_cost_usd != null && <span>{new Intl.NumberFormat(localeFor(language), { style: 'currency', currency: 'USD', maximumFractionDigits: 5 }).format(video.llm_cost_usd)}</span>}</footer>
      <div className="card-actions">{video.processing_status === 'failed' && <button type="button" className="text-button" onClick={retry}>{t('retry')}</button>}<button type="button" className={`icon-action read-action ${video.is_read ? 'is-active' : ''}`} aria-label={video.is_read ? t('markUnread') : t('markRead')} aria-pressed={video.is_read} title={video.is_read ? t('markUnread') : t('markRead')} onClick={toggleRead}><ReadIcon /></button><button type="button" className="icon-action delete-action" aria-label={t('delete')} title={t('delete')} onClick={remove}><TrashIcon /></button></div>
    </div>
  </article>;
}

function FeedPage({ t, language, externalRefresh, notify }: { t: T; language: Language; externalRefresh: number; notify: (message: string) => void }) {
  const ask = useContext(ConfirmContext);
  const saved = JSON.parse(localStorage.getItem('synthesis-feed') || '{}');
  const [status, setStatus] = useState(saved.status || 'all');
  const [channel, setChannel] = useState(saved.channel || '');
  const [sort, setSort] = useState(saved.sort || 'published');
  const [order, setOrder] = useState(saved.order || 'desc');
  const [page, setPage] = useState(saved.page || 1);
  const [limit, setLimit] = useState(PAGE_SIZES.includes(Number(saved.limit) as typeof PAGE_SIZES[number]) ? Number(saved.limit) : PAGE_SIZES[0]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [data, setData] = useState<VideoPage | null>(null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce(n => n + 1);

  useEffect(() => { api.channels().then(setChannels).catch(e => setError(e.message)); }, []);
  useEffect(() => {
    localStorage.setItem('synthesis-feed', JSON.stringify({ status, channel, sort, order, page, limit }));
    let cancelled = false; let timer = 0;
    const load = async () => {
      try {
        const result = await api.videos({ status, channel_id: channel, sort, order, page, limit });
        if (cancelled) return; setData(result); setError('');
        if (result.items.some(v => ACTIVE.has(v.processing_status))) timer = window.setTimeout(load, 4000);
      } catch (e) { if (!cancelled) setError((e as Error).message); }
    };
    load(); return () => { cancelled = true; window.clearTimeout(timer); };
  }, [status, channel, sort, order, page, limit, nonce, externalRefresh]);

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / limit));
  return <main className="page feed-page">
    <section className="page-heading"><div><div className="eyebrow">Synthesis / 01</div><h1>{t('feed')}</h1></div><p>{data?.total ?? 0} {t('videos')}</p></section>
    <section className="filters" aria-label="Filters">
      <div className="segmented">{(['all', 'unread', 'read', 'failed'] as const).map(key => <button className={status === key ? 'active' : ''} onClick={() => { setStatus(key); setPage(1); }} key={key}>{t(key)}</button>)}</div>
      <SelectField compact wide label={t('allChannels')} value={channel} onChange={value => { setChannel(value); setPage(1); }} options={[{ value: '', label: t('allChannels'), icon: <GridIcon /> }, ...channels.map(ch => ({ value: ch.channel_id, label: ch.name || ch.handle, avatar: ch.avatar_url ? `/api/channels/${encodeURIComponent(ch.channel_id)}/avatar` : undefined, fallback: (ch.name || ch.handle || '?').slice(0, 1).toUpperCase() }))]} />
      <SelectField compact label={t('published')} value={sort} onChange={setSort} options={[{ value: 'published', label: t('published') }, { value: 'analyzed', label: t('analyzed') }]} />
      <button className="button icon" title={order === 'desc' ? t('newest') : t('oldest')} onClick={() => setOrder(order === 'desc' ? 'asc' : 'desc')}>{order === 'desc' ? '↓' : '↑'}</button>
      <button className="button ghost purge" onClick={async () => { if (await ask(t('purgeConfirm'), true)) { try { await api.purge(); reload(); } catch (e) { notify((e as Error).message); } } }}>{t('purge')}</button>
    </section>
    {error && <div className="notice error-copy">{error}</div>}
    {!data ? <div className="loading"><Spinner />{t('loading')}</div> : data.items.length === 0 ? <div className="empty-state">{t('empty')}</div> : <section className="video-grid">{data.items.map(v => <VideoCard key={v.video_id} video={v} t={t} language={language} reload={reload} notify={notify} />)}</section>}
    <nav className="pagination" aria-label="Pagination"><button className="button ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('previous')}</button><span>{page} / {totalPages}</span><button className="button ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>{t('next')}</button><SelectField compact label={t('perPage')} value={String(limit)} onChange={value => { setLimit(Number(value)); setPage(1); }} options={PAGE_SIZES.map(n => ({ value: String(n), label: `${n} ${t('perPage')}` }))} /></nav>
  </main>;
}

function DetailPage({ id, t, language }: { id: string; t: T; language: Language }) {
  const ask = useContext(ConfirmContext);
  const [video, setVideo] = useState<Video | null>(null); const [error, setError] = useState('');
  const load = useCallback(async () => { try { setVideo(await api.video(id)); setError(''); } catch (e) { setError((e as Error).message); } }, [id]);
  useEffect(() => {
    let cancelled = false; let timer = 0;
    const poll = async () => {
      try {
        const current = await api.video(id);
        if (cancelled) return;
        setVideo(current); setError('');
        if (ACTIVE.has(current.processing_status)) timer = window.setTimeout(poll, 4000);
      } catch (e) { if (!cancelled) setError((e as Error).message); }
    };
    poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [id]);
  if (error) return <main className="page"><div className="notice error-copy">{error}</div></main>;
  if (!video) return <div className="loading"><Spinner />{t('loading')}</div>;
  async function remove() { const check = await api.deleteCheck(id); if (!await ask(check.will_redownload ? t('redownloadConfirm') : t('deleteConfirm'), true)) return; await api.deleteVideo(id); location.hash = '#/'; }
  return <main className="page detail-page">
    <a className="back-link" href="#/">← {t('back')}</a>
    <section className="detail-hero"><div><div className="eyebrow">{video.summary?.primary_topic || video.channel_name}</div><h1>{video.title}</h1><div className="detail-meta"><span>{video.channel_name}</span><span>{formatDate(video.published_at, language)}</span></div><div className="action-row"><button className="button primary" onClick={async () => { await api.patchVideo(id, { is_read: !video.is_read }); load(); }}>{video.is_read ? t('markUnread') : t('markRead')}</button>{video.processing_status === 'failed' && <button className="button ghost" onClick={async () => { await api.retryVideo(id); load(); }}>{t('retry')}</button>}<button className="button ghost danger" onClick={remove}>{t('delete')}</button></div></div><a className="hero-image" href={video.url} target="_blank" rel="noreferrer"><img src={video.thumbnail_url} alt="" /></a></section>
    {video.processing_status !== 'ready' && <section className="processing-panel"><Status video={video} t={t} language={language} /><h2>{video.processing_status === 'failed' ? t('failed') : t('processing')}</h2>{video.processing_error && <p>{video.processing_error}</p>}</section>}
    {video.summary && <div className="detail-layout"><article className="summary-copy"><div className="eyebrow">{t('summary')}</div>{video.summary.summary_text.split(/\n\s*\n/).map((paragraph, i) => <p key={i}>{paragraph}</p>)}<h2>{t('keyPoints')}</h2><ul>{video.summary.key_points.map((point, i) => <li key={i}>{point}</li>)}</ul><div className="metrics"><div><span>{t('tokens')}</span><strong>{new Intl.NumberFormat(localeFor(language)).format(video.summary.total_tokens)}</strong><small>{video.summary.prompt_tokens} + {video.summary.completion_tokens}</small></div><div><span>{t('estimatedCost')}</span><strong>{video.summary.llm_cost_usd == null ? '—' : new Intl.NumberFormat(localeFor(language), { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(video.summary.llm_cost_usd)}</strong><small>{video.summary.llm_model}</small></div></div></article><aside><a className="button primary wide" href={video.url} target="_blank" rel="noreferrer">{t('watch')} ↗</a><section className="chapters"><h2>{t('chapters')}</h2>{video.chapters?.map(ch => <a key={ch.id} href={`${video.url}&t=${ch.timestamp_seconds}s`} target="_blank" rel="noreferrer"><time>{formatTime(ch.timestamp_seconds)}</time><div><h3>{ch.title}</h3><p>{ch.description}</p></div></a>)}</section></aside></div>}
  </main>;
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="field"><span>{label}</span>{children}</label>;

function SelectField({ label, value, options, onChange, compact = false, wide = false }: { label: string; value: string; options: SelectOption[]; onChange: (value: string) => void; compact?: boolean; wide?: boolean }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value);
  const visual = (option?: SelectOption) => option?.avatar ? <img className="select-avatar" src={option.avatar} alt="" /> : option?.icon ? <span className="select-avatar is-fallback" aria-hidden="true">{option.icon}</span> : option?.fallback ? <span className="select-avatar is-fallback" aria-hidden="true">{option.fallback}</span> : option?.badge ? <span className="language-badge" aria-hidden="true">{option.badge}</span> : null;
  function move(direction: number) {
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') || [])];
    if (!items.length) return;
    const focused = items.indexOf(document.activeElement as HTMLButtonElement);
    const index = focused < 0 ? (direction > 0 ? -1 : 0) : focused;
    items[(index + direction + items.length) % items.length]?.focus();
  }
  return <div className={`field ${compact ? 'compact-select' : ''} ${wide ? 'wide-select' : ''}`}><span className={compact ? 'sr-only' : undefined} id={`${id}-label`}>{label}</span><div ref={root} className={`select-field ${open ? 'is-open' : ''}`} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => {
    if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!open) setOpen(true); requestAnimationFrame(() => move(event.key === 'ArrowDown' ? 1 : -1)); }
  }}><button ref={trigger} type="button" className="select-trigger" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}><span className="select-value" id={`${id}-value`}>{visual(selected)}<span>{selected?.label || value}</span></span><span className="select-chevron"><ChevronIcon /></span></button>{open && <div className="select-menu" role="listbox" aria-labelledby={`${id}-label`}>{options.map(option => <button type="button" role="option" aria-selected={option.value === value} key={option.value} onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus(); }}><span className="select-option">{visual(option)}<span>{option.label}</span></span>{option.value === value && <span className="selected-mark"><CheckIcon /></span>}</button>)}</div>}</div></div>;
}

function SettingsPage({ t, language, onSettings, onAdd }: { t: T; language: Language; onSettings: (settings: Settings) => void; onAdd: () => void }) {
  const ask = useContext(ConfirmContext);
  const [form, setForm] = useState<Settings | null>(null); const [baseline, setBaseline] = useState<Settings | null>(null); const [channels, setChannels] = useState<Channel[]>([]); const [prices, setPrices] = useState<Pricing[]>([]); const [message, setMessage] = useState('');
  const [price, setPrice] = useState({ model_name: '', input_price_per_1m: 0, cached_input_price_per_1m: null as number | null, output_price_per_1m: 0 });
  const load = useCallback(async () => { try { const [s, c, p] = await Promise.all([api.settings(), api.channels(), api.pricing()]); setForm(s); setBaseline(s); setChannels(c); setPrices(p); setMessage(''); } catch (e) { setMessage((e as Error).message); } }, []);
  useEffect(() => { load(); }, [load]);
  if (!form) return <div className="loading"><Spinner />{t('loading')}</div>;
  const dirty = baseline !== null && JSON.stringify(form) !== JSON.stringify(baseline);
  const set = (key: keyof Settings, value: string) => setForm({ ...form, [key]: value } as Settings);
  async function save(event: FormEvent) { event.preventDefault(); try { const saved = await api.saveSettings({ ...(form as Settings), language_preference_set: 'true' }); setForm(saved); setBaseline(saved); onSettings(saved); setMessage(''); } catch (e) { setMessage((e as Error).message); } }
  async function exportDb() { const blob = await api.exportDb(); const href = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = href; link.download = `synthesis-${new Date().toISOString().slice(0, 10)}.db`; link.click(); URL.revokeObjectURL(href); }
  return <main className="page settings-page"><section className="page-heading"><div><div className="eyebrow">Synthesis / 02</div><h1>{t('settings')}</h1></div>{message && <p>{message}</p>}</section><form onSubmit={save}>
    <header className={`save-bar ${dirty ? 'is-dirty' : ''}`}><span aria-live="polite"><i />{dirty ? t('unsavedChanges') : t('saved')}</span><div><button type="button" className="button ghost" disabled={!dirty} onClick={load}>{t('discard')}</button><button className="button primary" disabled={!dirty}>{t('save')}</button></div></header>
    <section className="settings-section"><header><div><div className="eyebrow">01</div><h2>{t('channels')}</h2></div><button type="button" className="button ghost" onClick={onAdd}>+ {t('add')}</button></header><div className="channel-list">{channels.map(ch => <div key={ch.channel_id}>{ch.avatar_url && <img src={`/api/channels/${encodeURIComponent(ch.channel_id)}/avatar`} alt="" />}<span><strong>{ch.name || ch.handle}</strong><small>{ch.handle && `@${ch.handle}`}</small></span><button type="button" className="icon-action delete-action" aria-label={t('delete')} title={t('delete')} onClick={async () => { if (!await ask(t('deleteChannelConfirm'), true)) return; try { await api.deleteChannel(ch.channel_id); await load(); } catch (e) { setMessage((e as Error).message); } }}><TrashIcon /></button></div>)}</div></section>
    <section className="settings-section"><header><div><div className="eyebrow">02</div><h2>{t('inference')}</h2></div></header><div className="form-grid"><SelectField label={t('provider')} value={form.llm_provider} onChange={value => set('llm_provider', value)} options={[{ value: 'azure', label: 'Azure OpenAI' }, { value: 'openai', label: 'OpenAI' }, { value: 'openai-compatible', label: 'OpenAI-compatible' }]} /><Field label={t('model')}><input value={form.llm_model} onChange={e => set('llm_model', e.target.value)} /></Field><Field label={t('apiKey')}><input type="password" value={form.llm_api_key} onChange={e => set('llm_api_key', e.target.value)} /></Field>{form.llm_provider !== 'openai' && <Field label={t('endpoint')}><input type="url" value={form.llm_endpoint} onChange={e => set('llm_endpoint', e.target.value)} /></Field>}{form.llm_provider === 'azure' && <Field label={t('apiVersion')}><input value={form.azure_api_version} onChange={e => set('azure_api_version', e.target.value)} /></Field>}</div></section>
    <div className="settings-columns"><section className="settings-section"><header><div><div className="eyebrow">03</div><h2>{t('output')}</h2></div></header><SelectField label={t('language')} value={form.summary_language} onChange={value => setForm({ ...form, summary_language: value as Language, language_preference_set: 'true' })} options={LANGUAGES.map(lang => ({ value: lang, label: languageLabels[lang], badge: LANGUAGE_BADGES[lang] }))} /><SelectField label={t('tone')} value={form.system_tone} onChange={value => set('system_tone', value)} options={[{ value: 'Analytical', label: t('analytical') }, { value: 'Creative', label: t('creative') }, { value: 'Minimalist', label: t('minimalist') }]} /></section>
    <section className="settings-section"><header><div><div className="eyebrow">04</div><h2>{t('scheduling')}</h2></div></header><Field label={t('pollInterval')}><input type="number" min="1" value={form.poll_interval_minutes} onChange={e => set('poll_interval_minutes', e.target.value)} /></Field><Field label={t('maxAge')}><input type="number" min="1" value={form.max_video_age_days} onChange={e => set('max_video_age_days', e.target.value)} /></Field></section></div>
    <section className="settings-section"><header><div><div className="eyebrow">05</div><h2>{t('whisper')}</h2></div><label className="switch"><input type="checkbox" checked={form.whisper_fallback === 'true'} onChange={e => set('whisper_fallback', String(e.target.checked))} /><span />{t('enabled')}</label></header>{form.whisper_fallback === 'true' && <div className="form-grid"><SelectField label={t('provider')} value={form.whisper_provider} onChange={value => set('whisper_provider', value)} options={[{ value: 'openai', label: 'OpenAI' }, { value: 'azure', label: 'Azure OpenAI' }]} /><Field label={t('model')}><input value={form.whisper_model} onChange={e => set('whisper_model', e.target.value)} /></Field><Field label={t('apiKey')}><input type="password" value={form.whisper_key} onChange={e => set('whisper_key', e.target.value)} /></Field><Field label={t('endpoint')}><input type="url" value={form.whisper_endpoint} onChange={e => set('whisper_endpoint', e.target.value)} /></Field>{form.whisper_provider === 'azure' && <Field label={t('apiVersion')}><input value={form.whisper_api_version} onChange={e => set('whisper_api_version', e.target.value)} /></Field>}</div>}</section>
    <section className="settings-section"><header><div><div className="eyebrow">06</div><h2>{t('pricing')}</h2></div></header><div className="pricing-list">{prices.map(item => <div key={item.id}><strong>{item.model_name}</strong><span>{item.input_price_per_1m} / {item.output_price_per_1m}</span><button type="button" className="icon-action delete-action" aria-label={t('delete')} title={t('delete')} onClick={async () => { await api.deletePricing(item.id); load(); }}><TrashIcon /></button></div>)}</div><div className="price-form"><Field label={t('model')}><input value={price.model_name} onChange={e => setPrice({ ...price, model_name: e.target.value })} /></Field><Field label={t('inputPrice')}><input type="number" step="0.01" value={price.input_price_per_1m} onChange={e => setPrice({ ...price, input_price_per_1m: Number(e.target.value) })} /></Field><Field label={t('cachedPrice')}><input type="number" step="0.01" value={price.cached_input_price_per_1m ?? ''} onChange={e => setPrice({ ...price, cached_input_price_per_1m: e.target.value === '' ? null : Number(e.target.value) })} /></Field><Field label={t('outputPrice')}><input type="number" step="0.01" value={price.output_price_per_1m} onChange={e => setPrice({ ...price, output_price_per_1m: Number(e.target.value) })} /></Field><button type="button" className="button ghost" onClick={async () => { if (!price.model_name) return; await api.savePricing(price); setPrice({ model_name: '', input_price_per_1m: 0, cached_input_price_per_1m: null, output_price_per_1m: 0 }); load(); }}>{t('add')}</button></div></section>
    <section className="settings-section"><header><div><div className="eyebrow">07</div><h2>{t('database')}</h2></div></header><div className="action-row"><button type="button" className="button ghost" onClick={exportDb}>{t('exportDb')}</button><label className="button ghost file-button">{t('importDb')}<input type="file" accept=".db,.sqlite,.sqlite3" onChange={async e => { const file = e.target.files?.[0]; if (file && await ask(t('importConfirm'), true)) { await api.importDb(file); await load(); } e.target.value = ''; }} /></label></div></section>
  </form></main>;
}

function App() {
  const [settings, setSettings] = useState<Settings | null>(null); const [route, setRoute] = useState(parseRoute(location.hash)); const [addOpen, setAddOpen] = useState(false); const [toast, setToast] = useState(''); const [cost, setCost] = useState<number | null>(null); const [feedRefresh, setFeedRefresh] = useState(0); const [dark, setDark] = useState(() => localStorage.getItem('synthesis-theme') === 'dark' || (!localStorage.getItem('synthesis-theme') && matchMedia('(prefers-color-scheme: dark)').matches));
  useEffect(() => { const handler = () => setRoute(parseRoute(location.hash)); addEventListener('hashchange', handler); return () => removeEventListener('hashchange', handler); }, []);
  const loadSettings = useCallback(() => api.settings().then(setSettings).catch(error => setToast(error.message)), []);
  useEffect(() => { loadSettings(); api.totalCost().then(r => setCost(r.total_cost_usd)).catch(() => {}); }, [loadSettings, route.page]);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('synthesis-theme', dark ? 'dark' : 'light'); }, [dark]);
  const language = settings?.summary_language || 'English';
  const t = useCallback<T>((key, values) => translate(language, key, values), [language]);
  useEffect(() => { document.documentElement.lang = localeFor(language); }, [language]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3500); return () => clearTimeout(timer); }, [toast]);
  const suggestion = useMemo(() => settings?.language_preference_set === 'false' && !localStorage.getItem('synthesis-language-suggestion-dismissed') ? detectBrowserLanguage() : 'English', [settings]);
  if (!settings) return <div className="app-loading"><Logo /><Spinner /></div>;
  async function acceptSuggestion() { const saved = await api.saveSettings({ ...settings!, summary_language: suggestion, language_preference_set: 'true' }); setSettings(saved); }
  return <ManagedConfirm t={t}><header className="topbar"><a href="#/" className="brand"><Logo /><span>Synthesis</span></a><nav><span className="cost">{cost == null ? '—' : new Intl.NumberFormat(localeFor(language), { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(cost)}</span><button className="icon-button" title={dark ? t('lightTheme') : t('darkTheme')} onClick={() => setDark(!dark)}>{dark ? '☀' : '◐'}</button><button className="icon-button" title={t('add')} onClick={() => setAddOpen(true)}>＋</button><a className="icon-button" title={t('settings')} href="#/settings">⚙</a><button className="icon-button" title={t('refresh')} onClick={async () => { await api.refresh(); setToast(t('synchronized')); setFeedRefresh(n => n + 1); window.setTimeout(() => setFeedRefresh(n => n + 1), 3000); }}>↻</button></nav></header>
    {suggestion !== 'English' && <aside className="language-prompt" role="status"><div className="language-prompt-icon" aria-hidden="true">文</div><div><strong>{languageLabels[suggestion]}</strong><p>{t('suggestion', { language: languageLabels[suggestion] })}</p><div><button className="button primary" onClick={acceptSuggestion}>{t('useLanguage')}</button><button className="button ghost" onClick={() => { localStorage.setItem('synthesis-language-suggestion-dismissed', '1'); setSettings({ ...settings }); }}>{t('dismiss')}</button></div></div></aside>}
    {route.page === 'feed' && <FeedPage t={t} language={language} externalRefresh={feedRefresh} notify={setToast} />}{route.page === 'detail' && route.id && <DetailPage id={route.id} t={t} language={language} />}{route.page === 'settings' && <SettingsPage t={t} language={language} onSettings={setSettings} onAdd={() => setAddOpen(true)} />}
    <AddDialog open={addOpen} onClose={() => setAddOpen(false)} onDone={message => { setToast(message); setFeedRefresh(n => n + 1); }} t={t} />{toast && <div className="toast" role="status">{toast}</div>}</ManagedConfirm>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
