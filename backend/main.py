"""FastAPI application entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from backend.database import bootstrap_settings_from_env, init_db
from backend.routers import channels, settings, system, videos
from backend.scheduler import start_scheduler, stop_scheduler
from backend.services.feed_poller import start_processing_worker, stop_processing_worker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_db()
    bootstrap_settings_from_env()
    start_processing_worker()
    start_scheduler()
    yield
    # Shutdown
    stop_scheduler()
    stop_processing_worker()


app = FastAPI(title="Synthesis", version="1.0.0", lifespan=lifespan)

# API routers
app.include_router(videos.router)
app.include_router(channels.router)
app.include_router(settings.router)
app.include_router(system.router)

# Serve frontend static files at /
frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
