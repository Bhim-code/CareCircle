# CareCircle admin panel

A web page for supervisors and administrators. Plain HTML, Tailwind CSS and vanilla
JavaScript, with no framework and nothing to build to run it.

## Run it

1. Start the API (see `backend/README.md`) and load the demo data: `python -m app.seed`
2. From this `admin/` folder, serve the page:

   ```bash
   python -m http.server 5500
   ```

3. Open http://localhost:5500 and sign in (password `demo1234`):
   - `sue@demo.carecircle.test`: supervisor of Harbour Home Care (sees only that company,
     can switch its caregivers on or off)
   - `nina@demo.carecircle.test`: supervisor of Northside Care
   - `al@demo.carecircle.test`: admin (every company; creates companies, moves people,
     turns accounts off and on)

Patients and caregivers are refused; they use the app. The port must match
`CORS_ORIGINS` in `backend/.env` (5500 by default). To point at another API, edit
`config.js`.

## What it does

| Page | |
|---|---|
| Overview | 7-day adherence circle, today's doses (taken, due, missed, upcoming), totals, for your company (supervisor) or all companies (admin) |
| Patients | Search, then open a patient: details, caregivers, medicines, adherence |
| Caregivers | Every caregiver of the company, each with an on/off switch; open one to see the patients they look after |
| Patient: Records | Written records, filtered by kind and dates, with CSV export |
| Patient: Reminders | Every dose and its status, with CSV export |
| Patient: Documents | Health documents |
| All accounts | Everyone in your company, filtered by role. Supervisors get an on/off switch on caregivers; admins on everyone (except themselves) and can change a person's company. |
| Companies | Admin only: create companies and see their size |
| Access log | Who looked at which patient's data and when, including refused attempts |

Every patient page and export is written to the access log by the API.

## Security

- The API enforces everything: a supervisor who edits the page still cannot change data.
- Data is always written into the page as text, never as HTML, so a record that contains
  `<script>` shows up as plain text. A strict Content-Security-Policy backs this up.
- Tokens live in `sessionStorage` and are gone when the tab closes. Sign-out ends the
  session on the server.
- No third-party requests: the font and CSS are served from this folder.
- When deployed, serve this folder over HTTPS and set `config.js` to the HTTPS API
  address. Also add that address to the `connect-src` and `img-src` entries of the
  Content-Security-Policy in `index.html`.

## Changing the styles

`assets/app.css` is built from Tailwind and committed, so nobody needs Node to run
the panel. After changing classes in `index.html` or `app.js`:

```bash
npm install
npm run build:css      # or: npm run watch:css while you work
```

Font: Atkinson Hyperlegible (SIL Open Font License, see `assets/fonts/`), chosen
for legibility.
