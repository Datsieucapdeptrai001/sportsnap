# AGENTS.md — SportSnap

Web app that recognises a sport from photos (FastAPI backend + React frontend).
University course project (Computer Vision, IUH). **Read SPEC.md before every task.**

## Ground rules
- Work on **ONE slice at a time** (SPEC.md §8). Do not start the next slice.
- **Never** modify, retrain, convert, or "improve" the model file or `labels.json`.
- **Never** change preprocessing on your own. It must match the training notebook (SPEC.md §4).
- **Never invent numbers.** Any metric shown in the UI must come from `backend/data/experiments.json`.
- One small commit per slice, message `slice N: <summary>`. Run tests before committing.
- Keep it simple: no database, no auth, no extra frameworks unless SPEC.md says so.
- If SPEC.md is ambiguous, or a dependency fails to install, **stop and report** instead of guessing.
- Do not delete or rewrite files outside the current slice's scope.

## Conventions
- Backend: Python, type hints everywhere, Pydantic models for every request/response,
  config via `.env` (pydantic-settings), no hard-coded paths.
- Frontend: React + TypeScript (strict), Vite, Tailwind, shadcn/ui, lucide-react, sonner (toasts).
  All HTTP calls go through `frontend/src/lib/api.ts`.
- UI text in **Vietnamese**. Code, comments, commit messages in **English**.
- Handle errors explicitly: bad/oversized file, model not loaded, camera permission denied,
  insecure context (no HTTPS), network failure. Never show a raw stack trace to the user.

## Commands
Backend (from `backend/`):
```
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
pytest -q
```
Frontend (from `frontend/`):
```
npm install
npm run dev        # proxies /api to http://localhost:8000
npm run build      # output frontend/dist, served by FastAPI at "/"
npx tsc --noEmit
```

## Definition of done (every slice)
1. Acceptance criteria of the slice in SPEC.md §8 all pass.
2. `pytest -q` and `npx tsc --noEmit` and `npm run build` pass.
3. README "Run it" section still works from a clean checkout.
4. Final report lists: files changed, how you verified, anything you were unsure about.
