# Physics Platform — Backend (FastAPI)

## What's implemented

- **Auth**: register / login (JWT bearer tokens) — `app/api/routes/auth.py`
- **Courses & Lessons**: read endpoints — `app/api/routes/courses.py`, `lessons.py`
- **Progress**: get/update per-lesson completion — `app/api/routes/progress.py`
- **AI Physics Assistant**: `POST /api/v1/ai/ask` — the only endpoint that talks
  to Qwen (never exposed to the mobile app directly) — `app/api/routes/ai_chat.py`
- **Physics Solver**: SymPy/NumPy-backed exact calculations — `app/services/physics_solver.py`
- **AI pipeline orchestration**: `app/services/ai_service.py` (works today with a
  local rule-based fallback; swap in real Qwen prompts once Phase 4's GPU
  server exists — see `app/services/qwen_client.py`)

## Run it locally

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# edit .env: at minimum set DATABASE_URL to a real Postgres instance,
# e.g. via Docker:
#   docker run --name physics-db -e POSTGRES_USER=physics_user \
#     -e POSTGRES_PASSWORD=physics_pass -e POSTGRES_DB=physics_db \
#     -p 5432:5432 -d postgres:16

python -m app.db.init_db      # creates tables
uvicorn app.main:app --reload --port 8000
```

Then open http://localhost:8000/docs for interactive Swagger UI.

## Try the AI pipeline without a GPU/Qwen server

`ai_service.py` automatically falls back to a small regex classifier when
Qwen isn't configured, so this works out of the box:

```bash
curl -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"student@example.com","password":"pass1234"}'

curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=student@example.com&password=pass1234"
# -> copy the access_token from the response

curl -X POST http://localhost:8000/api/v1/ai/ask \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"question":"A ball is launched at 20 m/s at an angle of 45 degrees, what is its range?"}'
```

## Project layout

```
app/
  core/       # config, security (JWT/password hashing)
  db/         # engine/session, init_db.py
  models/     # SQLAlchemy ORM models
  schemas/    # Pydantic request/response models
  api/routes/ # FastAPI routers
  services/   # physics_solver.py, qwen_client.py, ai_service.py
```

## Next steps toward the full plan

- Replace `init_db.py` with Alembic migrations before this touches real data.
- Add Redis-backed daily usage-limit counters in `ai_chat.py` (placeholders
  for `AI_DAILY_REQUEST_LIMIT_FREE/PRO` already exist in `core/config.py`).
- Deploy Qwen behind an OpenAI-compatible server (vLLM/TGI) and point
  `QWEN_API_BASE_URL` / `QWEN_API_KEY` at it — no code changes needed beyond
  refining the prompts in `ai_service.py`.
- Add a seed script for real course/lesson content.
