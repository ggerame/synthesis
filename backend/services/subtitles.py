"""yt-dlp subtitle download, SRT parsing, and Whisper transcription fallback."""

from __future__ import annotations

import logging
import re
import subprocess
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import List

logger = logging.getLogger(__name__)


@dataclass
class SubtitleLine:
    index: int
    start: timedelta
    end: timedelta
    text: str


def _parse_timecode(value: str) -> timedelta:
    hours, minutes, rest = value.split(":", 2)
    seconds, millis = rest.split(",")
    return timedelta(
        hours=int(hours), minutes=int(minutes),
        seconds=int(seconds), milliseconds=int(millis),
    )


def parse_srt(path: Path) -> List[SubtitleLine]:
    blocks = path.read_text(encoding="utf-8").strip().split("\n\n")
    entries: List[SubtitleLine] = []
    for block in blocks:
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        if len(lines) < 3:
            continue
        try:
            index = int(lines[0])
        except ValueError:
            continue
        times = lines[1].split(" --> ")
        if len(times) != 2:
            continue
        try:
            start = _parse_timecode(times[0])
            end = _parse_timecode(times[1])
        except ValueError:
            continue
        text = " ".join(lines[2:]).replace("  ", " ").strip()
        if text:
            entries.append(SubtitleLine(index=index, start=start, end=end, text=text))
    return entries


def format_transcript(lines: List[SubtitleLine], max_chars: int = 2_000_000) -> str:
    formatted = [f"[{line.start}] {line.text}" for line in lines]
    transcript = "\n".join(formatted)
    if len(transcript) <= max_chars:
        return transcript
    return transcript[:max_chars - 3] + "..."


def fetch_video_metadata(url: str, downloader: str = "yt-dlp") -> dict:
    proc = subprocess.run(
        [downloader, "--skip-download", "--no-warnings", "--dump-json", url],
        capture_output=True, text=True, check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Metadata fetch failed (code {proc.returncode}): {proc.stderr[:500]}")
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        import json
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue
    raise RuntimeError("Unable to parse video metadata")


def _extract_default_language(metadata: dict | None) -> str | None:
    if not metadata:
        return None
    for field in ("language", "original_language", "audio_language", "release_language"):
        val = metadata.get(field)
        if isinstance(val, str) and val.strip():
            return val.strip()
    subtitles = metadata.get("subtitles")
    if isinstance(subtitles, dict) and subtitles:
        return next(iter(subtitles.keys()))
    auto = metadata.get("automatic_captions")
    if isinstance(auto, dict) and auto:
        return next(iter(auto.keys()))
    return None


def download_subtitles(
    url: str,
    *,
    sub_lang: str = "en",
    downloader: str = "yt-dlp",
    workdir: Path,
    video_metadata: dict | None = None,
) -> tuple[Path, str]:
    """Download subtitles with layered fallbacks."""

    def build_cmd(lang: str, auto: bool) -> list[str]:
        cmd = [downloader, "--skip-download"]
        cmd.append("--write-auto-subs" if auto else "--write-subs")
        cmd.extend(["--convert-subs", "srt", "--sub-lang", lang, url])
        return cmd

    def snapshot() -> dict[Path, float]:
        return {p.resolve(): p.stat().st_mtime for p in workdir.glob("*.srt")}

    def find_new(before: dict[Path, float]) -> Path | None:
        for p in sorted(workdir.glob("*.srt"), key=lambda x: x.stat().st_mtime, reverse=True):
            if before.get(p.resolve(), -1) < p.stat().st_mtime:
                return p
        return None

    fallback = _extract_default_language(video_metadata)
    langs = []
    for lang in (sub_lang, fallback):
        if lang and lang not in langs:
            langs.append(lang)
    if not langs:
        raise RuntimeError("No subtitle languages available.")

    errors: list[str] = []
    for lang in langs:
        for auto in (False, True):
            before = snapshot()
            proc = subprocess.run(build_cmd(lang, auto), cwd=workdir, capture_output=True, text=True, check=False)
            if proc.returncode != 0:
                errors.append(f"{'auto' if auto else 'official'} {lang}: exit {proc.returncode}")
                continue
            found = find_new(before)
            if found:
                return found, lang
            errors.append(f"{'auto' if auto else 'official'} {lang}: no SRT produced")

    raise RuntimeError("Subtitle download failed: " + "; ".join(errors))


def select_best_thumbnail(metadata: dict | None) -> str:
    if not metadata:
        return ""
    thumbs = metadata.get("thumbnails")
    if isinstance(thumbs, list) and thumbs:
        candidates = [t for t in thumbs if isinstance(t, dict) and t.get("url")]
        if candidates:
            best = max(candidates, key=lambda t: (t.get("width", 0) * t.get("height", 0), t.get("height", 0)))
            return best.get("url", "")
    thumb = metadata.get("thumbnail")
    if isinstance(thumb, str) and thumb.strip():
        return thumb.strip()
    return ""


def extract_author(metadata: dict | None) -> str:
    if not metadata:
        return ""
    for field in ("uploader", "channel", "creator"):
        val = metadata.get(field)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


# ── Whisper fallback ────────────────────────────────────────────────────


def download_audio(
    url: str,
    *,
    downloader: str = "yt-dlp",
    workdir: Path,
) -> Path:
    """Download audio track as an m4a/opus file using yt-dlp."""
    proc = subprocess.run(
        [
            downloader,
            "--no-warnings",
            "-f", "bestaudio[ext=m4a]/bestaudio",
            "-o", "%(id)s.%(ext)s",
            url,
        ],
        cwd=workdir,
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Audio download failed (code {proc.returncode}): {proc.stderr[:500]}")

    audio_files = sorted(workdir.glob("*.*"), key=lambda p: p.stat().st_mtime, reverse=True)
    for f in audio_files:
        if f.suffix.lower() in (".m4a", ".opus", ".webm", ".ogg", ".mp3", ".wav"):
            return f

    raise RuntimeError("Audio download produced no recognisable audio file")


def transcribe_with_whisper(
    audio_path: Path,
    *,
    provider: str = "openai",
    endpoint: str = "",
    api_key: str,
    model: str = "whisper-1",
    api_version: str = "2025-03-01-preview",
    language: str | None = None,
) -> str:
    """Send an audio file to a Whisper-compatible API and return the transcript text."""
    from openai import AzureOpenAI, OpenAI

    if provider == "azure":
        if not endpoint:
            raise RuntimeError("Azure Whisper requires an endpoint (e.g. https://myresource.openai.azure.com/)")
        client = AzureOpenAI(
            azure_endpoint=endpoint,
            api_key=api_key,
            api_version=api_version,
        )
    else:
        if endpoint:
            base_url = endpoint.rstrip("/")
            if not base_url.endswith("/v1"):
                base_url += "/v1"
            client = OpenAI(base_url=base_url, api_key=api_key)
        else:
            client = OpenAI(api_key=api_key)

    with open(audio_path, "rb") as f:
        kwargs: dict = {"model": model, "file": f, "response_format": "text"}
        if language:
            kwargs["language"] = language
        transcript = client.audio.transcriptions.create(**kwargs)

    text = transcript if isinstance(transcript, str) else str(transcript)
    if not text.strip():
        raise RuntimeError("Whisper returned an empty transcript")
    return text.strip()
