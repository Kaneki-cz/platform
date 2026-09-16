"""Shared rate-limiter instance — imported by main.py (to register the
exception handler) and by any route module that needs a @limiter.limit()
decorator.  Keeping it in a single module avoids circular imports between
app/main.py and the individual route files."""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
