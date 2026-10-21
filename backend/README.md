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
    db/models.py      Every table (keep in step with migrations/)
    schemas/base.py   CamelModel: snake_case in Python, camelCase in JSON
    api/routes/       One file per feature (health.py now; auth, reminders... next)
  migrations/         Alembic migrations (the real schema)
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

The schema lives in Alembic migrations (`migrations/versions/`), so a new database can be
built from nothing:

```bash
alembic upgrade head                              # build or update the database
alembic revision --autogenerate -m "what changed" # after editing app/db/models.py
alembic downgrade -1                              # undo the last migration
```

`pytest` builds its own database from these migrations on every run and fails if
`app/db/models.py` and the migrations disagree.

```mermaid
erDiagram
    users ||--o{ auth_sessions : "signs in"
    users ||--o{ password_reset_tokens : "resets"
    users ||--o| user_preferences : has
    users ||--o{ push_tokens : has
    users ||--o{ care_links : "patient invites"
    users ||--o{ care_links : "caregiver accepts"
    users ||--o{ medicines : takes
    medicines ||--o{ reminders : "job creates"
    reminders ||--o{ alerts_sent : "missed-dose alerts"
    users ||--o{ health_documents : owns
    users ||--o{ record_entries : "about patient"
    record_entries ||--o{ record_entry_history : "earlier versions"
    record_entries ||--o| entry_photos : "photo"
    users ||--o{ access_log : "viewer / patient"

    users { uuid id PK
            string email UK "lowercase"
            string role "patient | caregiver | admin | supervisor"
            string password_hash "argon2"
            bool is_active
            string timezone "IANA, e.g. America/St_Johns" }
    care_links { uuid id PK
                 uuid patient_id FK
                 uuid caregiver_id FK "null until accepted"
                 string invited_email
                 string status "pending | active | ended" }
    medicines { uuid id PK
                uuid patient_id FK
                string name
                string_array times "HH:MM local"
                date start_date
                date end_date "nullable" }
    reminders { uuid id PK
                uuid medicine_id FK
                timestamptz scheduled_at "UTC"
                timestamptz acknowledged_at "set only by the patient" }
    record_entries { uuid id PK
                     uuid patient_id FK
                     string kind "medical | behavioural | incident | medication"
                     timestamptz recorded_at "server sets"
                     uuid recorded_by FK "server sets"
                     int version }
    access_log { bigint id PK
                 uuid viewer_id FK
                 uuid patient_id FK
                 string action
                 timestamptz at "append-only" }
```

Rules the database enforces on its own:

- `role` can only be one of the four roles; emails are unique and stored in lowercase.
- Only one open (pending or active) link between a patient and an email address.
- `severity` only on incidents, `mood` only on behavioural records, `medicineName` only on
  medication records. Text limits match the contract (100 and 2000 characters).
- A reminder exists once per medicine and time; an alert is sent once per reminder,
  person and channel.
- `access_log` rows can be added but never changed or deleted (a trigger refuses).
