"""RSS feed polling, new-video detection, and per-video summarization orchestration."""

from __future__ import annotations

import json
import logging
import tempfile
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from defusedxml.ElementTree import fromstring as safe_xml_fromstring
from pathlib import Path
from urllib.request import Request, urlopen
import re

from backend.database import get_db, get_setting
from backend.services.channel_resolver import cache_channel_avatar, channel_id_to_feed_url, fetch_channel_profile, resolve_handle_profile
from backend.services.subtitles import (
    download_audio,
    download_subtitles,
    extract_author,
    fetch_video_metadata,
    format_transcript,
    parse_srt,
    select_best_thumbnail,
    transcribe_with_whisper,
)
from backend.services.summarizer import summarize_transcript

logger = logging.getLogger(__name__)

MAX_PROCESSING_ATTEMPTS = 3
RETRY_DELAYS_SECONDS = (60, 300)
ACTIVE_STATUSES = ("downloading", "transcribing", "summarizing")

_worker_thread: threading.Thread | None = None
_worker_stop = threading.Event()
_worker_wake = threading.Event()
_processing_lock = threading.RLock()
_poll_lock = threading.Lock()

ATOM_NS = "http://www.w3.org/2005/Atom"
YT_NS = "http://www.youtube.com/xml/schemas/2015"
NS = {"atom": ATOM_NS, "yt": YT_NS}


def default_thumbnail_url(video_id: str) -> str:
    return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"


def _video_exists(video_id: str) -> bool:
    with get_db() as conn:
        row = conn.execute("SELECT 1 FROM videos WHERE video_id=?", (video_id,)).fetchone()
    return row is not None


def _cleanup_hidden_channel_if_empty(channel_id: str) -> None:
    with get_db() as conn:
        channel_row = conn.execute(
            "SELECT is_subscribed FROM channels WHERE channel_id=?",
            (channel_id,),
        ).fetchone()
        if not channel_row or channel_row["is_subscribed"]:
            return

        remaining = conn.execute(
            "SELECT 1 FROM videos WHERE channel_id=? LIMIT 1",
            (channel_id,),
        ).fetchone()
        if not remaining:
            conn.execute("DELETE FROM channels WHERE channel_id=?", (channel_id,))


def _set_video_processing_state(video_id: str, status: str, error: str = "") -> None:
    with get_db() as conn:
        conn.execute(
            "UPDATE videos SET processing_status=?, processing_error=?, "
            "processing_updated_at=? WHERE video_id=?",
            (status, error[:1000], _utc_now(), video_id),
        )


def _start_background_video_processing(video_jobs: list[tuple[str, str]]) -> None:
    if video_jobs:
        _worker_wake.set()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _claim_next_video() -> tuple[str, str] | None:
    now = _utc_now()
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT video_id, url FROM videos "
            "WHERE processing_status='queued' AND processing_attempts < ? "
            "AND (next_retry_at='' OR next_retry_at <= ?) "
            "ORDER BY discovered_at, id LIMIT 1",
            (MAX_PROCESSING_ATTEMPTS, now),
        ).fetchone()
        if not row:
            return None
        updated = conn.execute(
            "UPDATE videos SET processing_status='downloading', "
            "processing_attempts=processing_attempts+1, processing_updated_at=? "
            "WHERE video_id=? AND processing_status='queued'",
            (now, row["video_id"]),
        )
        if updated.rowcount != 1:
            return None
        return row["video_id"], row["url"]


def recover_interrupted_jobs() -> None:
    now = _utc_now()
    with get_db() as conn:
        placeholders = ",".join("?" for _ in ACTIVE_STATUSES)
        conn.execute(
            f"UPDATE videos SET "
            "processing_status=CASE WHEN processing_attempts >= ? THEN 'failed' ELSE 'queued' END, "
            "processing_error=CASE WHEN processing_attempts >= ? "
            "THEN 'Processing interrupted after the final attempt.' "
            "ELSE 'Processing interrupted; queued again.' END, "
            "next_retry_at='', processing_updated_at=? "
            f"WHERE processing_status IN ({placeholders})",
            (MAX_PROCESSING_ATTEMPTS, MAX_PROCESSING_ATTEMPTS, now, *ACTIVE_STATUSES),
        )
        conn.execute(
            "UPDATE videos SET processing_status='failed', next_retry_at='', "
            "processing_error=CASE WHEN processing_error='' THEN 'Processing exhausted all attempts.' "
            "ELSE processing_error END, processing_updated_at=? "
            "WHERE processing_status='queued' AND processing_attempts >= ?",
            (now, MAX_PROCESSING_ATTEMPTS),
        )


def _record_processing_failure(video_id: str, exc: Exception) -> None:
    message = str(exc).strip()[:1000] or exc.__class__.__name__
    now = datetime.now(timezone.utc)
    with get_db() as conn:
        row = conn.execute(
            "SELECT processing_attempts FROM videos WHERE video_id=?", (video_id,)
        ).fetchone()
        if not row:
            return
        attempts = int(row["processing_attempts"] or 0)
        if attempts >= MAX_PROCESSING_ATTEMPTS:
            conn.execute(
                "UPDATE videos SET processing_status='failed', processing_error=?, "
                "next_retry_at='', processing_updated_at=? WHERE video_id=?",
                (message, now.isoformat(), video_id),
            )
            return
        retry_at = now + timedelta(seconds=RETRY_DELAYS_SECONDS[max(0, attempts - 1)])
        conn.execute(
            "UPDATE videos SET processing_status='queued', processing_error=?, "
            "next_retry_at=?, processing_updated_at=? WHERE video_id=?",
            (message, retry_at.isoformat(), now.isoformat(), video_id),
        )


def _worker_loop() -> None:
    while not _worker_stop.is_set():
        job = None
        try:
            with _processing_lock:
                job = _claim_next_video()
                if job:
                    video_id, video_url = job
                    try:
                        _run_video_processing(video_id, video_url)
                    except Exception as exc:
                        logger.error("Summarization failed for %s: %s", video_id, exc)
                        _record_processing_failure(video_id, exc)
        except Exception:
            logger.exception("Processing worker loop failed; retrying")
        if not job:
            _worker_wake.wait(1)
            _worker_wake.clear()


def start_processing_worker() -> None:
    global _worker_thread
    recover_interrupted_jobs()
    if _worker_thread and _worker_thread.is_alive():
        _worker_wake.set()
        return
    _worker_stop.clear()
    _worker_thread = threading.Thread(target=_worker_loop, name="synthesis-worker", daemon=True)
    _worker_thread.start()
    _worker_wake.set()


def stop_processing_worker() -> None:
    global _worker_thread
    _worker_stop.set()
    _worker_wake.set()
    if _worker_thread:
        _worker_thread.join(timeout=2)
    _worker_thread = None


@contextmanager
def quiesce_processing():
    """Prevent a job from using the database while it is being replaced."""
    with _processing_lock:
        yield


def wake_processing_worker() -> None:
    _worker_wake.set()


def _run_video_processing(video_id: str, video_url: str) -> None:
    if not _video_exists(video_id):
        return
    _summarize_single_video(video_id, video_url)


def _max_video_age_cutoff() -> datetime:
    max_age_days = 30
    try:
        max_age_days = int(get_setting("max_video_age_days") or "30")
    except (ValueError, TypeError):
        pass
    return datetime.now(timezone.utc) - timedelta(days=max_age_days)


def _discover_new_videos(channel_id: str, feed_url: str, limit: int = 5) -> list[tuple[str, str]]:
    xml_text = fetch_feed(feed_url)
    entries = parse_feed_entries(feed_url, xml_text, limit=limit)
    cutoff = _max_video_age_cutoff()
    jobs: list[tuple[str, str]] = []

    for entry in entries:
        video_id = entry["video_id"]

        if entry["published"]:
            try:
                published_dt = datetime.fromisoformat(entry["published"].replace("Z", "+00:00"))
                if published_dt < cutoff:
                    continue
            except (ValueError, TypeError):
                pass

        video_url = entry["link"] or f"https://www.youtube.com/watch?v={video_id}"
        with get_db() as conn:
            existing = conn.execute(
                "SELECT video_id FROM videos WHERE video_id=?",
                (video_id,),
            ).fetchone()
            if existing:
                continue

            conn.execute(
                "INSERT INTO videos (channel_id, video_id, title, url, thumbnail_url, published_at, processing_status, processing_error) "
                "VALUES (?, ?, ?, ?, ?, ?, 'queued', '')",
                (
                    channel_id,
                    video_id,
                    entry["title"],
                    video_url,
                    default_thumbnail_url(video_id),
                    entry["published"],
                ),
            )

        jobs.append((video_id, video_url))

    return jobs


def discover_channel_videos(channel_id: str, feed_url: str, limit: int = 5) -> list[str]:
    jobs = _discover_new_videos(channel_id, feed_url, limit=limit)
    _start_background_video_processing(jobs)
    return [video_id for video_id, _ in jobs]


def _extract_handle_from_metadata(metadata: dict) -> str:
    for field in ("uploader_id", "channel_url", "uploader_url"):
        value = metadata.get(field)
        if not isinstance(value, str):
            continue

        value = value.strip()
        if not value:
            continue

        if value.startswith("@"):
            return value[1:]

        match = re.search(r"/@@?([A-Za-z0-9._-]+)", value)
        if match:
            return match.group(1)

    return ""


def _ensure_manual_channel(channel_id: str, channel_name: str, feed_url: str, metadata: dict) -> None:
    handle = _extract_handle_from_metadata(metadata)
    resolved_name = channel_name
    avatar_url = ""

    if handle:
        resolved_id, handle_name, handle_avatar = resolve_handle_profile(handle)
        if resolved_id == channel_id:
            resolved_name = resolved_name or handle_name or handle
            avatar_url = handle_avatar
        else:
            handle = ""

    if not resolved_name or not avatar_url:
        fetched_name, fetched_avatar = fetch_channel_profile(channel_id)
        resolved_name = resolved_name or fetched_name
        avatar_url = avatar_url or fetched_avatar

    if avatar_url:
        cache_channel_avatar(channel_id, avatar_url)

    with get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO channels (channel_id, name, handle, feed_url, avatar_url, is_subscribed) VALUES (?, ?, ?, ?, ?, 0)",
            (channel_id, resolved_name, handle, feed_url, avatar_url),
        )
        conn.execute(
            "UPDATE channels SET name=CASE WHEN name='' THEN ? ELSE name END, "
            "handle=CASE WHEN handle='' THEN ? ELSE handle END, "
            "feed_url=CASE WHEN feed_url='' THEN ? ELSE feed_url END, "
            "avatar_url=CASE WHEN avatar_url='' THEN ? ELSE avatar_url END "
            "WHERE channel_id=?",
            (resolved_name, handle, feed_url, avatar_url, channel_id),
        )


def fetch_feed(feed_url: str, timeout: int = 15) -> str:
    req = Request(feed_url, headers={"User-Agent": "synthesis-rss/1.0"})
    with urlopen(req, timeout=timeout) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="replace")


def parse_feed_entries(feed_url: str, xml_text: str, limit: int = 5) -> list[dict]:
    root = safe_xml_fromstring(xml_text)
    entries: list[dict] = []
    for entry in root.findall("atom:entry", NS)[:limit]:
        video_id = (
            entry.findtext("yt:videoId", default="", namespaces=NS)
            or entry.findtext("atom:id", default="", namespaces=NS)
        ).strip()
        if not video_id:
            continue
        title = entry.findtext("atom:title", default="", namespaces=NS).strip()
        published = entry.findtext("atom:published", default="", namespaces=NS).strip()
        link = ""
        for ln in entry.findall("atom:link", NS):
            if ln.attrib.get("rel", "alternate") == "alternate" and ln.attrib.get("href"):
                link = ln.attrib["href"].strip()
                break
        entries.append({
            "video_id": video_id,
            "title": title,
            "published": published,
            "link": link,
        })
    return entries


def _parse_timestamp(start_time: str) -> int:
    """Convert HH:MM:SS to seconds."""
    try:
        parts = start_time.split(":")
        h, m, s = int(parts[0]), int(parts[1]), int(parts[2])
        return h * 3600 + m * 60 + s
    except (ValueError, IndexError):
        return 0


def _poll_and_enqueue() -> dict:
    """Poll all channel feeds and persist newly discovered videos as queued jobs.

    Phase 1 — discover new videos across *all* channels and insert them as
    ``queued`` (with title + thumbnail) so the UI can display them immediately.
    Returns a summary dict with counts.
    """
    stats = {"feeds_checked": 0, "new_videos": 0, "summarized": 0, "errors": 0}

    with get_db() as conn:
        channels = conn.execute(
            "SELECT channel_id, feed_url, name FROM channels WHERE is_subscribed=1"
        ).fetchall()

    # Phase 1: discover all new videos first so the full queue is visible
    all_jobs: list[tuple[str, str]] = []
    for ch in channels:
        feed_url = ch["feed_url"]
        channel_id = ch["channel_id"]
        if not feed_url:
            continue
        stats["feeds_checked"] += 1
        try:
            jobs = _discover_new_videos(channel_id, feed_url)
        except Exception as exc:
            logger.warning("Feed error for %s: %s", channel_id, exc)
            stats["errors"] += 1
            continue
        all_jobs.extend(jobs)

    stats["new_videos"] = len(all_jobs)

    _start_background_video_processing(all_jobs)

    return stats


def poll_and_summarize() -> dict:
    # ponytail: one process-wide poll lock; use a distributed lock if multi-worker
    # deployments are ever supported.
    if not _poll_lock.acquire(blocking=False):
        return {"feeds_checked": 0, "new_videos": 0, "summarized": 0, "errors": 0}
    try:
        return _poll_and_enqueue()
    finally:
        _poll_lock.release()


def _summarize_single_video(video_id: str, video_url: str) -> None:
    """Download subtitles, summarize, and store results for one video."""
    if not _video_exists(video_id):
        return

    metadata: dict = {}
    try:
        metadata = fetch_video_metadata(video_url)
    except Exception as exc:
        logger.warning("Metadata fetch failed for %s: %s", video_id, exc)

    # Update thumbnail and duration
    thumb = select_best_thumbnail(metadata)
    duration = metadata.get("duration")
    duration_seconds = int(duration) if isinstance(duration, (int, float)) and duration > 0 else None
    with get_db() as conn:
        if thumb:
            conn.execute("UPDATE videos SET thumbnail_url=? WHERE video_id=?", (thumb, video_id))
        if duration_seconds is not None:
            conn.execute("UPDATE videos SET duration_seconds=? WHERE video_id=?", (duration_seconds, video_id))

    # Update published_at from metadata if better info available
    try:
        pub = None
        ts = metadata.get("timestamp")
        if isinstance(ts, (int, float)):
            pub = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        rel_ts = metadata.get("release_timestamp")
        if isinstance(rel_ts, (int, float)):
            pub = datetime.fromtimestamp(rel_ts, tz=timezone.utc).isoformat()
        upload = metadata.get("upload_date")
        if isinstance(upload, str) and len(upload) == 8:
            pub = datetime.strptime(upload, "%Y%m%d").replace(tzinfo=timezone.utc).isoformat()
        if pub:
            with get_db() as conn:
                conn.execute("UPDATE videos SET published_at=? WHERE video_id=?", (pub, video_id))
    except Exception:
        pass

    with tempfile.TemporaryDirectory(prefix="synthesis_") as tmpdir:
        workdir = Path(tmpdir)
        transcript = None

        # 1) Try subtitle download
        try:
            srt_path = download_subtitles(
                video_url,
                workdir=workdir,
                video_metadata=metadata,
            )
            lines = parse_srt(srt_path)
            if not lines:
                raise RuntimeError("Parsed transcript is empty")
            transcript = format_transcript(lines)
        except RuntimeError as sub_err:
            logger.warning("Subtitles unavailable for %s: %s", video_id, sub_err)

            # 2) Whisper fallback
            whisper_enabled = (get_setting("whisper_fallback") or "false").lower() == "true"
            if not whisper_enabled:
                raise

            whisper_endpoint = get_setting("whisper_endpoint") or ""
            whisper_key = get_setting("whisper_key") or get_setting("llm_api_key") or ""
            whisper_provider = get_setting("whisper_provider") or "openai"
            whisper_model = get_setting("whisper_model") or "whisper-1"
            whisper_api_version = get_setting("whisper_api_version") or "2025-03-01-preview"
            if not whisper_key:
                raise RuntimeError(
                    f"Subtitles failed ({sub_err}) and Whisper is enabled but API key not configured"
                ) from sub_err
            if whisper_provider == "azure" and not whisper_endpoint:
                raise RuntimeError(
                    f"Subtitles failed ({sub_err}) and Whisper is enabled but Azure endpoint not configured"
                ) from sub_err

            logger.info("Falling back to Whisper transcription for %s", video_id)
            if _video_exists(video_id):
                _set_video_processing_state(video_id, "transcribing")

            audio_path = download_audio(video_url, workdir=workdir)
            transcript = transcribe_with_whisper(
                audio_path,
                provider=whisper_provider,
                endpoint=whisper_endpoint,
                api_key=whisper_key,
                model=whisper_model,
                api_version=whisper_api_version,
            )

    # Extract video title and channel name for LLM context
    video_title = metadata.get("title") or ""
    channel_name = metadata.get("channel") or metadata.get("uploader") or ""

    if not _video_exists(video_id):
        return
    _set_video_processing_state(video_id, "summarizing")
    result = summarize_transcript(transcript, title=video_title, channel=channel_name)

    if not _video_exists(video_id):
        return

    summary_text = result.get("summary", "")
    key_points = result.get("key_points", [])
    chapters = result.get("chapters", [])
    language = get_setting("summary_language") or "English"
    llm_model = str(result.get("llm_model") or "")
    prompt_version = str(result.get("prompt_version") or "")
    prompt_tokens = int(result.get("prompt_tokens") or 0)
    completion_tokens = int(result.get("completion_tokens") or 0)
    total_tokens = int(result.get("total_tokens") or (prompt_tokens + completion_tokens))
    llm_cost_raw = result.get("llm_cost_usd")
    llm_cost_usd = float(llm_cost_raw) if llm_cost_raw is not None else None

    # Use LLM-generated topic; fall back to first chapter title or key point
    primary_topic = result.get("primary_topic", "").strip()
    if not primary_topic:
        if chapters:
            primary_topic = chapters[0].get("title", "")
        elif key_points:
            primary_topic = key_points[0][:50]

    with get_db() as conn:
        conn.execute(
            "INSERT INTO summaries "
            "(video_id, summary_text, key_points, language, primary_topic, llm_model, prompt_version, prompt_tokens, completion_tokens, total_tokens, llm_cost_usd) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(video_id) DO UPDATE SET "
            "summary_text=excluded.summary_text, key_points=excluded.key_points, "
            "language=excluded.language, primary_topic=excluded.primary_topic, "
            "llm_model=excluded.llm_model, prompt_version=excluded.prompt_version, "
            "prompt_tokens=excluded.prompt_tokens, "
            "completion_tokens=excluded.completion_tokens, total_tokens=excluded.total_tokens, "
            "llm_cost_usd=excluded.llm_cost_usd, "
            "created_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
            (
                video_id,
                summary_text,
                json.dumps(key_points),
                language,
                primary_topic,
                llm_model,
                prompt_version,
                prompt_tokens,
                completion_tokens,
                total_tokens,
                llm_cost_usd,
            ),
        )
        conn.execute("DELETE FROM chapters WHERE video_id=?", (video_id,))
        for i, ch in enumerate(chapters):
            ts = _parse_timestamp(ch.get("start_time", "00:00:00"))
            conn.execute(
                "INSERT INTO chapters (video_id, timestamp_seconds, title, description, sort_order) "
                "VALUES (?, ?, ?, ?, ?)",
                (video_id, ts, ch.get("title", ""), ch.get("description", ""), i),
            )
        conn.execute(
            "UPDATE videos SET processing_status='ready', processing_error='', "
            "next_retry_at='', processing_updated_at=? WHERE video_id=?",
            (_utc_now(), video_id),
        )


def summarize_video_by_url(video_url: str) -> str:
    """Queue summarization for a given URL and return the video_id immediately."""
    import re

    m = re.search(r"(?:v=|youtu\.be/|/shorts/)([A-Za-z0-9_-]{11})", video_url)
    if not m:
        raise ValueError("Could not extract video ID from URL")
    video_id = m.group(1)

    with get_db() as conn:
        row = conn.execute(
            "SELECT video_id, processing_status FROM videos WHERE video_id=?",
            (video_id,),
        ).fetchone()

    if row and row["processing_status"] in {"queued", "downloading", "transcribing", "summarizing", "ready"}:
        return video_id

    try:
        metadata = fetch_video_metadata(video_url)
    except Exception as exc:
        raise RuntimeError(f"Could not fetch metadata: {exc}") from exc

    channel_id = metadata.get("channel_id", "")
    if not channel_id:
        raise RuntimeError("Could not determine channel for this video")

    channel_name = metadata.get("channel", "")
    title = metadata.get("title", "") or f"YouTube video {video_id}"
    thumb = select_best_thumbnail(metadata) or default_thumbnail_url(video_id)
    published = ""
    ts = metadata.get("timestamp")
    if isinstance(ts, (int, float)):
        published = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    rel_ts = metadata.get("release_timestamp")
    if isinstance(rel_ts, (int, float)):
        published = datetime.fromtimestamp(rel_ts, tz=timezone.utc).isoformat()

    duration = metadata.get("duration")
    duration_seconds = int(duration) if isinstance(duration, (int, float)) and duration > 0 else None

    feed_url = channel_id_to_feed_url(channel_id)
    _ensure_manual_channel(channel_id, channel_name, feed_url, metadata)

    with get_db() as conn:
        conn.execute(
            "INSERT INTO videos (channel_id, video_id, title, url, thumbnail_url, published_at, duration_seconds, processing_status, processing_error) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', '') "
            "ON CONFLICT(video_id) DO UPDATE SET "
            "channel_id=excluded.channel_id, title=excluded.title, url=excluded.url, "
            "thumbnail_url=excluded.thumbnail_url, published_at=excluded.published_at, "
            "duration_seconds=excluded.duration_seconds, "
            "processing_status='queued', processing_error='', processing_attempts=0, "
            "next_retry_at='', processing_updated_at=''",
            (channel_id, video_id, title, video_url, thumb, published, duration_seconds),
        )

    _start_background_video_processing([(video_id, video_url)])
    return video_id


def retry_video_processing(video_id: str) -> None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT video_id, url, processing_status FROM videos WHERE video_id=?",
            (video_id,),
        ).fetchone()
        if not row:
            raise ValueError("Video not found")

        if row["processing_status"] in {"queued", "downloading", "transcribing", "summarizing"}:
            return

        conn.execute("DELETE FROM chapters WHERE video_id=?", (video_id,))
        conn.execute("DELETE FROM summaries WHERE video_id=?", (video_id,))
        conn.execute(
            "UPDATE videos SET processing_status='queued', processing_error='', "
            "processing_attempts=0, next_retry_at='', processing_updated_at='' WHERE video_id=?",
            (video_id,),
        )

    _start_background_video_processing([(video_id, row["url"])])


def delete_video(video_id: str) -> None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT channel_id FROM videos WHERE video_id=?",
            (video_id,),
        ).fetchone()
        if not row:
            raise ValueError("Video not found")
        channel_id = row["channel_id"]

        conn.execute("DELETE FROM chapters WHERE video_id=?", (video_id,))
        conn.execute("DELETE FROM summaries WHERE video_id=?", (video_id,))
        conn.execute("DELETE FROM videos WHERE video_id=?", (video_id,))

    _cleanup_hidden_channel_if_empty(channel_id)
