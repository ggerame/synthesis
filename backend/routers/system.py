"""System endpoints: health check, manual refresh."""

from __future__ import annotations

import threading

from fastapi import APIRouter

from backend.models import HealthResponse
from backend.services.feed_poller import poll_and_summarize
from backend.services.summarizer import check_openai_connection

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health", response_model=HealthResponse)
def health():
    from backend.database import get_db

    db_status = "ok"
    try:
        with get_db() as conn:
            conn.execute("SELECT 1")
    except Exception as exc:
        db_status = str(exc)

    openai_status = check_openai_connection()
    return HealthResponse(
        status="ok" if db_status == "ok" else "degraded",
        database=db_status,
        openai=openai_status,
    )


@router.get("/stats/cost")
def total_cost():
    """Return the total amount spent on LLM summarization."""
    from backend.database import get_db

    with get_db() as conn:
        row = conn.execute("SELECT COALESCE(SUM(llm_cost_usd), 0) AS total FROM summaries").fetchone()
    return {"total_cost_usd": row["total"]}


@router.post("/refresh")
def refresh():
    """Trigger an immediate feed poll + summarization cycle in a background thread."""
    thread = threading.Thread(target=poll_and_summarize, daemon=True)
    thread.start()
    return {"status": "started"}
