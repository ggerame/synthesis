# Synthesis

**A self-hosted YouTube intelligence dashboard that automatically discovers, transcribes, and summarizes videos from your subscriptions using any OpenAI-compatible LLM.**

New videos are detected via RSS feed polling, subtitles are downloaded with [yt-dlp](https://github.com/yt-dlp/yt-dlp), transcripts are analyzed by the LLM of your choice, and the structured results — summaries, key points, and AI-generated chapters — are served through a clean, dark-mode web UI.

> **Note on the frontend** — The frontend is built in plain vanilla JavaScript and Tailwind CSS. It was vibe-coded from the ground up by someone who genuinely hates frontend frameworks.

## Features

- **Multi-provider LLM support** — Azure OpenAI, OpenAI, or any OpenAI-compatible endpoint (Ollama, vLLM, Groq, and more)
- **Automatic video discovery** — RSS feed polling on a configurable interval
- **Structured summaries** — Each video gets a multi-paragraph summary, 6-10 key points, and auto-generated chapters with timestamps
- **Whisper fallback** — When subtitles aren't available, optionally transcribe audio via the Whisper API
- **Cost tracking** — Token counts and estimated USD cost per summary, powered by a configurable model pricing table
- **Multi-language output** — Generate summaries in English, German, Italian, French, Spanish, Japanese, or Portuguese
- **Configurable tone** — Analytical, Creative, or Minimalist system prompts
- **Long transcript handling** — Automatic chunked map-reduce summarization for videos that exceed the context window
- **Database export/import** — Full SQLite backup and restore from the Settings page
- **Dark / Light theme** — Toggle in the header, persisted in localStorage
- **Single-container deployment** — Everything runs in one Docker container with a bind-mounted SQLite database

## Quick Start

```bash
git clone https://github.com/ggerame/synthesis.git
cd synthesis
docker compose up -d
```

Open [http://localhost:8000](http://localhost:8000), go to **Settings**, pick your LLM provider, paste your API key, and you're done. No `.env` file needed — all configuration lives in the Settings page and is persisted in the database.

For headless or automated deployments, you can optionally pre-seed settings via a `.env` file (see `.env.example`).

## Screenshots

<!-- Add screenshots here -->

## Configuration

All settings are managed through the **Settings page** in the UI. Environment variables are entirely optional — they only seed the database on first startup and are ignored afterwards.

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `azure` | LLM backend: `azure`, `openai`, or `openai-compatible` |
| `AZURE_OPENAI_ENDPOINT` | — | Azure OpenAI resource endpoint URL |
| `AZURE_OPENAI_KEY` | — | API key (works for all providers) |
| `AZURE_OPENAI_MODEL` | `gpt-4.1` | Model deployment name |
| `POLL_INTERVAL_MINUTES` | `30` | How often to check RSS feeds (minutes) |
| `SUMMARY_LANGUAGE` | `English` | Language for generated summaries |
| `SYNTHESIS_DATA_DIR` | `/app/data` | Data directory (database + avatar cache) |

### Settings available in the UI

Beyond the env vars above, the Settings page exposes:

- **LLM provider tabs** (Azure OpenAI / OpenAI / OpenAI-compatible) with per-provider fields
- **API version** (Azure-specific)
- **System tone** (Analytical, Creative, Minimalist)
- **Max video age** — only process videos published within the last N days (default: 30)
- **Whisper fallback** — enable/disable, with its own provider, model, endpoint, and API key
- **Subtitle language** preference
- **Model pricing table** — add/edit/delete pricing rules for token cost estimation
- **Database export & import**

## Local Development

```bash
cd synthesis
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

You'll also need `ffmpeg` and `yt-dlp` installed on your system.

```bash
export SYNTHESIS_DATA_DIR=./data
uvicorn backend.main:app --reload
```

> Tailwind CSS is compiled at Docker build time using the standalone CLI. During local dev, the existing `frontend/css/styles.css` is used as-is. If you modify Tailwind classes, rebuild with:
> ```bash
> npx tailwindcss -i frontend/css/input.css -o frontend/css/styles.css --watch
> ```

Open [http://localhost:8000](http://localhost:8000).

## Architecture

```
┌──────────────────────────────────────────────────┐
│                    Browser                        │
│   Vanilla JS SPA + Tailwind CSS                   │
│   Pages: Feed · Video Detail · Settings           │
└─────────────────────┬────────────────────────────┘
                      │ REST API
┌─────────────────────▼────────────────────────────┐
│               FastAPI (Uvicorn)                    │
│   Routers: videos · channels · settings · system  │
│   Static files served at /                         │
├──────────────────────────────────────────────────┤
│            APScheduler (background)                │
│   RSS polling → subtitle download → LLM summary   │
├──────────────────────────────────────────────────┤
│   Services:                                        │
│   feed_poller · summarizer · subtitles ·           │
│   channel_resolver                                 │
├──────────────────────────────────────────────────┤
│               SQLite (WAL mode)                    │
│   channels · videos · summaries · chapters ·       │
│   settings · model_pricing                         │
└──────────────────────────────────────────────────┘
```

Everything runs as a single process inside one Docker container. The SQLite database and avatar cache are persisted via a bind-mounted `./data` volume.

## API Reference

### Videos

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/videos` | Paginated video list. Query: `status`, `channel_id`, `page`, `limit`, `sort`, `order` |
| `GET` | `/api/videos/{video_id}` | Full video detail with summary, chapters, and cost breakdown |
| `PATCH` | `/api/videos/{video_id}` | Mark read/unread (`{ "is_read": true }`) |
| `POST` | `/api/videos/summarize` | Submit a video URL for immediate summarization |
| `POST` | `/api/videos/{video_id}/retry` | Retry a failed video |
| `GET` | `/api/videos/{video_id}/delete-check` | Check if deletion will cause re-download |
| `DELETE` | `/api/videos/{video_id}` | Delete a video |

### Channels

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/channels` | List all subscribed channels |
| `POST` | `/api/channels` | Add channel by `@handle`, `UC...` ID, or full YouTube URL |
| `GET` | `/api/channels/{channel_id}/avatar` | Serve cached channel avatar |
| `DELETE` | `/api/channels/{channel_id}` | Unsubscribe and delete all associated data |

### Settings

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/settings` | Retrieve all settings |
| `PUT` | `/api/settings` | Update settings |
| `GET` | `/api/settings/pricing` | List model pricing rules |
| `POST` | `/api/settings/pricing` | Add or update a pricing rule |
| `DELETE` | `/api/settings/pricing/{id}` | Delete a pricing rule |
| `GET` | `/api/settings/export-db` | Download a SQLite database snapshot |
| `POST` | `/api/settings/import-db` | Upload and replace the database (creates `.bak` backup) |

### System

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check (database + LLM connectivity) |
| `POST` | `/api/refresh` | Trigger immediate feed poll + summarization |

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, Uvicorn, APScheduler |
| LLM | OpenAI Python SDK (Azure, OpenAI, or compatible endpoints) |
| Transcription | yt-dlp, ffmpeg, Whisper API (optional) |
| Token counting | tiktoken |
| XML parsing | defusedxml |
| Frontend | Vanilla JavaScript, Tailwind CSS v3, Manrope font, Material Symbols icons |
| Database | SQLite with WAL mode |
| Deployment | Docker (single container), docker compose |

## License

MIT
