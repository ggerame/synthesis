"""Pydantic schemas for all API request and response bodies."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


# ── Channels ────────────────────────────────────────────────────────────

class ChannelIn(BaseModel):
    handle: str = ""
    channel_id: str = ""


class ChannelOut(BaseModel):
    id: int
    channel_id: str
    name: str
    handle: str
    feed_url: str
    avatar_url: str = ""
    added_at: str


# ── Chapters ────────────────────────────────────────────────────────────

class ChapterOut(BaseModel):
    id: int
    timestamp_seconds: int
    title: str
    description: str
    sort_order: int


# ── Summaries ───────────────────────────────────────────────────────────

class SummaryOut(BaseModel):
    id: int
    video_id: str
    summary_text: str
    key_points: list[str]
    language: str
    primary_topic: str
    llm_model: str = ""
    prompt_version: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    llm_cost_usd: Optional[float] = None
    created_at: str


# ── Videos ──────────────────────────────────────────────────────────────

class VideoListItem(BaseModel):
    id: int
    channel_id: str
    video_id: str
    title: str
    url: str
    thumbnail_url: str
    published_at: str
    discovered_at: str
    is_read: bool
    duration_seconds: Optional[int] = None
    channel_name: str = ""
    channel_handle: str = ""
    channel_avatar_url: str = ""
    has_summary: bool = False
    llm_model: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    llm_cost_usd: Optional[float] = None
    processing_status: str = "ready"
    processing_error: str = ""
    processing_attempts: int = 0
    processing_max_attempts: int = 3
    next_retry_at: str = ""
    processing_updated_at: str = ""


class VideoDetail(BaseModel):
    id: int
    channel_id: str
    video_id: str
    title: str
    url: str
    thumbnail_url: str
    published_at: str
    discovered_at: str
    is_read: bool
    duration_seconds: Optional[int] = None
    channel_name: str = ""
    channel_handle: str = ""
    channel_avatar_url: str = ""
    processing_status: str = "ready"
    processing_error: str = ""
    processing_attempts: int = 0
    processing_max_attempts: int = 3
    next_retry_at: str = ""
    processing_updated_at: str = ""
    summary: Optional[SummaryOut] = None
    chapters: list[ChapterOut] = []


class VideoReadPatch(BaseModel):
    is_read: bool


class SummarizeRequest(BaseModel):
    url: str


# ── Settings ────────────────────────────────────────────────────────────

class SettingsPayload(BaseModel):
    llm_provider: str = "azure"
    llm_endpoint: str = ""
    llm_api_key: str = ""
    llm_model: str = "gpt-5.6-luna"
    azure_api_version: str = "2025-03-01-preview"
    summary_language: Literal["English", "German", "Italian", "French", "Spanish", "Japanese", "Portuguese"] = "English"
    language_preference_set: Literal["true", "false"] = "false"
    poll_interval_minutes: str = "30"
    max_video_age_days: str = "30"
    whisper_fallback: str = "false"
    whisper_provider: str = "openai"
    whisper_endpoint: str = ""
    whisper_key: str = ""
    whisper_model: str = "whisper-1"
    whisper_api_version: str = "2025-03-01-preview"
    system_tone: str = "Analytical"


# ── System ──────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    database: str
    openai: str


class PaginatedVideos(BaseModel):
    items: list[VideoListItem]
    total: int
    page: int
    limit: int


# ── Model Pricing ──────────────────────────────────────────────────────────

class ModelPricingIn(BaseModel):
    model_name: str
    input_price_per_1m: float = 0.0
    cached_input_price_per_1m: Optional[float] = None
    output_price_per_1m: float = 0.0


class ModelPricingOut(BaseModel):
    id: int
    model_name: str
    input_price_per_1m: float
    cached_input_price_per_1m: Optional[float] = None
    output_price_per_1m: float
