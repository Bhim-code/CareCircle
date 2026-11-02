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

Then copy `.env.example` to `.env` (Windows: `copy .env.example .env`), build the
tables, and load the demo data:

```bash
alembic upgrade head
python -m app.seed
```

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

148 tests run against a real PostgreSQL database built from the migrations, in about
20 seconds. They always use `TEST_DATABASE_URL` (default `carecircle_test`), never your
data. GitHub Actions runs them on every push (`.github/workflows/backend.yml`).

## Demo data and staff accounts

```bash
python -m app.seed      # two demo companies with patients, caregivers, supervisors; password demo1234
python -m app.cli create-org --name "Harbour Home Care"
python -m app.cli create-staff --role supervisor --email sue@example.com --name "Sue" --organization "Harbour Home Care"
python -m app.cli create-staff --role admin --email al@example.com --name "Al"
python -m app.cli set-company --email ana@example.com --organization "Harbour Home Care"
python -m app.cli set-active --email someone@example.com --inactive
```

Admin and supervisor accounts can only be made with `app.cli` (never by sign-up).

**Roles and permissions.** People who sign up wait with role "pending" until a
supervisor gives them a role in the admin panel (People page). Supervisors can create,
edit and turn off people, assign roles, give extra permissions, and create roles with their
own permissions (Roles & permissions page). Nobody can change their own role or permissions,
and the last supervisor cannot be removed. The seed creates one company, Harbour Home Care:
`sue@` (supervisor), `ana@`, `bob@` (patients), `sam@` (caregiver), `pat@` and `carl@`
(waiting for a role), and `al@` (admin). All are `@demo.carecircle.test`, password `demo1234`.

## Background jobs

Run in a second terminal while the API is running:

```bash
python -m app.jobs                 # keeps running: reminders, alerts, pushes, cleanup
python -m app.jobs once alerts     # run one job now: reminders | alerts | due | cleanup
```

Missed-dose alerts go to linked caregivers who turned them on, 60 minutes after a dose
that was not confirmed, once each. With no `SMTP_HOST`, emails are written to the log;
calls and pushes are logged for the demo.

## Admin panel

See `../admin/README.md`. In short: `cd ../admin && python -m http.server 5500`, then
open http://localhost:5500.

## Endpoints

The full list with request and response shapes is at http://localhost:8000/docs.

| Area | Endpoints |
|---|---|
| Sign-in | `POST /auth/sign-up`, `/auth/sign-in`, `/auth/refresh`, `/auth/sign-out`, `/auth/password-reset`, `/auth/password-reset/confirm` |
| Me | `GET/PATCH /me`, `GET/PUT /me/preferences`, `PUT/DELETE /me/push-token`, `GET /me/access-log` |
| Care links | `POST /care-links/invitations`, `GET /care-links`, `POST /care-links/invitations/{id}/accept`, `DELETE /care-links/{id}` |
| Medicines | `GET/POST /medicines`, `DELETE /medicines/{id}`, `GET /reminders?day=`, `POST /reminders/{id}/acknowledge` |
| Records | `GET /health-records`, `GET/POST /entries`, `PUT /entries/{id}`, `POST /entries/photo`, `GET /files/photos/{id}` |
| People and roles | `GET /admin/me`, `GET/POST /admin/users`, `GET/PATCH/DELETE /admin/users/{id}` (profile; delete = turn off), `PUT /admin/users/{id}/role`, `PUT /admin/users/{id}/permissions`, `POST/DELETE /admin/users/{id}/photo`, `GET /admin/permissions`, `GET/POST /admin/roles`, `PATCH/DELETE /admin/roles/{id}` |
| Admin panel | `GET /admin/overview`, `/admin/users`, `PATCH /admin/users/{id}` (active, company), `/admin/patients/{id}` (+ `/reminders`, `/documents`, `/entries`, `.csv` exports), `/admin/caregivers/{id}`, `GET/POST /admin/organizations`, `/admin/access-log`. Supervisors see their own company only. |

Where the API adds to or differs from `api-contract.md`: **`docs/CONTRACT-NOTES.md`**
(please share with Biplav).

## More documents

- `docs/DESIGN.md`: design, tables, access rules, security and testing (for the report)
- `docs/DEPLOY.md`: the demo-day checklist and how to host it
- `docs/CONTRACT-NOTES.md`: notes for the app developer

## Settings

Every setting comes from environment variables or `.env`; `.env.example` lists and
explains all of them. A blank value means "use the default". The important ones:

| Variable | Example | What it does |
|---|---|---|
| `ENVIRONMENT` | `development` | `production` hides `/docs`, forces HTTPS, refuses `CORS_ORIGINS=*` and the placeholder secret |
| `DATABASE_URL` | `postgresql+psycopg://user:pass@localhost:5432/carecircle` | The API's database (`postgres://` from a host is fine) |
| `TEST_DATABASE_URL` | `...5432/carecircle_test` | Database used by `pytest` only |
| `JWT_SECRET` | 48+ random characters | Signs access tokens. Different in every environment. |
| `CORS_ORIGINS` | `http://localhost:5500` | Browser origins allowed to call the API (the admin panel) |
| `TRUST_PROXY_HEADERS` | `true` when hosted | Read the client IP and HTTPS from the host's proxy |
| `PHOTO_DIR` | `storage/photos` | Private folder for photos |
| `SMTP_HOST` … | | Real email; empty = log only |
| `PUSH_PROVIDER` | `log` or `expo` | Real phone pushes through Expo |

## Folder structure

```
backend/
  app/
    main.py             Builds the app: middleware, error handlers, routes
    core/               config, errors, security (passwords, tokens), rate limits, HTTPS
    db/models.py        Every table (keep in step with migrations/)
    db/session.py       Database engine and the get_db dependency
    schemas/            Request and response shapes (camelCase JSON)
    api/deps.py         "Who is asking?" and role guards, used by every endpoint
    api/routes/         auth, me, care_links, medicines, health_records, entries, admin
    services/access.py  "May this person see this patient?": the one place for that rule
    services/           reminders, photos, stats, mailer, sessions
    jobs/               background jobs and how notifications are sent
    cli.py              create staff accounts, turn accounts on/off
    seed.py             demo data
  migrations/           Alembic migrations (the real schema)
  tests/                pytest
  docs/                 design, deployment, notes for the app developer
  docker-compose.yml    Local PostgreSQL
```

## Conventions for new endpoints

- Request and response bodies extend `CamelModel`. Unknown fields are rejected with 422,
  so nobody can sneak in fields like `"role": "admin"`.
- Start from a guard in `api/deps.py` (`patient_only`, `current_user`, …) and check patient
  access with `services/access.py`. Use 404, not 403, when the data belongs to someone else.
- To fail, `raise ApiError(404)` (or 401, 403, 422 with `fields=`).
- Error messages, logs and notifications never include health information or submitted values.

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
