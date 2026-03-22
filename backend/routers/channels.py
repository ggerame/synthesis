"""Channel management endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from backend.database import get_db
from backend.models import ChannelIn, ChannelOut
from backend.services.channel_resolver import (
    cache_channel_avatar,
    channel_id_to_feed_url,
    delete_cached_channel_avatar,
    fetch_channel_profile,
    get_cached_channel_avatar,
    resolve_handle_profile,
)
from backend.services.feed_poller import discover_channel_videos

router = APIRouter(prefix="/api/channels", tags=["channels"])
logger = logging.getLogger(__name__)


@router.get("", response_model=list[ChannelOut])
def list_channels():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM channels WHERE is_subscribed=1 ORDER BY name"
        ).fetchall()

    return [
        ChannelOut(
            id=r["id"],
            channel_id=r["channel_id"],
            name=r["name"],
            handle=r["handle"],
            feed_url=r["feed_url"],
            avatar_url=r["avatar_url"],
            added_at=r["added_at"],
        )
        for r in rows
    ]


@router.post("", response_model=ChannelOut, status_code=201)
def add_channel(body: ChannelIn):
    import re

    cid = body.channel_id.strip()
    handle = body.handle.strip()
    name = ""
    avatar_url = ""

    # Extract handle or channel ID from full YouTube URLs
    if handle and not cid:
        url_handle = re.search(r"youtube\.com/@([A-Za-z0-9._-]+)", handle)
        url_channel = re.search(r"youtube\.com/channel/(UC[A-Za-z0-9_-]+)", handle)
        if url_handle:
            handle = url_handle.group(1)
        elif url_channel:
            cid = url_channel.group(1)
            handle = ""
        else:
            handle = handle.lstrip("@")

    if not cid and not handle:
        raise HTTPException(status_code=400, detail="Provide handle or channel_id")

    if handle and not cid:
        resolved_id, resolved_name, resolved_avatar = resolve_handle_profile(handle)
        if not resolved_id:
            raise HTTPException(status_code=400, detail=f"Could not resolve handle @{handle}")
        cid = resolved_id
        name = resolved_name or handle
        avatar_url = resolved_avatar

    if not cid.startswith("UC"):
        raise HTTPException(status_code=400, detail="Invalid channel ID format")

    if not name or not avatar_url:
        fetched_name, fetched_avatar = fetch_channel_profile(cid)
        name = name or fetched_name
        avatar_url = avatar_url or fetched_avatar

    if avatar_url:
        cache_channel_avatar(cid, avatar_url)

    feed_url = channel_id_to_feed_url(cid)

    with get_db() as conn:
        existing = conn.execute(
            "SELECT * FROM channels WHERE channel_id=?",
            (cid,),
        ).fetchone()
        if existing and existing["is_subscribed"]:
            raise HTTPException(status_code=409, detail="Channel already exists")

        if existing:
            conn.execute(
                "UPDATE channels SET name=?, handle=?, feed_url=?, avatar_url=?, is_subscribed=1 WHERE channel_id=?",
                (
                    name or existing["name"],
                    handle or existing["handle"],
                    feed_url,
                    avatar_url or existing["avatar_url"],
                    cid,
                ),
            )
        else:
            conn.execute(
                "INSERT INTO channels (channel_id, name, handle, feed_url, avatar_url, is_subscribed) VALUES (?, ?, ?, ?, ?, 1)",
                (cid, name, handle, feed_url, avatar_url),
            )
        row = conn.execute("SELECT * FROM channels WHERE channel_id=?", (cid,)).fetchone()

    try:
        discover_channel_videos(cid, feed_url)
    except Exception as exc:
        logger.warning("Initial discovery failed for %s: %s", cid, exc)

    return ChannelOut(
        id=row["id"],
        channel_id=row["channel_id"],
        name=row["name"],
        handle=row["handle"],
        feed_url=row["feed_url"],
        avatar_url=row["avatar_url"],
        added_at=row["added_at"],
    )


@router.get("/{channel_id}/avatar")
def get_channel_avatar(channel_id: str):
    with get_db() as conn:
        row = conn.execute(
            "SELECT avatar_url FROM channels WHERE channel_id=?",
            (channel_id,),
        ).fetchone()

    if not row or not row["avatar_url"]:
        raise HTTPException(status_code=404, detail="Avatar not found")

    avatar_path, content_type = get_cached_channel_avatar(channel_id)
    if avatar_path is None:
        avatar_path, content_type = cache_channel_avatar(channel_id, row["avatar_url"])

    if avatar_path is None:
        raise HTTPException(status_code=502, detail="Could not fetch avatar")

    return FileResponse(
        avatar_path,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.delete("/{channel_id}")
def delete_channel(channel_id: str):
    with get_db() as conn:
        row = conn.execute("SELECT 1 FROM channels WHERE channel_id=?", (channel_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Channel not found")
        conn.execute("DELETE FROM chapters WHERE video_id IN (SELECT video_id FROM videos WHERE channel_id=?)", (channel_id,))
        conn.execute("DELETE FROM summaries WHERE video_id IN (SELECT video_id FROM videos WHERE channel_id=?)", (channel_id,))
        conn.execute("DELETE FROM videos WHERE channel_id=?", (channel_id,))
        conn.execute("DELETE FROM channels WHERE channel_id=?", (channel_id,))
    delete_cached_channel_avatar(channel_id)
    return {"ok": True}
