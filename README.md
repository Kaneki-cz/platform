# Physics Educational Platform

This repo implements the plan's Phase 1–6 scaffolding: a working backend, a
working mobile app, and a physics AI pipeline that runs end-to-end today
(with a local fallback standing in for the not-yet-deployed Qwen GPU server).

```
physics-platform/
  backend/   FastAPI + PostgreSQL + SymPy/NumPy physics solver + AI pipeline
  mobile/    Expo + React Native + TypeScript + Expo Router
  docs/      visualization_schema.md — the AI <-> app visualization contract
```

Each app has its own README with setup/run instructions:
[`backend/README.md`](backend/README.md), [`mobile/README.md`](mobile/README.md).

## Status vs. the plan

| Phase | Status |
|---|---|
| 1 — Environment | You install these locally (Node, VS Code, Git, Android Studio, Python, Postgres) — see the setup notes sent separately. Project creation is done here. |
| 2 — Mobile App | Done: navigation, auth screens, Home, Courses, Lessons, Profile. |
| 3 — Backend | Done: FastAPI project, Postgres models, JWT auth, REST APIs. |
| 4 — AI | Pipeline wired end-to-end with a local fallback; deploying real Qwen on a GPU server is still open. |
| 5 — Physics Intelligence | Done for 3 problem types (kinematics, projectile motion, net force) — SymPy/NumPy verified, not left to the LLM. |
| 6 — Visualization | JSON schema defined + 3 renderers implemented as numeric-summary placeholders; a real chart/SVG library is the next step. |
| 7 — Testing | Solver + pipeline smoke-tested; no automated test suite yet. |
| 8 — Deployment | Not started — everything currently runs locally. |

## Quickest path to see it working end-to-end

1. `cd backend`, follow its README to get Postgres + the API running.
2. `cd mobile`, follow its README to run the Expo app (Expo Go on your phone
   is the fastest way — no Android Studio required to just try it).
3. Register a user in the app, then ask the AI Assistant something like
   *"A ball is launched at 20 m/s at an angle of 45 degrees, what is its
   range?"* — it will run through the full pipeline (analysis → SymPy/NumPy
   solver → explanation → visualization) using the local fallback classifier
   until Qwen is deployed.

## Security rule enforced

The mobile app never holds a Qwen API key and never calls Qwen directly —
`mobile/lib/api.ts` only ever talks to the FastAPI backend, and
`backend/app/services/qwen_client.py` (the only module that knows about
Qwen's URL/key) is only ever imported by `backend/app/services/ai_service.py`.
