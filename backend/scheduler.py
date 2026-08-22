"""APScheduler setup — recurring feed-poll job wired into FastAPI lifespan."""

from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from backend.database import get_setting
from backend.services.feed_poller import poll_and_summarize

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def start_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return

    minutes = 30
    try:
        minutes = int(get_setting("poll_interval_minutes") or "30")
    except (ValueError, TypeError):
        pass

    _scheduler = BackgroundScheduler()
    _scheduler.add_job(
        poll_and_summarize,
        trigger=IntervalTrigger(minutes=minutes),
        id="feed_poll",
        name="Poll RSS feeds and summarize new videos",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=60,
    )
    _scheduler.start()
    logger.info("Scheduler started — polling every %d minutes", minutes)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("Scheduler stopped")
