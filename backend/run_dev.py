"""Dev server entry point — use this instead of the bare `uvicorn` CLI.

Why this file exists: on this machine, outbound async HTTPS calls made via
httpx (used for the AI assistant's calls to Gemini) fail with
"[Errno 11001] getaddrinfo failed" even though `curl` and `nslookup` both
reach the same host fine. This is a known class of Windows-only bug in
asyncio's default ProactorEventLoop (its DNS/socket handling over IOCP has
long-standing quirks — see https://github.com/encode/httpx/issues/3562 and
https://github.com/python/cpython/issues/122240 for other people hitting the
same wall). Switching to the SelectorEventLoop policy is the standard fix
(the same workaround the psycopg3 docs recommend for the same underlying
reason on Windows).

The policy MUST be set before anything creates an event loop — including
before `uvicorn` itself is imported, since uvicorn may otherwise establish
its own Proactor-based loop first. Running this script directly (instead of
the bare `uvicorn app.main:app --reload` command) guarantees the ordering.
"""
import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
