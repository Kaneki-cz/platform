"""Shared rate-limiter instance — imported by main.py (to register the
exception handler) and by any route module that needs a @limiter.limit()
decorator.  Keeping it in a single module avoids circular imports between
app/main.py and the individual route files.

Redis is used as the storage backend so that rate-limit counters are shared
across all uvicorn workers (the service runs with --workers 3).  Without a
shared backend every worker keeps its own in-memory counter, meaning the
effective limit is multiplied by the number of workers."""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(
    key_func=get_remote_address,
    storage_uri="redis://localhost:6379",
)
