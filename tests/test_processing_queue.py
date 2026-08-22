from __future__ import annotations

import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import backend.database as database
from backend.models import SettingsPayload
from backend.routers.settings import put_settings
from backend.services import feed_poller
from backend.services import subtitles
from pydantic import ValidationError


class ProcessingQueueTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "synthesis.db"
        self.db_patch = patch.object(database, "DATABASE_PATH", self.db_path)
        self.db_patch.start()
        database.init_db()
        with database.get_db() as conn:
            conn.execute(
                "INSERT INTO channels (channel_id, name, feed_url) VALUES ('channel', 'Channel', 'feed')"
            )

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.tmp.cleanup()

    def add_video(self, video_id: str, status: str = "queued", attempts: int = 0) -> None:
        with database.get_db() as conn:
            conn.execute(
                "INSERT INTO videos (channel_id, video_id, url, processing_status, processing_attempts) "
                "VALUES ('channel', ?, ?, ?, ?)",
                (video_id, f"https://youtube.com/watch?v={video_id}", status, attempts),
            )

    def video(self, video_id: str):
        with database.get_db() as conn:
            return conn.execute("SELECT * FROM videos WHERE video_id=?", (video_id,)).fetchone()

    def test_claim_is_atomic_and_increments_attempt(self) -> None:
        self.add_video("aaaaaaaaaaa")
        self.assertEqual(feed_poller._claim_next_video()[0], "aaaaaaaaaaa")
        self.assertIsNone(feed_poller._claim_next_video())
        row = self.video("aaaaaaaaaaa")
        self.assertEqual(row["processing_status"], "downloading")
        self.assertEqual(row["processing_attempts"], 1)

    def test_interrupted_jobs_are_recovered_or_failed(self) -> None:
        self.add_video("aaaaaaaaaaa", "transcribing", 1)
        self.add_video("bbbbbbbbbbb", "summarizing", 3)
        feed_poller.recover_interrupted_jobs()
        self.assertEqual(self.video("aaaaaaaaaaa")["processing_status"], "queued")
        self.assertEqual(self.video("bbbbbbbbbbb")["processing_status"], "failed")

    def test_failure_backoff_and_final_failure(self) -> None:
        self.add_video("aaaaaaaaaaa", "downloading", 1)
        feed_poller._record_processing_failure("aaaaaaaaaaa", RuntimeError("temporary"))
        row = self.video("aaaaaaaaaaa")
        self.assertEqual(row["processing_status"], "queued")
        self.assertTrue(row["next_retry_at"])

        with database.get_db() as conn:
            conn.execute(
                "UPDATE videos SET processing_status='downloading', processing_attempts=3 "
                "WHERE video_id='aaaaaaaaaaa'"
            )
        feed_poller._record_processing_failure("aaaaaaaaaaa", RuntimeError("final"))
        row = self.video("aaaaaaaaaaa")
        self.assertEqual(row["processing_status"], "failed")
        self.assertEqual(row["processing_error"], "final")

    @patch.object(feed_poller, "_start_background_video_processing")
    def test_manual_retry_resets_state(self, start) -> None:
        self.add_video("aaaaaaaaaaa", "failed", 3)
        feed_poller.retry_video_processing("aaaaaaaaaaa")
        row = self.video("aaaaaaaaaaa")
        self.assertEqual(row["processing_status"], "queued")
        self.assertEqual(row["processing_attempts"], 0)
        self.assertEqual(row["next_retry_at"], "")
        start.assert_called_once()

    def test_legacy_settings_clients_do_not_reset_language_preference(self) -> None:
        with database.get_db() as conn:
            conn.execute("UPDATE settings SET value='true' WHERE key='language_preference_set'")
        put_settings(SettingsPayload())
        self.assertEqual(database.get_setting("language_preference_set"), "true")

    @patch.object(feed_poller, "format_transcript", return_value="transcript")
    @patch.object(feed_poller, "parse_srt", return_value=[object()])
    @patch.object(feed_poller, "download_subtitles", return_value=Path("captions.srt"))
    @patch.object(feed_poller, "fetch_video_metadata", return_value={"title": "Title"})
    @patch.object(feed_poller, "summarize_transcript")
    def test_success_replaces_chapters_and_finishes_atomically(
        self, summarize, metadata, download, parse, format_transcript
    ) -> None:
        summarize.return_value = {
            "summary": "Summary",
            "key_points": ["Point"],
            "chapters": [{"start_time": "00:00:05", "title": "One", "description": "Body"}],
            "prompt_version": "2",
        }
        self.add_video("aaaaaaaaaaa", "downloading", 1)
        with database.get_db() as conn:
            conn.execute(
                "INSERT INTO chapters (video_id, title) VALUES ('aaaaaaaaaaa', 'stale')"
            )
        feed_poller._summarize_single_video(
            "aaaaaaaaaaa", "https://youtube.com/watch?v=aaaaaaaaaaa"
        )
        with database.get_db() as conn:
            row = conn.execute(
                "SELECT processing_status FROM videos WHERE video_id='aaaaaaaaaaa'"
            ).fetchone()
            chapters = conn.execute(
                "SELECT title FROM chapters WHERE video_id='aaaaaaaaaaa'"
            ).fetchall()
            prompt_version = conn.execute(
                "SELECT prompt_version FROM summaries WHERE video_id='aaaaaaaaaaa'"
            ).fetchone()[0]
        self.assertEqual(row["processing_status"], "ready")
        self.assertEqual([chapter["title"] for chapter in chapters], ["One"])
        self.assertEqual(prompt_version, "2")


class MigrationTests(unittest.TestCase):
    def test_old_database_is_migrated_and_non_english_is_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "old.db"
            conn = sqlite3.connect(path)
            conn.executescript(
                "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');"
                "INSERT INTO settings VALUES ('summary_language', 'German');"
                "INSERT INTO settings VALUES ('subtitle_language', 'it');"
                "CREATE TABLE channels (id INTEGER PRIMARY KEY, channel_id TEXT UNIQUE, name TEXT DEFAULT '', "
                "handle TEXT DEFAULT '', feed_url TEXT DEFAULT '', avatar_url TEXT DEFAULT '', "
                "is_subscribed INTEGER DEFAULT 1, added_at TEXT DEFAULT '');"
                "CREATE TABLE videos (id INTEGER PRIMARY KEY, channel_id TEXT, video_id TEXT UNIQUE, "
                "title TEXT DEFAULT '', url TEXT DEFAULT '', thumbnail_url TEXT DEFAULT '', "
                "published_at TEXT DEFAULT '', discovered_at TEXT DEFAULT '', is_read INTEGER DEFAULT 0, "
                "duration_seconds INTEGER, processing_status TEXT DEFAULT 'ready', processing_error TEXT DEFAULT '');"
                "CREATE TABLE summaries (id INTEGER PRIMARY KEY, video_id TEXT UNIQUE, "
                "summary_text TEXT DEFAULT '', key_points TEXT DEFAULT '[]', language TEXT DEFAULT 'English', "
                "primary_topic TEXT DEFAULT '', llm_model TEXT DEFAULT '', prompt_tokens INTEGER DEFAULT 0, "
                "completion_tokens INTEGER DEFAULT 0, total_tokens INTEGER DEFAULT 0, llm_cost_usd REAL, "
                "created_at TEXT DEFAULT '');"
            )
            conn.close()
            with patch.object(database, "DATABASE_PATH", path):
                database.init_db()
                with database.get_db() as migrated:
                    columns = {row[1] for row in migrated.execute("PRAGMA table_info(videos)")}
                    summary_columns = {
                        row[1] for row in migrated.execute("PRAGMA table_info(summaries)")
                    }
                    preference = migrated.execute(
                        "SELECT value FROM settings WHERE key='language_preference_set'"
                    ).fetchone()[0]
                    subtitle_setting = migrated.execute(
                        "SELECT 1 FROM settings WHERE key='subtitle_language'"
                    ).fetchone()
            self.assertIn("processing_attempts", columns)
            self.assertIn("next_retry_at", columns)
            self.assertIn("prompt_version", summary_columns)
            self.assertEqual(preference, "true")
            self.assertIsNone(subtitle_setting)

    def test_pricing_defaults_are_current_and_user_entries_survive(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pricing.db"
            with patch.object(database, "DATABASE_PATH", path):
                database.init_db()
                self.assertEqual(database.get_setting("llm_model"), "gpt-5.6-luna")
                self.assertEqual(
                    {row["model_name"] for row in database.get_all_model_pricing()},
                    set(database.DEFAULT_MODEL_PRICING),
                )
                with database.get_db() as conn:
                    conn.execute("DELETE FROM model_pricing")
                    conn.execute(
                        "DELETE FROM settings WHERE key='model_pricing_defaults_version'"
                    )
                    conn.execute(
                        "UPDATE settings SET value='gpt-5.4-nano' WHERE key='llm_model'"
                    )
                    conn.executemany(
                        "INSERT INTO model_pricing "
                        "(model_name, input_price_per_1m, cached_input_price_per_1m, output_price_per_1m) "
                        "VALUES (?, ?, ?, ?)",
                        (
                            ("gpt-5.4-nano", 0.20, 0.02, 1.25),
                            ("gpt-5-mini", 0.25, 0.025, 2.00),
                            ("gpt-4.1", 9.00, 0.50, 8.00),
                            ("custom-model", 1.00, None, 2.00),
                        ),
                    )

                database.init_db()
                prices = {row["model_name"] for row in database.get_all_model_pricing()}

                self.assertTrue(set(database.DEFAULT_MODEL_PRICING) <= prices)
                self.assertIn("gpt-5.4-nano", prices)  # selected legacy model
                self.assertIn("gpt-4.1", prices)  # customized legacy price
                self.assertIn("custom-model", prices)
                self.assertNotIn("gpt-5-mini", prices)  # untouched old default

                with database.get_db() as conn:
                    conn.execute("DELETE FROM model_pricing WHERE model_name='gpt-5.6-sol'")
                database.init_db()
                prices = {row["model_name"] for row in database.get_all_model_pricing()}
                self.assertNotIn("gpt-5.6-sol", prices)  # user deletion stays deleted


class BoundaryTests(unittest.TestCase):
    def test_source_languages_are_detected_without_duplicates(self) -> None:
        self.assertEqual(
            subtitles._source_languages({
                "language": "it",
                "original_language": "it",
                "subtitles": {"en": []},
                "automatic_captions": {"de": []},
            }),
            ["it", "en", "de"],
        )

    def test_only_the_seven_supported_languages_are_accepted(self) -> None:
        for language in database.SUPPORTED_LANGUAGES:
            self.assertEqual(SettingsPayload(summary_language=language).summary_language, language)
        with self.assertRaises(ValidationError):
            SettingsPayload(summary_language="Klingon")

    @patch("backend.services.subtitles.subprocess.run")
    def test_metadata_timeout_becomes_a_retryable_runtime_error(self, run) -> None:
        run.side_effect = subprocess.TimeoutExpired("yt-dlp", subtitles.METADATA_TIMEOUT_SECONDS)
        with self.assertRaisesRegex(RuntimeError, "timed out"):
            subtitles.fetch_video_metadata("https://youtube.com/watch?v=aaaaaaaaaaa")


if __name__ == "__main__":
    unittest.main()
