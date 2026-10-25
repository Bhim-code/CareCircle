# CareCircle backend: design, data, access rules and testing

CareCircle reminds patients to take their medicines and alerts the people who care for
them when a dose is missed. This document describes the server side: the API, the
database, the admin panel and the background jobs.

## 1. Architecture

```
 Phone app (Expo / React Native)  ──┐
                                    ├── HTTPS + JSON ──►  FastAPI (Python)  ──►  PostgreSQL
 Admin panel (HTML + Tailwind + JS) ┘                         │
                                                              └── Background jobs (Python)
                                                                   email · phone · push
```

- **API** (`app/`): FastAPI. Every endpoint declares its request and response shapes with
  Pydantic, which gives input validation and the generated docs page at `/docs`.
- **Database**: PostgreSQL 16, accessed with SQLAlchemy 2. The schema is versioned
  with Alembic migrations, and the test suite builds its database from them.
- **Jobs** (`app/jobs/`): a separate process that creates reminder rows, sends
  missed-dose alerts to caregivers, and sends "medicine due" pushes to patients.
- **Admin panel** (`../admin/`): a static web page for supervisors and admins that uses the
  same API.

Code is layered: `api/routes` (HTTP) → `services` (rules: access, reminders, photos,
statistics) → `db/models` (tables). The access rules live in one module,
`services/access.py`, plus one sign-in check in `api/deps.py`, so they can be reviewed
and tested in one place.

## 2. Data

The ER diagram is in `backend/README.md`. Main tables:

| Table | Holds |
|---|---|
| `users` | Everyone: role (`patient`, `caregiver`, `admin`, `supervisor`), argon2 password hash, time zone, active flag |
| `auth_sessions` | One row per refresh token (stored as a SHA-256 hash), grouped by sign-in |
| `care_links` | Patient → caregiver invitations and links (`pending`, `active`, `ended`) |
| `medicines`, `reminders` | What to take and when (local times), and each dose as an exact UTC moment with when it was confirmed |
| `alerts_sent` | One row per missed-dose alert; its unique key makes "send once" a database rule |
| `health_documents` | Document list per patient |
| `record_entries`, `record_entry_history` | Written records and a full copy of every earlier version |
| `entry_photos` | Private photos attached to records |
| `user_preferences`, `push_tokens` | Settings and phone tokens |
| `access_log` | Who viewed which patient's data, when, and whether it was allowed. Append-only. |

Design decisions:

- **Time.** Medicines store local clock times and the patient's IANA time zone.
  Reminders store exact UTC moments, so daylight-saving changes keep "08:00" at 08:00.
  A reminder is never created for a moment before its medicine was added, which avoids
  false "missed" alerts.
- **Never confirm on the patient's behalf.** Only the patient's "I took it" sets
  `acknowledged_at`.
- **Defence in depth.** Key rules are also database constraints: allowed roles, one open
  link per patient and email, kind-specific fields, text limits, unique reminders and
  alerts, and the append-only access log (a trigger refuses UPDATE and DELETE).

## 3. Who may do what

| | Patient | Caregiver | Supervisor | Admin |
|---|---|---|---|---|
| Sign up in the app | yes | yes | no, created on the server | no, created on the server |
| Own reminders, confirm a dose, medicines, documents | yes | no | — | — |
| Read written records | own | linked patients only (active link) | all, read only, logged | all, read only, logged |
| Write medical / behavioural / incident / medication | yes / no / yes / yes | no / yes / yes / yes | no | no |
| Edit a record | only their own | only their own | no | no |
| Invite or remove caregivers | yes | accept, decline or leave | — | — |
| Admin panel | no | no | read only | read, and turn accounts on or off |
| See who viewed their data | yes | — | the full access log | the full access log |

How this is enforced:

1. **Who is asking.** `current_user` (`api/deps.py`) checks the token signature and
   expiry, that the account is still active, and that the sign-in has not been ended. So
   signing out or deactivating an account takes effect on the very next request.
2. **Role.** Route guards (`patient_only`, `staff`, `admin` and so on) return **403**.
3. **Which patient.** `services/access.py` answers "may this person read this patient?".
   Caregivers need an *active* link. Someone else's data returns **404**, never 403, so the
   API does not reveal that a record exists.
4. **Input.** Every body rejects unknown fields, so `recordedBy`, `role` or `isActive`
   cannot be smuggled in. `recordedAt` and `recordedBy` always come from the token.
5. **Logging.** Caregiver reads and every supervisor or admin view and export are
   written to `access_log`, as are refused attempts to use the admin API.

## 4. Security measures

- Passwords: argon2id. A wrong password, an unknown email and a deactivated account
  get the same 401 and take the same time.
- Tokens: 15-minute JWT access tokens. Refresh tokens are random, stored only as hashes,
  single-use, and reuse of an old one ends the whole sign-in (theft detection).
- Password reset never reveals whether an email exists. Links are single-use, expire in 30
  minutes, and a reset signs the person out everywhere.
- Rate limits on sign-in (per IP and per account), sign-up, refresh and password reset.
- HTTPS only in production (plain HTTP refused, HSTS), security headers, `no-store`
  caching on API responses, CORS limited to the admin panel's address.
- Photos: type checked from the file's bytes (JPEG or PNG only), at most 5 MB, stored under
  random names outside any web folder, and served only through HMAC-signed links that
  expire in 15 minutes. Links are handed out only to people allowed to read the record.
- No health information in logs, error messages or notifications. Errors never echo
  submitted values. Alerts say "a scheduled dose", never the medicine.
- CSV exports are protected against spreadsheet formula injection.
- Admin panel: data is inserted as text only (no HTML), with a strict
  Content-Security-Policy and no third-party scripts, fonts or styles.

## 5. Testing

`pytest` runs 112 automated tests against a real PostgreSQL database built from the
migrations (about 20 seconds). Each test starts with empty tables.

| File | What it proves |
|---|---|
| `test_auth.py` (22) | Sign-up cannot create staff; same error for bad password or unknown email; forged tokens refused; refresh rotation and theft detection; sign-out and deactivation work at once; password reset; rate limits; HTTPS enforcement |
| `test_entries.py` (27) | Two patients and two caregivers: nobody reads or edits anyone else's records (404 by id, too); role/kind table; server-set fields; history kept; ending a link removes access; photo type, size, ownership, expiry and forged links |
| `test_medicines_reminders.py` (12) | Own reminders only; the patient's local day; daylight saving; idempotent generation; "I took it" only by the owner and never by the server |
| `test_admin.py` (9) | Patients and caregivers refused (and logged); supervisor read only; every view and export logged; CSV injection safe; patients see who viewed them |
| `test_jobs.py` (10) | Missed-dose alert after 60 minutes, sent once, only to linked caregivers who opted in, retried on failure; due pushes once; no medicine names |
| `test_care_links.py` (6), `test_preferences.py` (3) | Invitations, accepting, ending; settings per person |
| `test_schema.py` (6), `test_errors_and_cors.py` (13), `test_health.py` (4) | Database constraints and append-only log; models match migrations; error format; CORS; configuration |

GitHub Actions runs the same suite on every push and pull request
(`.github/workflows/backend.yml`).

## 6. Open questions and limits

- **Consent for staff access (Issue 11).** Supervisors and admins can read all patients'
  data. Every view is logged and patients can see those views (`GET /me/access-log`), but
  whether patients must agree first is a policy question for the professor. If they must,
  add a `consent_given_at` to patients and check it in the admin routes.
- **Phone calls** are logged, not placed. Plugging in a provider such as Twilio means
  changing one function (`app/jobs/notify.py`).
- **Rate limits** are kept in memory, which is right for one API process. With several
  processes, move them to Redis.
- **Photos** are stored on the server's disk. Hosts with temporary disks need a persistent
  volume or a cloud bucket.
- **Health document upload and download** are planned for later (contract).
