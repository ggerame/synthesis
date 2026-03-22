"""YouTube channel metadata resolution helpers."""

from __future__ import annotations

import re
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from backend.config import DATA_DIR

_HANDLE_RE = re.compile(r"^[A-Za-z0-9._-]{3,}$")
_USER_AGENT = "Mozilla/5.0 (compatible; synthesis/1.0)"
_TIMEOUT = 15
_AVATAR_DIR = DATA_DIR / "avatars"
_DEFAULT_AVATAR_CONTENT_TYPE = "image/jpeg"


def is_valid_handle(handle: str) -> bool:
    return _HANDLE_RE.fullmatch(handle) is not None


def _fetch(url: str) -> tuple[str | None, str | None]:
    req = Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urlopen(req, timeout=_TIMEOUT) as resp:
            return resp.read().decode("utf-8", errors="replace"), resp.geturl()
    except (HTTPError, URLError):
        return None, None


def _extract_channel_id(html: str, final_url: str | None) -> str | None:
    m = re.search(
        r"<meta[^>]+itemprop=[\"']channelId[\"'][^>]+content=[\"'](UC[^\"']+)[\"']",
        html, re.IGNORECASE,
    )
    if m:
        return m.group(1)

    m = re.search(
        r"<link[^>]+rel=[\"']canonical[\"'][^>]+href=[\"']([^\"']+)[\"']",
        html, re.IGNORECASE,
    )
    if m:
        ch = re.search(r"/channel/(UC[0-9A-Za-z_-]+)", m.group(1))
        if ch:
            return ch.group(1)

    if final_url:
        ch = re.search(r"/channel/(UC[0-9A-Za-z_-]+)", final_url)
        if ch:
            return ch.group(1)

    m = re.search(r"externalId\\?\"\s*:\s*\\?\"(UC[^\"\\]+)\"", html)
    if m:
        return m.group(1)

    m = re.search(r"channelId\\?\"\s*:\s*\\?\"(UC[^\"\\]+)\"", html)
    if m:
        return m.group(1)

    return None


def _extract_channel_name(html: str, fallback: str = "") -> str:
    name_match = re.search(r"<meta\s+property=[\"']og:title[\"']\s+content=[\"']([^\"']+)[\"']", html, re.IGNORECASE)
    return name_match.group(1).strip() if name_match else fallback


def _extract_avatar_url(html: str) -> str:
    avatar_match = re.search(r"<meta\s+property=[\"']og:image[\"']\s+content=[\"']([^\"']+)[\"']", html, re.IGNORECASE)
    if avatar_match:
        return avatar_match.group(1).strip()

    avatar_match = re.search(r'"avatar"\s*:\s*\{[^}]*"thumbnails"\s*:\s*\[(.*?)\]\s*\}', html, re.IGNORECASE)
    if avatar_match:
        urls = re.findall(r'"url"\s*:\s*"([^\"]+)"', avatar_match.group(1))
        if urls:
            return urls[-1].replace(r'\u0026', '&')

    return ""


def _avatar_cache_paths(channel_id: str) -> tuple[Path, Path]:
    safe_channel_id = re.sub(r"[^A-Za-z0-9_-]", "_", channel_id)
    return (
        _AVATAR_DIR / f"{safe_channel_id}.img",
        _AVATAR_DIR / f"{safe_channel_id}.content_type",
    )


def get_cached_channel_avatar(channel_id: str) -> tuple[Path | None, str]:
    avatar_path, content_type_path = _avatar_cache_paths(channel_id)
    if not avatar_path.exists() or avatar_path.stat().st_size == 0:
        return None, ""

    if content_type_path.exists():
        content_type = content_type_path.read_text(encoding="utf-8").strip()
        if content_type:
            return avatar_path, content_type

    return avatar_path, _DEFAULT_AVATAR_CONTENT_TYPE


def cache_channel_avatar(channel_id: str, avatar_url: str) -> tuple[Path | None, str]:
    if not channel_id or not avatar_url:
        return None, ""

    cached_path, content_type = get_cached_channel_avatar(channel_id)
    if cached_path is not None:
        return cached_path, content_type

    req = Request(avatar_url, headers={"User-Agent": _USER_AGENT})
    try:
        with urlopen(req, timeout=_TIMEOUT) as resp:
            content = resp.read()
            if not content:
                return None, ""
            content_type = resp.headers.get_content_type() or _DEFAULT_AVATAR_CONTENT_TYPE
    except (HTTPError, URLError, TimeoutError, OSError):
        return None, ""

    avatar_path, content_type_path = _avatar_cache_paths(channel_id)
    _AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    avatar_path.write_bytes(content)
    content_type_path.write_text(content_type, encoding="utf-8")
    return avatar_path, content_type


def delete_cached_channel_avatar(channel_id: str) -> None:
    avatar_path, content_type_path = _avatar_cache_paths(channel_id)
    for path in (avatar_path, content_type_path):
        if path.exists():
            path.unlink()


def fetch_channel_profile(channel_id: str) -> tuple[str, str]:
    html, _ = _fetch(f"https://www.youtube.com/channel/{channel_id}")
    if html is None:
        return "", ""
    return _extract_channel_name(html), _extract_avatar_url(html)


def resolve_handle(raw_handle: str) -> tuple[str | None, str | None]:
    """Resolve a YouTube @handle to (channel_id, channel_name).

    Returns (None, None) if resolution fails.
    """
    handle = raw_handle.strip().lstrip("@")
    if not is_valid_handle(handle):
        return None, None

    for url in (f"https://www.youtube.com/@{handle}", f"https://www.youtube.com/{handle}"):
        html, final_url = _fetch(url)
        if html is None:
            continue
        # Reject unexpected redirects to a different handle
        if final_url:
            hm = re.search(r"/@([^/?#]+)", final_url)
            if hm and hm.group(1).lower() != handle.lower():
                continue

        channel_id = _extract_channel_id(html, final_url)
        if not channel_id:
            continue

        name = _extract_channel_name(html, handle)
        return channel_id, name

    return None, None


def resolve_handle_profile(raw_handle: str) -> tuple[str | None, str | None, str]:
    """Resolve a YouTube @handle to (channel_id, channel_name, avatar_url)."""
    handle = raw_handle.strip().lstrip("@")
    if not is_valid_handle(handle):
        return None, None, ""

    for url in (f"https://www.youtube.com/@{handle}", f"https://www.youtube.com/{handle}"):
        html, final_url = _fetch(url)
        if html is None:
            continue

        if final_url:
            hm = re.search(r"/@([^/?#]+)", final_url)
            if hm and hm.group(1).lower() != handle.lower():
                continue

        channel_id = _extract_channel_id(html, final_url)
        if not channel_id:
            continue

        return channel_id, _extract_channel_name(html, handle), _extract_avatar_url(html)

    return None, None, ""


def channel_id_to_feed_url(channel_id: str) -> str:
    return f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
