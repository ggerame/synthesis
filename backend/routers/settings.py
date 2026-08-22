"""Settings endpoints."""

from __future__ import annotations

import shutil
import sqlite3
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

from backend.config import DATABASE_PATH
from backend.database import (
    get_all_settings,
    update_settings,
    get_all_model_pricing,
    get_model_pricing,
    add_model_pricing,
    delete_model_pricing,
    init_db,
)
from backend.models import SettingsPayload, ModelPricingOut, ModelPricingIn
from backend.services.feed_poller import quiesce_processing, recover_interrupted_jobs, wake_processing_worker

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=SettingsPayload)
def get_settings():
    data = get_all_settings()
    return SettingsPayload(**data)


@router.put("", response_model=SettingsPayload)
def put_settings(body: SettingsPayload):
    data = body.model_dump()
    # Older extension builds do not send this newly added preference flag.
    if "language_preference_set" not in body.model_fields_set:
        data.pop("language_preference_set")
    update_settings(data)
    data = get_all_settings()
    return SettingsPayload(**data)


# ── Model Pricing ──────────────────────────────────────────────────────────

@router.get("/pricing", response_model=list[ModelPricingOut])
def list_pricing():
    """Get all model pricing rules."""
    pricing_list = get_all_model_pricing()
    return [ModelPricingOut(**p) for p in pricing_list]


@router.post("/pricing", response_model=ModelPricingOut)
def create_pricing(body: ModelPricingIn):
    """Add or update model pricing."""
    model_id = add_model_pricing(
        model_name=body.model_name,
        input_price=body.input_price_per_1m,
        output_price=body.output_price_per_1m,
        cached_input_price=body.cached_input_price_per_1m,
    )
    pricing = get_model_pricing(body.model_name)
    if not pricing:
        raise HTTPException(status_code=500, detail="Failed to create pricing")
    return ModelPricingOut(**pricing)


@router.delete("/pricing/{pricing_id}")
def remove_pricing(pricing_id: int):
    """Delete model pricing by ID."""
    delete_model_pricing(pricing_id)
    return {"ok": True}


# ── Database Export / Import ───────────────────────────────────────────────

TABLES_REQUIRED = {"channels", "videos", "summaries", "chapters", "settings", "model_pricing"}


@router.get("/export-db")
def export_database():
    """Return the SQLite database file as a download."""
    db_path = DATABASE_PATH
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="Database file not found")

    # Create a consistent snapshot using SQLite backup API
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
    tmp.close()
    tmp_path = Path(tmp.name)
    try:
        src = sqlite3.connect(str(db_path))
        dst = sqlite3.connect(str(tmp_path))
        src.backup(dst)
        dst.close()
        src.close()
    except Exception as exc:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=str(exc))

    return FileResponse(
        path=str(tmp_path),
        media_type="application/x-sqlite3",
        filename="synthesis.db",
    )


@router.post("/import-db")
async def import_database(file: UploadFile = File(...)):
    """Replace the current database with an uploaded SQLite file."""
    # Save upload to a temp file first
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
    try:
        contents = await file.read()
        tmp.write(contents)
        tmp.close()

        # Validate: must be a valid SQLite database with expected tables
        try:
            conn = sqlite3.connect(str(tmp.name))
            tables = {r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()}
            conn.close()
        except Exception:
            raise HTTPException(status_code=400, detail="Uploaded file is not a valid SQLite database.")

        missing = TABLES_REQUIRED - tables
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Database is missing required tables: {', '.join(sorted(missing))}",
            )

        # Wait for the current job so no connection writes through the replace.
        with quiesce_processing():
            db_path = DATABASE_PATH
            backup_path = db_path.with_suffix(".db.bak")
            if db_path.exists():
                src = sqlite3.connect(str(db_path))
                dst = sqlite3.connect(str(backup_path))
                src.backup(dst)
                dst.close()
                src.close()
            for suffix in ("-wal", "-shm"):
                Path(str(db_path) + suffix).unlink(missing_ok=True)
            shutil.copy2(tmp.name, str(db_path))
            init_db()
            recover_interrupted_jobs()
        wake_processing_worker()

        return {"ok": True, "detail": "Database imported successfully."}
    finally:
        Path(tmp.name).unlink(missing_ok=True)
