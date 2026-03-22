"""LLM summarization service — supports Azure OpenAI, OpenAI, and OpenAI-compatible endpoints."""

from __future__ import annotations

import json
import logging
from typing import Any

from backend.database import get_setting, get_model_pricing

logger = logging.getLogger(__name__)

_PROVIDERS = ("azure", "openai", "openai-compatible")


def _get_provider() -> str:
    provider = (get_setting("llm_provider") or "azure").lower().strip()
    if provider not in _PROVIDERS:
        logger.warning("Unknown LLM provider '%s', falling back to 'azure'", provider)
        return "azure"
    return provider


def _usage_value(usage: Any, key: str) -> Any:
    if usage is None:
        return None
    if isinstance(usage, dict):
        return usage.get(key)
    return getattr(usage, key, None)


def _coerce_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _extract_usage(response: Any) -> dict[str, int]:
    usage = getattr(response, "usage", None)

    prompt_tokens = _coerce_int(_usage_value(usage, "prompt_tokens"))
    completion_tokens = _coerce_int(_usage_value(usage, "completion_tokens"))

    # Responses API often reports input/output token names.
    if prompt_tokens == 0:
        prompt_tokens = _coerce_int(_usage_value(usage, "input_tokens"))
    if completion_tokens == 0:
        completion_tokens = _coerce_int(_usage_value(usage, "output_tokens"))

    prompt_details = _usage_value(usage, "prompt_tokens_details")
    input_details = _usage_value(usage, "input_tokens_details")
    cached_prompt_tokens = _coerce_int(
        _usage_value(prompt_details, "cached_tokens")
        if prompt_details is not None
        else _usage_value(input_details, "cached_tokens")
    )

    total_tokens = _coerce_int(_usage_value(usage, "total_tokens"))
    if total_tokens == 0:
        total_tokens = prompt_tokens + completion_tokens

    return {
        "prompt_tokens": prompt_tokens,
        "cached_prompt_tokens": max(0, min(cached_prompt_tokens, prompt_tokens)),
        "completion_tokens": completion_tokens,
        "total_tokens": total_tokens,
    }


def _lookup_openai_price(model_name: str) -> tuple[float, float | None, float] | None:
    """Lookup model pricing from database. Note: name matching is case-insensitive."""
    pricing = get_model_pricing(model_name)
    if not pricing:
        return None
    return (
        pricing["input_price_per_1m"],
        pricing["cached_input_price_per_1m"],
        pricing["output_price_per_1m"],
    )


def _estimate_llm_cost_usd(
    provider: str,
    model_name: str,
    prompt_tokens: int,
    completion_tokens: int,
    cached_prompt_tokens: int = 0,
) -> float | None:
    if provider not in {"openai", "azure"}:
        return None

    rates = _lookup_openai_price(model_name)
    if not rates:
        return None

    input_rate, cached_input_rate, output_rate = rates
    cached_tokens = max(0, min(cached_prompt_tokens, prompt_tokens))
    non_cached_prompt_tokens = max(0, prompt_tokens - cached_tokens)

    prompt_cost = (non_cached_prompt_tokens / 1_000_000.0) * input_rate
    if cached_tokens > 0:
        if cached_input_rate is None:
            prompt_cost += (cached_tokens / 1_000_000.0) * input_rate
        else:
            prompt_cost += (cached_tokens / 1_000_000.0) * cached_input_rate

    completion_cost = (completion_tokens / 1_000_000.0) * output_rate
    return round(prompt_cost + completion_cost, 8)


def _get_encoding(model: str):
    """Return a tiktoken encoding for the given model, with fallback."""
    import tiktoken
    try:
        return tiktoken.encoding_for_model(model)
    except KeyError:
        return tiktoken.get_encoding("o200k_base")


def _count_message_tokens(messages: list[dict], model: str) -> int:
    """Approximate token count for a list of chat messages."""
    enc = _get_encoding(model)
    total = 0
    for msg in messages:
        total += 4  # per-message overhead (role, separators)
        total += len(enc.encode(msg.get("content", "")))
    total += 2  # reply priming
    return total


def _get_max_context_tokens(model: str) -> int:
    """Return max context window size from settings or a safe default."""
    custom = get_setting("max_context_tokens")
    if custom:
        try:
            return int(custom)
        except (TypeError, ValueError):
            pass
    return 128_000


def _get_client():
    from openai import AzureOpenAI, OpenAI

    provider = _get_provider()
    endpoint = get_setting("azure_openai_endpoint")
    key = get_setting("azure_openai_key")

    if provider == "azure":
        if not endpoint or not key:
            raise ValueError("Azure OpenAI endpoint and key must be configured in settings.")
        api_version = get_setting("azure_api_version") or "2025-03-01-preview"
        return AzureOpenAI(
            azure_endpoint=endpoint,
            api_key=key,
            api_version=api_version,
        )

    if provider == "openai":
        if not key:
            raise ValueError("OpenAI API key must be configured in settings.")
        return OpenAI(api_key=key)

    # openai-compatible
    if not endpoint:
        raise ValueError("API endpoint must be configured for OpenAI-compatible provider.")
    return OpenAI(
        base_url=endpoint,
        api_key=key or "not-needed",
    )


def _build_messages(transcript: str, language: str) -> list[dict]:
    schema_prompt = (
        'Respond ONLY with valid JSON matching this schema: {'
        '"summary": string,'
        '"key_points": array of strings,'
        '"chapters": array of {'
        '"title": string, "description": string, "start_time": string HH:MM:SS'
        '}}. All text must be written in ' + language + '.'
    )
    return [
        {
            "role": "system",
            "content": (
                "You are an expert at distilling video transcripts into dense, informative summaries. "
                "Your goal is to capture the actual substance of the content: the facts, arguments, data points, "
                "examples, and conclusions — not just describe what the video is about at a meta level. "
                "A reader who has NOT watched the video should come away fully informed after reading your output. "
                "Use the user's requested language for every field."
            ),
        },
        {
            "role": "user",
            "content": (
                "Produce a thorough summary of the following transcript.\n\n"
                "Rules:\n"
                "- `summary`: Write 3-5 paragraphs covering the main thesis, the reasoning and evidence presented, "
                "and the final conclusions or recommendations. Include specific facts, numbers, or examples from the video. "
                "Do NOT write 'this video explains...' — write the actual information directly.\n"
                "- `key_points`: 6-10 concrete takeaways. Each must state a specific fact, conclusion, or actionable insight "
                "— not a vague topic like 'the author discusses X'.\n"
                "- `chapters`: 4-8 chapters. Each `description` must be 2-4 sentences summarising the actual content "
                "covered in that segment (claims made, data shown, conclusions reached), not just what the segment is about.\n\n"
                + schema_prompt
                + "\n\nTranscript:\n"
                + transcript
            ),
        },
    ]


def _build_chunk_summary_messages(chunk: str, chunk_index: int, total_chunks: int, language: str) -> list[dict]:
    """Build prompt for summarising a single transcript chunk."""
    return [
        {
            "role": "system",
            "content": (
                "You are an expert at distilling video transcripts into dense, informative summaries. "
                "You are processing one segment of a longer transcript that has been split into parts. "
                "Capture all facts, arguments, data points, examples, and conclusions from this segment. "
                f"Write in {language}."
            ),
        },
        {
            "role": "user",
            "content": (
                f"This is segment {chunk_index + 1} of {total_chunks} from a video transcript.\n\n"
                "Produce a detailed plain-text summary of this segment. Include all specific facts, numbers, "
                "names, arguments, and conclusions. Preserve chronological order and note approximate timestamps "
                "if they appear in the transcript. Be thorough — this summary will be used to produce the final "
                "output, so nothing important should be left out.\n\n"
                f"Transcript segment:\n{chunk}"
            ),
        },
    ]


def _build_merge_messages(chunk_summaries: list[str], language: str) -> list[dict]:
    """Build prompt that merges per-chunk summaries into the final JSON output."""
    schema_prompt = (
        'Respond ONLY with valid JSON matching this schema: {'
        '"summary": string,'
        '"key_points": array of strings,'
        '"chapters": array of {'
        '"title": string, "description": string, "start_time": string HH:MM:SS'
        '}}. All text must be written in ' + language + '.'
    )
    combined = "\n\n---\n\n".join(
        f"[Segment {i + 1}]\n{s}" for i, s in enumerate(chunk_summaries)
    )
    return [
        {
            "role": "system",
            "content": (
                "You are an expert at distilling video transcripts into dense, informative summaries. "
                "Your goal is to capture the actual substance of the content: the facts, arguments, data points, "
                "examples, and conclusions — not just describe what the video is about at a meta level. "
                "A reader who has NOT watched the video should come away fully informed after reading your output. "
                f"Use {language} for every field."
            ),
        },
        {
            "role": "user",
            "content": (
                "Below are detailed summaries of consecutive segments of a video transcript. "
                "Combine them into a single coherent output. Remove redundancy from overlapping segments "
                "and ensure smooth narrative flow.\n\n"
                "Rules:\n"
                "- `summary`: Write 3-5 paragraphs covering the main thesis, the reasoning and evidence presented, "
                "and the final conclusions or recommendations. Include specific facts, numbers, or examples. "
                "Do NOT write 'this video explains...' — write the actual information directly.\n"
                "- `key_points`: 6-10 concrete takeaways. Each must state a specific fact, conclusion, or actionable insight "
                "— not a vague topic like 'the author discusses X'.\n"
                "- `chapters`: 4-8 chapters. Each `description` must be 2-4 sentences summarising the actual content "
                "covered in that segment, not just what the segment is about.\n\n"
                + schema_prompt
                + "\n\nSegment summaries:\n"
                + combined
            ),
        },
    ]


def _call_azure(client, model: str, messages: list[dict], max_output_tokens: int = 16_384) -> tuple[str, str, dict[str, int]]:
    response = client.responses.create(
        model=model,
        temperature=0.2,
        max_output_tokens=max_output_tokens,
        input=messages,
    )
    try:
        first_output = response.output[0]
        content = getattr(first_output, "content", None)
        if not content:
            raise RuntimeError("Azure response had no content")
        payload_text = getattr(content[0], "text", None)
        if not payload_text:
            raise RuntimeError("Azure response content missing text")
    except (AttributeError, IndexError, KeyError, TypeError) as exc:
        raise RuntimeError(f"Unexpected Azure response format: {response}") from exc

    model_used = getattr(response, "model", None) or model
    usage = _extract_usage(response)
    return payload_text, model_used, usage


def _call_chat_completions(client, model: str, messages: list[dict], max_output_tokens: int = 16_384) -> tuple[str, str, dict[str, int]]:
    response = client.chat.completions.create(
        model=model,
        temperature=0.2,
        max_tokens=max_output_tokens,
        messages=messages,
    )
    choice = response.choices[0]
    text = choice.message.content
    if not text:
        raise RuntimeError("LLM response had no content")

    model_used = getattr(response, "model", None) or model
    usage = _extract_usage(response)
    return text, model_used, usage


def _call_llm(client, provider: str, model: str, messages: list[dict],
              max_output_tokens: int = 16_384) -> tuple[str, str, dict[str, int]]:
    """Route to the correct provider and return (text, model_used, usage)."""
    if provider == "azure":
        return _call_azure(client, model, messages, max_output_tokens)
    return _call_chat_completions(client, model, messages, max_output_tokens)


def _parse_llm_json(payload_text: str) -> dict:
    """Strip markdown fences and parse JSON from LLM response."""
    text = payload_text.strip()
    if text.startswith("```"):
        first_nl = text.index("\n") if "\n" in text else 3
        text = text[first_nl + 1:]
    if text.endswith("```"):
        text = text[:-3]
    parsed = json.loads(text.strip())
    if not isinstance(parsed, dict):
        raise RuntimeError("LLM response JSON must be an object")
    return parsed


def _aggregate_usage(usages: list[dict[str, int]]) -> dict[str, int]:
    """Sum token usage across multiple LLM calls."""
    return {
        "prompt_tokens": sum(u["prompt_tokens"] for u in usages),
        "cached_prompt_tokens": sum(u.get("cached_prompt_tokens", 0) for u in usages),
        "completion_tokens": sum(u["completion_tokens"] for u in usages),
        "total_tokens": sum(u["total_tokens"] for u in usages),
    }


def _chunk_transcript(transcript: str, max_chunk_tokens: int, overlap_tokens: int, model: str) -> list[str]:
    """Split transcript into overlapping chunks that each fit within *max_chunk_tokens*."""
    enc = _get_encoding(model)
    tokens = enc.encode(transcript)

    if len(tokens) <= max_chunk_tokens:
        return [transcript]

    chunks: list[str] = []
    start = 0
    while start < len(tokens):
        end = min(start + max_chunk_tokens, len(tokens))
        chunk_text = enc.decode(tokens[start:end])

        # Snap to sentence boundary when not at the very end
        if end < len(tokens):
            search_limit = min(200, len(chunk_text) // 4)
            for i in range(len(chunk_text) - 1, len(chunk_text) - search_limit - 1, -1):
                if chunk_text[i] in ".!?\n":
                    chunk_text = chunk_text[: i + 1]
                    end = start + len(enc.encode(chunk_text))
                    break

        chunks.append(chunk_text)
        if end >= len(tokens):
            break
        start = max(start + 1, end - overlap_tokens)

    return chunks


def _chunked_summarize(
    client, provider: str, model: str, language: str, transcript: str,
    max_context: int, max_output: int,
) -> tuple[dict, str, dict[str, int]]:
    """Map-reduce summarization for transcripts that exceed the context window."""
    # Per-chunk output budget is smaller (summaries are plain text, not full JSON)
    chunk_output_budget = 4_096
    chunk_prompt_overhead = _count_message_tokens(
        _build_chunk_summary_messages("", 0, 1, language), model,
    )
    available = max_context - chunk_prompt_overhead - chunk_output_budget
    overlap = max(100, available // 10)

    chunks = _chunk_transcript(transcript, available, overlap, model)
    logger.info("Split transcript into %d chunks (overlap ~%d tokens)", len(chunks), overlap)

    all_usages: list[dict[str, int]] = []
    chunk_summaries: list[str] = []
    model_used = model

    for i, chunk in enumerate(chunks):
        msgs = _build_chunk_summary_messages(chunk, i, len(chunks), language)
        text, model_used, usage = _call_llm(client, provider, model, msgs, chunk_output_budget)
        chunk_summaries.append(text)
        all_usages.append(usage)
        logger.info("Chunk %d/%d summarized (%d tokens used)", i + 1, len(chunks), usage["total_tokens"])

    # Merge phase
    merge_msgs = _build_merge_messages(chunk_summaries, language)
    payload_text, model_used, merge_usage = _call_llm(client, provider, model, merge_msgs, max_output)
    all_usages.append(merge_usage)

    parsed = _parse_llm_json(payload_text)
    return parsed, model_used, _aggregate_usage(all_usages)


def _is_context_length_error(exc: Exception) -> bool:
    """Return True if the exception signals that the input exceeded the context window."""
    from openai import BadRequestError

    if not isinstance(exc, BadRequestError):
        return False

    # OpenAI / Azure return code="context_length_exceeded" in the body
    if getattr(exc, "code", None) == "context_length_exceeded":
        return True

    # Fallback: match common error message patterns
    msg = str(exc).lower()
    return any(
        phrase in msg
        for phrase in (
            "maximum context length",
            "context_length_exceeded",
            "tokens exceed",
            "too many tokens",
            "reduce the length",
        )
    )


def summarize_transcript(transcript: str) -> dict:
    """Send transcript to the configured LLM and return structured JSON.

    Returns dict with keys: summary, key_points, chapters, plus LLM usage metadata.
    Always attempts a single-pass call first. If the API returns a context-length
    error, falls back to chunked map-reduce with overlapping segments.
    """
    provider = _get_provider()
    model = get_setting("azure_openai_model") or "gpt-4.1"
    language = get_setting("summary_language") or "English"

    client = _get_client()
    max_output = 16_384
    messages = _build_messages(transcript, language)

    try:
        payload_text, model_used, usage = _call_llm(client, provider, model, messages, max_output)
        parsed = _parse_llm_json(payload_text)
    except Exception as exc:
        if not _is_context_length_error(exc):
            raise

        logger.info(
            "Single-pass call failed with context-length error: %s. "
            "Falling back to chunked summarization.",
            exc,
        )
        max_context = _get_max_context_tokens(model)
        parsed, model_used, usage = _chunked_summarize(
            client, provider, model, language, transcript, max_context, max_output,
        )

    parsed["llm_model"] = model_used
    parsed["prompt_tokens"] = usage["prompt_tokens"]
    parsed["completion_tokens"] = usage["completion_tokens"]
    parsed["total_tokens"] = usage["total_tokens"]
    parsed["llm_cost_usd"] = _estimate_llm_cost_usd(
        provider=provider,
        model_name=model_used,
        prompt_tokens=usage["prompt_tokens"],
        completion_tokens=usage["completion_tokens"],
        cached_prompt_tokens=usage.get("cached_prompt_tokens", 0),
    )

    return parsed


def check_openai_connection() -> str:
    """Return 'ok' or an error message string."""
    try:
        provider = _get_provider()
        endpoint = get_setting("azure_openai_endpoint")
        key = get_setting("azure_openai_key")

        if provider == "azure":
            if not endpoint or not key:
                return "not_configured"
        elif provider == "openai":
            if not key:
                return "not_configured"
        else:
            if not endpoint:
                return "not_configured"

        client = _get_client()
        client.models.list()
        return "ok"
    except Exception as exc:
        return str(exc)
