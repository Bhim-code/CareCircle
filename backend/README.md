# CareCircle API

The Python backend for the CareCircle app and admin panel.
FastAPI + PostgreSQL. It follows `api-contract.md`: JSON with camelCase fields,
ISO 8601 UTC dates, and errors shaped as `{ "error": { "code", "message" } }`.

## What you need

- Python 3.12 or newer
- PostgreSQL 16, either with Docker (easiest) or installed normally

## Run it

All commands are run from the `backend/` folder.

**1. Start the database** (with Docker Desktop running):

```bash
docker compose up -d
```

This creates two databases: `carecircle` for the API and `carecircle_test` for the tests.
Without Docker, install PostgreSQL and create a user `carecircle` (password `carecircle`)
that owns both databases.

**2. Install the API** (once):

```bash
python -m venv .venv
# Windows:            .venv\Scripts\activate
# macOS / Linux:      source .venv/bin/activate
pip install -r requirements-dev.txt
```

Then copy `.env.example` to `.env` (Windows: `copy .env.example .env`).

**3. Start the API** (the one command):

```bash
uvicorn app.main:app --reload
```

Then open:

- http://localhost:8000/health shows `{"status":"ok","database":"ok"}`
- http://localhost:8000/docs is the interactive API docs page, which FastAPI writes from the code

If `/health` says `"database":"unavailable"` (HTTP 503), the database is not running
or `DATABASE_URL` in `.env` is wrong.

## Test it

```bash
pytest
```

The tests always use `TEST_DATABASE_URL` (default `carecircle_test`), never your real data.

## Settings

Every setting comes from environment variables or `.env`. Nothing secret goes in Git.

| Variable | Example | What it does |
|---|---|---|
| `ENVIRONMENT` | `development` | `production` hides `/docs` and forbids `CORS_ORIGINS=*` |
| `DATABASE_URL` | `postgresql+psycopg://user:pass@localhost:5432/carecircle` | The API's database |
| `TEST_DATABASE_URL` | `...5432/carecircle_test` | Database used by `pytest` only |
| `CORS_ORIGINS` | `http://localhost:5500` | Comma-separated browser origins allowed to call the API (the admin panel) |
| `LOG_LEVEL` | `INFO` | Log detail |

## Folder structure

```
backend/
  app/
    main.py           Builds the app: CORS, error handlers, routes
    core/config.py    Settings from the environment
    core/errors.py    ApiError and the contract's error shape
    db/session.py     Database engine and the get_db dependency
    schemas/base.py   CamelModel: snake_case in Python, camelCase in JSON
    api/routes/       One file per feature (health.py now; auth, reminders... next)
  tests/              pytest
  docker-compose.yml  Local PostgreSQL
```

## Conventions for new endpoints

- Request and response bodies extend `CamelModel`. Unknown fields are rejected with 422,
  so nobody can sneak in fields like `"role": "admin"`.
- To fail, `raise ApiError(404)` (or 401, 403, 422 with `fields=`). Use 404, not 403, when a
  record belongs to someone else, so the API never reveals that it exists.
- Error messages and logs never include submitted values, so health information cannot leak.

## Database tables

Coming in Issue 2 (schema and Alembic migrations), along with the table diagram.
