"""Thin client for the AI model backing the physics assistant.

Talks to any OpenAI-compatible chat-completions endpoint — by default that's
Gemini's free tier (https://ai.google.dev/gemini-api/docs/openai), but the
same code works unchanged against a self-hosted Qwen server (vLLM/TGI),
OpenRouter, or anything else that speaks the same protocol; only the three
QWEN_* settings in .env need to change. Nothing outside app/services and
app/api/routes/ai_chat.py should ever import this module — the mobile app
must never see QWEN_API_BASE_URL or QWEN_API_KEY (see the "Important
Security Rule" in the plan).

QWEN_API_KEY may be a single key or several comma-separated keys (each its
own free-tier Gemini API key from a separate Google Cloud project) — see
_API_KEYS below for why that's worth doing.
"""
from __future__ import annotations

import socket
import time
from urllib.parse import urlsplit, urlunsplit

import httpx

from app.core.config import settings


class QwenUnavailableError(RuntimeError):
    """Raised when the GPU/Qwen server can't be reached or isn't configured yet."""


# QWEN_API_KEY may hold multiple keys separated by commas, e.g.
# "AQ.key-one,AQ.key-two,AQ.key-three" — each a separate free-tier Gemini
# API key (from separate Google Cloud projects). Free-tier rate limits are
# per-key/per-project, so on a 429 (quota exceeded) we fall through to the
# next key in the list instead of failing outright — this is what actually
# multiplies the effective request budget for concurrent users, since a
# personal "Gemini Pro" subscription does NOT raise API key rate limits
# (that's a separate consumer-app benefit; only enabling Cloud Billing on a
# project does that, see ai.google.dev/gemini-api/docs/google-ai-plans).
_API_KEYS = [k.strip() for k in settings.QWEN_API_KEY.split(",") if k.strip()]


def _resolve_ipv4(url: str) -> tuple[str, str]:
    """Resolve `url`'s host to an IPv4 address ourselves and return
    (url with that IP substituted in, original hostname).

    Root cause, confirmed via /api/v1/ai/debug-dns and /debug-dns-async:
    - A plain `socket.getaddrinfo(host, port, socket.AF_INET, ...)` on this
      machine consistently fails exactly once — on the very first DNS
      lookup a freshly-started server process makes — and then succeeds
      every single time after that (confirmed repeatedly: first call after
      each reload/restart fails, the next 3+ calls in the same process all
      succeed). That matches a known Windows quirk where the resolver/
      network stack isn't fully ready the instant a process starts.
    - httpx/httpcore's own resolver additionally asks for IPv6 (AF_UNSPEC)
      addresses, not just IPv4, which is its own separate problem on this
      machine — hence resolving IPv4-only ourselves rather than letting
      httpx do it.
    So: resolve IPv4-only ourselves, AND retry a couple of times with a
    short pause if the first attempt hits this cold-start failure, instead
    of giving up immediately.
    """
    parts = urlsplit(url)
    host = parts.hostname
    port = parts.port or (443 if parts.scheme == "https" else 80)

    last_exc: OSError | None = None
    for attempt in range(1, 4):
        try:
            infos = socket.getaddrinfo(host, port, socket.AF_INET, socket.SOCK_STREAM)
            ip = infos[0][4][0]
            netloc = f"{ip}:{port}"
            return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment)), host
        except OSError as exc:
            last_exc = exc
            print(f"[ai] DNS resolve for {host} failed on attempt {attempt}/3 ({exc}) — retrying")
            time.sleep(0.4)
    raise last_exc


async def chat_completion(messages: list[dict], *, temperature: float = 0.2, timeout: float = 30) -> str:
    """Call the Qwen server. Raises QwenUnavailableError if it can't respond.

    Callers (see ai_service.py) are expected to catch this and fall back to
    a local rule-based response so the rest of the stack stays testable
    before the GPU server is actually deployed (Phase 4).
    """
    if not settings.QWEN_API_BASE_URL or not _API_KEYS or _API_KEYS[0] == "change-me":
        # Printed (not just raised) because ai_service.py swallows this
        # exception to fall back gracefully — without a print, "the key is
        # still unset" and "the key is set but the call failed" look
        # identical from the app, and this is the #1 thing to rule out.
        print("[ai] QWEN_API_KEY is not set (still 'change-me') — edit backend/.env and restart the server.")
        raise QwenUnavailableError("Qwen endpoint is not configured yet")

    url = f"{settings.QWEN_API_BASE_URL.rstrip('/')}/chat/completions"
    payload = {
        "model": settings.QWEN_MODEL_NAME,
        "messages": messages,
        "temperature": temperature,
        # Some newer Gemini models spend part of the token budget on hidden
        # "thinking" tokens before writing the actual answer. Without an
        # explicit max_tokens, a low default can let thinking consume the
        # whole budget, leaving `content` empty/truncated. Give it room.
        "max_tokens": 2048,
    }

    # We resolve the IP ourselves (IPv4-only — see _resolve_ipv4) and
    # connect to it directly, since letting httpx do its own (dual-stack)
    # resolution is what's actually broken here. Because we're now
    # connecting to a bare IP instead of a hostname, TLS needs to be told
    # explicitly what hostname to use for SNI + certificate verification
    # (sni_hostname), and the server needs the real hostname in the Host
    # header to route/vhost the request correctly. This only needs doing
    # once per call, not once per key.
    resolved_url, host = _resolve_ipv4(url)

    last_exc: Exception | None = None
    for attempt, api_key in enumerate(_API_KEYS, start=1):
        headers = {"Authorization": f"Bearer {api_key}", "Host": host}
        try:
            # trust_env=False: don't let a stray HTTP_PROXY/HTTPS_PROXY env
            # var (left behind by a VPN/proxy tool, common on Windows)
            # hijack this call.
            async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
                resp = await client.post(
                    resolved_url,
                    headers=headers,
                    json=payload,
                    extensions={"sni_hostname": host},
                )
                if resp.status_code >= 400:
                    # Print the response body — this is where "invalid API
                    # key", "model not found", "quota exceeded" etc. show up.
                    print(f"[ai] key {attempt}/{len(_API_KEYS)} failed: HTTP {resp.status_code} — {resp.text[:300]}")
                resp.raise_for_status()
                data = resp.json()
                choice = data["choices"][0]
                content = choice["message"]["content"]
                print(
                    f"[ai] response ok (key {attempt}/{len(_API_KEYS)}) — "
                    f"finish_reason={choice.get('finish_reason')!r} content_len={len(content) if content else 0}"
                )
                return content
        except (OSError, httpx.HTTPError, KeyError, IndexError) as exc:
            last_exc = exc
            print(f"[ai] key {attempt}/{len(_API_KEYS)} raised {type(exc).__name__}: {exc}")
            # A 429 (quota exceeded) is exactly the case worth falling
            # through to the next key for; other errors (bad request,
            # invalid key, network hiccup) would likely fail on every key
            # too, but trying them anyway is cheap and harmless here.
            continue

    raise QwenUnavailableError(str(last_exc) if last_exc else "no AI API keys configured")
