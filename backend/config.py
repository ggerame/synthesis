"""Configuration module — loads bootstrap environment variables with defaults."""

from __future__ import annotations

import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("SYNTHESIS_DATA_DIR", "/app/data"))
DATABASE_PATH = DATA_DIR / "synthesis.db"

LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "azure")
LLM_ENDPOINT = os.environ.get("LLM_ENDPOINT", "")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-5.4-nano")
POLL_INTERVAL_MINUTES = int(os.environ.get("POLL_INTERVAL_MINUTES", "30"))
SUMMARY_LANGUAGE = os.environ.get("SUMMARY_LANGUAGE", "English")
