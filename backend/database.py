"""SQLite database management — schema initialisation and connection helpers."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

from backend.config import DATABASE_PATH

SCHEMA_SQL = """\
CREATE TABLE IF NOT EXISTS channels (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id      TEXT    NOT NULL UNIQUE,
    name            TEXT    NOT NULL DEFAULT '',
    handle          TEXT    NOT NULL DEFAULT '',
    feed_url        TEXT    NOT NULL DEFAULT '',
    avatar_url      TEXT    NOT NULL DEFAULT '',
    is_subscribed   INTEGER NOT NULL DEFAULT 1,
    added_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS videos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id      TEXT    NOT NULL REFERENCES channels(channel_id),
    video_id        TEXT    NOT NULL UNIQUE,
    title           TEXT    NOT NULL DEFAULT '',
    url             TEXT    NOT NULL DEFAULT '',
    thumbnail_url   TEXT    NOT NULL DEFAULT '',
    published_at    TEXT    NOT NULL DEFAULT '',
    discovered_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    is_read         INTEGER NOT NULL DEFAULT 0,
    duration_seconds INTEGER,
    processing_status TEXT  NOT NULL DEFAULT 'ready',
    processing_error  TEXT  NOT NULL DEFAULT '',
    processing_attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT NOT NULL DEFAULT '',
    processing_updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS summaries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id        TEXT    NOT NULL UNIQUE REFERENCES videos(video_id),
    summary_text    TEXT    NOT NULL DEFAULT '',
    key_points      TEXT    NOT NULL DEFAULT '[]',
    language        TEXT    NOT NULL DEFAULT 'English',
    primary_topic   TEXT    NOT NULL DEFAULT '',
    llm_model       TEXT    NOT NULL DEFAULT '',
    prompt_version  TEXT    NOT NULL DEFAULT '',
    prompt_tokens   INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens    INTEGER NOT NULL DEFAULT 0,
    llm_cost_usd    REAL,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS chapters (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id        TEXT    NOT NULL REFERENCES videos(video_id),
    timestamp_seconds INTEGER NOT NULL DEFAULT 0,
    title           TEXT    NOT NULL DEFAULT '',
    description     TEXT    NOT NULL DEFAULT '',
    sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
    key             TEXT    PRIMARY KEY,
    value           TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS model_pricing (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    model_name                  TEXT    NOT NULL UNIQUE,
    input_price_per_1m          REAL    NOT NULL DEFAULT 0.0,
    cached_input_price_per_1m   REAL,
    output_price_per_1m         REAL    NOT NULL DEFAULT 0.0,
    created_at                  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at                  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
"""

DEFAULT_SETTINGS: dict[str, str] = {
    "llm_provider": "azure",
    "llm_endpoint": "",
    "llm_api_key": "",
    "llm_model": "gpt-5.6-luna",
    "azure_api_version": "2025-03-01-preview",
    "summary_language": "English",
    "poll_interval_minutes": "30",
    "max_video_age_days": "30",
    "whisper_fallback": "false",
    "whisper_provider": "openai",
    "whisper_endpoint": "",
    "whisper_key": "",
    "whisper_model": "whisper-1",
    "whisper_api_version": "2025-03-01-preview",
    "system_tone": "Analytical",
    "language_preference_set": "false",
}

SUPPORTED_LANGUAGES = ("English", "German", "Italian", "French", "Spanish", "Japanese", "Portuguese")

# Current OpenAI text pricing (input, cached input, output) per 1M tokens.
DEFAULT_MODEL_PRICING: dict[str, tuple[float, float | None, float]] = {
    "gpt-5.6-sol": (4.00, 0.40, 20.00),
    "gpt-5.6-terra": (2.00, 0.20, 12.00),
    "gpt-5.6-luna": (0.20, 0.02, 1.20),
}
MODEL_PRICING_DEFAULTS_VERSION = "2026-08-22"

# Used only to remove untouched defaults shipped by older Synthesis versions.
_LEGACY_DEFAULT_MODEL_PRICING: dict[str, tuple[float, float | None, float]] = {
    "gpt-5.4": (2.50, 0.25, 15.00),
    "gpt-5.4-mini": (0.75, 0.075, 4.50),
    "gpt-5.4-nano": (0.20, 0.02, 1.25),
    "gpt-5-mini": (0.25, 0.025, 2.00),
    "gpt-5-nano": (0.05, 0.005, 0.40),
    "gpt-4.1": (2.00, 0.50, 8.00),
    "gpt-4.1-mini": (0.40, 0.10, 1.60),
    "gpt-4.1-nano": (0.10, 0.025, 0.40),
}


def _db_path() -> Path:
    return DATABASE_PATH


def _seed_default_model_pricing(conn: sqlite3.Connection) -> None:
    """Migrate shipped prices once while preserving user-managed entries."""
    version = conn.execute(
        "SELECT value FROM settings WHERE key='model_pricing_defaults_version'"
    ).fetchone()
    if version and version[0] == MODEL_PRICING_DEFAULTS_VERSION:
        return

    selected = conn.execute("SELECT value FROM settings WHERE key='llm_model'").fetchone()
    selected_model = selected[0].strip().lower() if selected else ""
    for model_name, rates in _LEGACY_DEFAULT_MODEL_PRICING.items():
        if model_name == selected_model:
            continue
        conn.execute(
            "DELETE FROM model_pricing WHERE LOWER(model_name)=? "
            "AND input_price_per_1m=? AND cached_input_price_per_1m=? "
            "AND output_price_per_1m=?",
            (model_name, *rates),
        )

    for model_name, (input_price, cached_input_price, output_price) in DEFAULT_MODEL_PRICING.items():
        conn.execute(
            "INSERT OR IGNORE INTO model_pricing "
            "(model_name, input_price_per_1m, cached_input_price_per_1m, output_price_per_1m) "
            "VALUES (?, ?, ?, ?)",
            (model_name, input_price, cached_input_price, output_price),
        )
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('model_pricing_defaults_version', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (MODEL_PRICING_DEFAULTS_VERSION,),
    )


def init_db() -> None:
    """Create the database schema and seed default settings."""
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.executescript(SCHEMA_SQL)
    existing_language = conn.execute(
        "SELECT value FROM settings WHERE key='summary_language'"
    ).fetchone()
    had_language_preference = conn.execute(
        "SELECT 1 FROM settings WHERE key='language_preference_set'"
    ).fetchone() is not None

    # CREATE TABLE does not add columns to existing SQLite databases.
    video_columns = {row[1] for row in conn.execute("PRAGMA table_info(videos)")}
    for name, declaration in (
        ("processing_attempts", "INTEGER NOT NULL DEFAULT 0"),
        ("next_retry_at", "TEXT NOT NULL DEFAULT ''"),
        ("processing_updated_at", "TEXT NOT NULL DEFAULT ''"),
    ):
        if name not in video_columns:
            conn.execute(f"ALTER TABLE videos ADD COLUMN {name} {declaration}")
    summary_columns = {row[1] for row in conn.execute("PRAGMA table_info(summaries)")}
    if "prompt_version" not in summary_columns:
        conn.execute("ALTER TABLE summaries ADD COLUMN prompt_version TEXT NOT NULL DEFAULT ''")
    # Seed default settings if they don't exist yet
    for key, value in DEFAULT_SETTINGS.items():
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )
    conn.execute("DELETE FROM settings WHERE key='subtitle_language'")
    language = existing_language[0] if existing_language else "English"
    if language not in SUPPORTED_LANGUAGES:
        language = "English"
        conn.execute("UPDATE settings SET value=? WHERE key='summary_language'", (language,))
    if not had_language_preference:
        conn.execute(
            "UPDATE settings SET value=? WHERE key='language_preference_set'",
            ("true" if language != "English" else "false",),
        )
    _seed_default_model_pricing(conn)
    conn.commit()
    conn.close()


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    conn = sqlite3.connect(str(_db_path()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def bootstrap_settings_from_env() -> None:
    """Seed DB settings from env-vars only for keys that are still at their
    default value.  Once a user changes a setting through the UI the env-var
    will no longer overwrite it."""
    from backend.config import (
        LLM_ENDPOINT,
        LLM_API_KEY,
        LLM_MODEL,
        LLM_PROVIDER,
        POLL_INTERVAL_MINUTES,
        SUMMARY_LANGUAGE,
    )

    env_map: dict[str, str] = {}
    if LLM_PROVIDER:
        env_map["llm_provider"] = LLM_PROVIDER
    if LLM_ENDPOINT:
        env_map["llm_endpoint"] = LLM_ENDPOINT
    if LLM_API_KEY:
        env_map["llm_api_key"] = LLM_API_KEY
    if LLM_MODEL:
        env_map["llm_model"] = LLM_MODEL
    if POLL_INTERVAL_MINUTES:
        env_map["poll_interval_minutes"] = str(POLL_INTERVAL_MINUTES)
    if SUMMARY_LANGUAGE:
        env_map["summary_language"] = SUMMARY_LANGUAGE

    if not env_map:
        return

    with get_db() as conn:
        for key, value in env_map.items():
            # Only insert if the key doesn't exist yet — never overwrite
            # values that are already in the database.
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, value),
            )


def get_setting(key: str) -> str:
    with get_db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else ""


def get_all_settings() -> dict[str, str]:
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    return {r["key"]: r["value"] for r in rows}


def update_settings(data: dict[str, str]) -> None:
    with get_db() as conn:
        for key, value in data.items():
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )


def get_model_pricing(model_name: str) -> dict | None:
    """Get pricing for a specific model. Returns (input, cached_input, output) or None."""
    normalized = (model_name or "").strip().lower()
    if not normalized:
        return None
    
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM model_pricing WHERE LOWER(model_name) = ?", (normalized,)).fetchall()
    
    if rows:
        row = rows[0]
        return {
            "id": row["id"],
            "model_name": row["model_name"],
            "input_price_per_1m": row["input_price_per_1m"],
            "cached_input_price_per_1m": row["cached_input_price_per_1m"],
            "output_price_per_1m": row["output_price_per_1m"],
        }
    return None


def get_all_model_pricing() -> list[dict]:
    """Get all model pricing rules."""
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM model_pricing ORDER BY model_name").fetchall()
    return [
        {
            "id": r["id"],
            "model_name": r["model_name"],
            "input_price_per_1m": r["input_price_per_1m"],
            "cached_input_price_per_1m": r["cached_input_price_per_1m"],
            "output_price_per_1m": r["output_price_per_1m"],
        }
        for r in rows
    ]


def add_model_pricing(model_name: str, input_price: float, output_price: float, cached_input_price: float | None = None) -> int:
    """Add or update model pricing."""
    with get_db() as conn:
        conn.execute(
            "INSERT INTO model_pricing (model_name, input_price_per_1m, cached_input_price_per_1m, output_price_per_1m, updated_at) "
            "VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) "
            "ON CONFLICT(model_name) DO UPDATE SET "
            "input_price_per_1m=excluded.input_price_per_1m, "
            "cached_input_price_per_1m=excluded.cached_input_price_per_1m, "
            "output_price_per_1m=excluded.output_price_per_1m, "
            "updated_at=strftime('%Y-%m-%dT%H:%M:%SZ', 'now')",
            (model_name, input_price, cached_input_price, output_price),
        )
        result = conn.execute("SELECT id FROM model_pricing WHERE LOWER(model_name) = ?", (model_name.lower(),)).fetchone()
    return result["id"] if result else 0


def delete_model_pricing(model_id: int) -> None:
    """Delete model pricing by ID."""
    with get_db() as conn:
        conn.execute("DELETE FROM model_pricing WHERE id = ?", (model_id,))
