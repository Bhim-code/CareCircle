# Demo day and deployment

## Demo-day checklist (on a laptop, about 5 minutes)

Do this the day before as well, so any surprise shows up early.

1. Start Docker Desktop, then in `backend/`:
   ```bash
   docker compose up -d
   .venv\Scripts\activate             # macOS/Linux: source .venv/bin/activate
   alembic downgrade base && alembic upgrade head
   python -m app.seed
   ```
2. Terminal 1, the API: `uvicorn app.main:app --host 0.0.0.0 --port 8000`
   (`--host 0.0.0.0` lets a phone on the same Wi-Fi reach it at `http://<laptop-ip>:8000`).
3. Terminal 2, the jobs: `python -m app.jobs`
4. Terminal 3, the admin panel: `cd ../admin && python -m http.server 5500`
5. Check:
   - http://localhost:8000/health shows `"ok"`
   - http://localhost:5500 lets you sign in as `sue@demo.carecircle.test` / `demo1234`
   - `pytest` passes (optional, about 20 seconds)

Things to show:

- In the panel, the overview's adherence circle, then Ana's records, her reminders and a
  CSV export. Then the access log, which now lists everything you just looked at.
- Sign in as `ana@demo.carecircle.test` on the panel: refused (patients use the app).
- A missed-dose alert: in the app (or at `/docs`), sign in as Ana and do not confirm a
  dose. Or run `python -m app.jobs once alerts` after a dose is 60 minutes overdue. The
  alert email to Sam appears in the API's log.
- Security: in `/docs`, sign in as Bob and ask for Ana's records with `?patientId=`. You
  get 404.

## Hosting it for a demo (optional)

Any host that runs Python and PostgreSQL works (Render, Railway, Fly.io, a university
VM). Free tiers change often, so check the host's current plans. The pieces:

| Piece | Command | Notes |
|---|---|---|
| PostgreSQL 16 | (managed database) | Copy its connection URL into `DATABASE_URL`. A `postgres://` URL is fine. |
| API (web service) | build: `pip install -r requirements.txt`<br>start: `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers` | Root directory `backend` |
| Jobs (background worker) | `python -m app.jobs` | Same environment variables as the API. If the host has no workers, a cron running `python -m app.jobs once alerts` every 5 minutes also works. |
| Admin panel (static site) | no build; publish the `admin/` folder | Set `config.js` to the API's HTTPS address and add it to the CSP in `index.html` |

Environment variables for the API and jobs:

```
ENVIRONMENT=production
DATABASE_URL=<from the database>
JWT_SECRET=<python -c "import secrets; print(secrets.token_urlsafe(48))">
CORS_ORIGINS=https://<your-admin-panel-address>
TRUST_PROXY_HEADERS=true          # the host's proxy terminates HTTPS
PUBLIC_BASE_URL=https://<your-api-address>
PASSWORD_RESET_URL=carecircle://reset-password
SMTP_HOST=… SMTP_USERNAME=… SMTP_PASSWORD=… SMTP_FROM=…   # optional; otherwise emails are logged
PUSH_PROVIDER=expo                # optional; otherwise pushes are logged
```

In production the API refuses plain HTTP, hides `/docs`, refuses `CORS_ORIGINS=*`, and
refuses the placeholder `JWT_SECRET`.

After the first deploy, create the staff accounts from the host's shell:

```bash
python -m app.cli create-staff --role admin --email you@example.com --name "Your Name"
```

Don't run `python -m app.seed` on a hosted database that real people will use (it refuses
when `ENVIRONMENT=production`).

**Photos:** they are saved in `PHOTO_DIR` on the server's disk. Many hosts wipe the disk on
every deploy, so attach a persistent disk/volume and point `PHOTO_DIR` at it, or accept
that demo photos disappear on redeploy.
