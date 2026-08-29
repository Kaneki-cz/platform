"""Always-on entry point — used by start_server.ps1, NOT for everyday dev work
(keep using `python run_dev.py` for that, via VS Code or a terminal).

Identical to run_dev.py except `reload=False`: file-watching/auto-reload has
no place in a process that's meant to just stay up 24/7 on this machine (it
adds overhead and — worse — can restart itself mid-request if any file's
mtime changes, e.g. a log file written into this same folder).

Still sets the Windows SelectorEventLoop policy before uvicorn is imported,
for the same asyncio/httpx DNS bug on Windows described in run_dev.py's
docstring — this fix is still needed here, --reload or not.
"""
import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)
