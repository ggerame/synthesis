"""Video endpoints: list, detail, mark read/unread, manual summarize."""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Query

from backend.database import get_db
from backend.models import (
    ChapterOut,
    PaginatedVideos,
    SummarizeRequest,
    SummaryOut,
    VideoDetail,
    VideoListItem,
    VideoReadPatch,
)
from backend.services.feed_poller import summarize_video_by_url
from backend.services.feed_poller import delete_video as delete_video_record
from backend.services.feed_poller import retry_video_processing

router = APIRouter(prefix="/api/videos", tags=["videos"])


@router.get("", response_model=PaginatedVideos)
def list_videos(
    status: str = Query("all", pattern="^(all|unread|read|failed)$"),
    channel_id: str = Query(""),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    sort: str = Query("published", pattern="^(published|analyzed)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
):
    where_clauses = []
    params: list = []

    if status == "unread":
        where_clauses.append("v.is_read = 0")
    elif status == "read":
        where_clauses.append("v.is_read = 1")
    elif status == "failed":
        where_clauses.append("v.processing_status = 'failed'")

    if channel_id:
        where_clauses.append("v.channel_id = ?")
        params.append(channel_id)

    where_sql = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    offset = (page - 1) * limit

    dir_sql = "DESC" if order == "desc" else "ASC"
    if sort == "analyzed":
        order_sql = (
            "ORDER BY "
            "CASE v.processing_status "
            "WHEN 'downloading' THEN 0 "
            "WHEN 'summarizing' THEN 1 "
            "WHEN 'queued' THEN 2 "
            "WHEN 'ready' THEN 3 "
            f"ELSE 4 END, "
            f"s.created_at {dir_sql}, v.published_at {dir_sql}"
        )
    else:
        order_sql = (
            "ORDER BY "
            "CASE v.processing_status "
            "WHEN 'downloading' THEN 0 "
            "WHEN 'summarizing' THEN 1 "
            "WHEN 'queued' THEN 2 "
            "WHEN 'ready' THEN 3 "
            f"ELSE 4 END, "
            f"v.published_at {dir_sql}"
        )

    with get_db() as conn:
        total_row = conn.execute(
            f"SELECT COUNT(*) as cnt FROM videos v{where_sql}", params
        ).fetchone()
        total = total_row["cnt"]

        rows = conn.execute(
            f"SELECT v.*, c.name as channel_name, c.handle as channel_handle, c.avatar_url as channel_avatar_url, "
            f"CASE WHEN s.video_id IS NULL THEN 0 ELSE 1 END as has_summary, "
            f"s.llm_model, s.prompt_tokens, s.completion_tokens, s.total_tokens, s.llm_cost_usd, s.created_at as summary_created_at "
            f"FROM videos v LEFT JOIN channels c ON v.channel_id = c.channel_id "
            f"LEFT JOIN summaries s ON s.video_id = v.video_id"
            f"{where_sql} {order_sql} LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()

    items = [
        VideoListItem(
            id=r["id"],
            channel_id=r["channel_id"],
            video_id=r["video_id"],
            title=r["title"],
            url=r["url"],
            thumbnail_url=r["thumbnail_url"],
            published_at=r["published_at"],
            discovered_at=r["discovered_at"],
            is_read=bool(r["is_read"]),
            duration_seconds=r["duration_seconds"] if r["duration_seconds"] is not None else None,
            channel_name=r["channel_name"] or "",
            channel_handle=r["channel_handle"] or "",
            channel_avatar_url=r["channel_avatar_url"] or "",
            has_summary=bool(r["has_summary"]),
            llm_model=r["llm_model"] or "",
            prompt_tokens=int(r["prompt_tokens"] or 0),
            completion_tokens=int(r["completion_tokens"] or 0),
            total_tokens=int(r["total_tokens"] or 0),
            llm_cost_usd=float(r["llm_cost_usd"]) if r["llm_cost_usd"] is not None else None,
            processing_status=r["processing_status"] or "ready",
            processing_error=r["processing_error"] or "",
        )
        for r in rows
    ]

    return PaginatedVideos(items=items, total=total, page=page, limit=limit)


@router.get("/{video_id}", response_model=VideoDetail)
def get_video(video_id: str):
    with get_db() as conn:
        row = conn.execute(
            "SELECT v.*, c.name as channel_name, c.handle as channel_handle, c.avatar_url as channel_avatar_url "
            "FROM videos v LEFT JOIN channels c ON v.channel_id = c.channel_id "
            "WHERE v.video_id = ?",
            (video_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Video not found")

        summary_row = conn.execute(
            "SELECT * FROM summaries WHERE video_id = ?", (video_id,)
        ).fetchone()
        chapter_rows = conn.execute(
            "SELECT * FROM chapters WHERE video_id = ? ORDER BY sort_order", (video_id,)
        ).fetchall()

    summary = None
    if summary_row:
        kp = summary_row["key_points"]
        try:
            key_points = json.loads(kp) if kp else []
        except json.JSONDecodeError:
            key_points = []
        summary = SummaryOut(
            id=summary_row["id"],
            video_id=summary_row["video_id"],
            summary_text=summary_row["summary_text"],
            key_points=key_points,
            language=summary_row["language"],
            primary_topic=summary_row["primary_topic"],
            llm_model=summary_row["llm_model"] or "",
            prompt_tokens=int(summary_row["prompt_tokens"] or 0),
            completion_tokens=int(summary_row["completion_tokens"] or 0),
            total_tokens=int(summary_row["total_tokens"] or 0),
            llm_cost_usd=float(summary_row["llm_cost_usd"]) if summary_row["llm_cost_usd"] is not None else None,
            created_at=summary_row["created_at"],
        )

    chapters = [
        ChapterOut(
            id=c["id"],
            timestamp_seconds=c["timestamp_seconds"],
            title=c["title"],
            description=c["description"],
            sort_order=c["sort_order"],
        )
        for c in chapter_rows
    ]

    return VideoDetail(
        id=row["id"],
        channel_id=row["channel_id"],
        video_id=row["video_id"],
        title=row["title"],
        url=row["url"],
        thumbnail_url=row["thumbnail_url"],
        published_at=row["published_at"],
        discovered_at=row["discovered_at"],
        is_read=bool(row["is_read"]),
        duration_seconds=row["duration_seconds"] if row["duration_seconds"] is not None else None,
        channel_name=row["channel_name"] or "",
        channel_handle=row["channel_handle"] or "",
        channel_avatar_url=row["channel_avatar_url"] or "",
        processing_status=row["processing_status"] or "ready",
        processing_error=row["processing_error"] or "",
        summary=summary,
        chapters=chapters,
    )


@router.patch("/{video_id}")
def update_video(video_id: str, body: VideoReadPatch):
    with get_db() as conn:
        row = conn.execute("SELECT 1 FROM videos WHERE video_id=?", (video_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Video not found")
        conn.execute(
            "UPDATE videos SET is_read=? WHERE video_id=?",
            (1 if body.is_read else 0, video_id),
        )
    return {"ok": True}


@router.post("/summarize")
def manual_summarize(body: SummarizeRequest):
    try:
        video_id = summarize_video_by_url(body.url)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"video_id": video_id}


@router.post("/{video_id}/retry")
def retry_video(video_id: str):
    try:
        retry_video_processing(video_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


@router.get("/{video_id}/delete-check")
def check_video_delete(video_id: str):
    """Check whether deleting this video would cause it to be re-downloaded."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT v.channel_id, v.published_at, c.is_subscribed "
            "FROM videos v LEFT JOIN channels c ON v.channel_id = c.channel_id "
            "WHERE v.video_id = ?",
            (video_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Video not found")

        if not row["is_subscribed"]:
            return {"will_redownload": False}

        published = row["published_at"]
        if not published:
            return {"will_redownload": False}

        from datetime import datetime, timedelta, timezone
        from backend.database import get_setting

        try:
            max_age = int(get_setting("max_video_age_days") or "30")
        except (ValueError, TypeError):
            max_age = 30
        cutoff = datetime.now(timezone.utc) - timedelta(days=max_age)
        try:
            pub_dt = datetime.fromisoformat(published.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return {"will_redownload": False}

        return {"will_redownload": pub_dt >= cutoff}


@router.delete("/{video_id}")
def delete_video(video_id: str):
    try:
        delete_video_record(video_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}
