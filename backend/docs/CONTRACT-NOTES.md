# Notes for Biplav: how the API differs from api-contract.md v1

Everything in the contract is built as written. This page lists **additions** (nothing
the app already relies on was changed) and the places where the contract was silent and
the API had to choose. Please read sections 1 and 2 before wiring up sign-in.

Interactive docs with every request and response: run the API and open
http://localhost:8000/docs.

## 0. New: roles are given by a supervisor (please read first)

- `POST /auth/sign-up`: `role` is now **optional** and only a hint. Every new account
  starts with `user.role = "pending"` and the person is signed in.
- While `role` is `"pending"`, the app-data endpoints (reminders, medicines, written
  records, health documents, inviting caregivers) answer **403**; `/me`, settings and
  sign-in work. The app should show a "Waiting for approval" screen
  (check `GET /me` from time to time or when the app opens).
- When a supervisor assigns a role, the person is **signed out** (the next request,
  and `/auth/refresh`, give 401). The app should go to the sign-in screen; after signing
  in, `user.role` is the new kind (`patient`, `caregiver`, `supervisor`).
- `GET /me` now also returns `roleName` (e.g. "Night nurse") and `permissions`, a list
  such as `["entries.write.incident", "entries.write.medication"]`. Use it to decide which
  record kinds to offer, instead of the fixed table in the contract. The fixed table is
  now only the default.
- A role can be changed later (patient to caregiver and so on): treat it like a fresh
  sign-in, because the person is signed out then too.

## 0b. New: uploading documents from the phone

The Records > Documents screen can now upload files. A **patient** uploads their own; a
**caregiver** uploads for a linked patient (and sees their documents too).

`POST /health-records` as **multipart/form-data**:

| Field | |
|---|---|
| `file` | PDF, JPEG, PNG or HEIC (iPhone camera), at most **10 MB** |
| `title` | 1 to 200 characters |
| `category` | `prescription`, `lab_report`, `imaging`, `discharge_summary`, `other` |
| `recordedOn` | optional, `YYYY-MM-DD`, not in the future |
| `patientId` | caregivers with more than one linked patient |

```ts
// React Native: append the file as { uri, name, type } (from the image or document picker).
const form = new FormData();
form.append('file', { uri: asset.uri, name: asset.fileName ?? 'photo.jpg', type: asset.mimeType ?? 'image/jpeg' } as any);
form.append('title', 'Blood test');
form.append('category', 'lab_report');
await fetch(`${API}/health-records`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
// Do not set Content-Type yourself; fetch adds the multipart boundary.
```

- **201** returns the document. **413**: file too big. **415**: not an allowed type, can't be
  read, or a PDF with scripts. The `error.message` can be shown to the person as is.
- HEIC photos come back as JPEG. Photos are re-saved without hidden data (GPS location,
  camera details).
- `GET /health-records` items now also have `patientId`, `fileType` (`pdf`, `image`, or
  null for details-only documents), `fileName`, `sizeBytes`, `uploadedBy`, `uploadedAt`
  and `fileUri`. **`fileUri` works for about 15 minutes**: open it straight away (image
  view, or a PDF viewer or web view), and fetch the list again for a fresh link. Caregivers
  may add `?patientId=`.
- `DELETE /health-records/{id}`: the patient, or the person who uploaded it. It disappears
  from the app; staff can still see it marked as deleted.
- Permissions `documents.upload` / `documents.view` control this (on by default for
  patients and caregivers); check `GET /me` `permissions` to show or hide the buttons.
- Please check the current Expo docs for the image and document picker APIs; they change
  between SDK versions.

## 0c. New: daily care tasks ("Today's tasks" screen)

Supervisors plan tasks per client in the admin panel (e.g. "Morning check-in 09:00, every
day"). Caregivers tick them off in the app; patients can see their own day (read-only by
default). Permissions: `tasks.view`, `tasks.complete`.

- `GET /tasks?day=YYYY-MM-DD&patientId=`: one item per client (a patient gets their own;
  a caregiver gets each linked patient). `day` is the client's local date, default today.
  ```json
  { "patient": {"id","name","role"}, "day": "2026-10-15",
    "counts": {"done":1,"late":0,"skipped":0,"missed":1,"due":0,"upcoming":2},
    "tasks": [{ "taskId", "title", "instructions", "time": "09:00" | null, "dueAt",
                "status": "upcoming|due|done|late|skipped|missed",
                "completion": null | {"status":"done|skipped","reason","note","doneBy":{...},"doneAt"} }],
    "extras": [{ "id", "title", "note", "doneBy", "doneAt" }] }
  ```
  `time: null` means "any time that day". Status is worked out by the server (deadline =
  time + the task's grace minutes, or the end of the day for any-time tasks).
- `POST /tasks/{taskId}/complete` `{ "status": "done" }` or
  `{ "status": "skipped", "reason": "Client refused" }`, optional `note` and `day`
  (default today; not in the future; at most 7 days back). Returns the client's updated
  day. **409** if already marked; **422** if not planned that day.
- `DELETE /tasks/{taskId}/complete?day=`: undo your own mark within 24 hours.
- `POST /tasks/extra` `{ "title": "Walk to the park", "note": "...", "patientId"? }`: work
  done that wasn't in the plan.
- **Planning from the app** (only if a supervisor gave the person the `tasks.plan`
  permission; check `GET /me` `permissions`): `GET /tasks/plan?patientId=` lists the plan;
  `POST /tasks/plan` `{ "title", "time": "16:00" | null, "days": [1..7], "instructions"?,
  "patientId"? }` adds a task for a linked client; `PATCH /tasks/plan/{id}`
  edits **tasks you added yourself** (403 `not_your_task` for others). Caregivers **cannot
  remove tasks**: there is no delete in the app, and `endDate` cannot be changed (403
  `supervisor_only`); only a supervisor removes tasks, in the admin panel. Each task has
  `createdBy`.
- When a task with a time is not marked by its deadline, the linked caregivers get an email
  (the job `python -m app.jobs`); supervisors too if it is still not marked 3 hours later.

## 1. Changes the app must handle

| What | Why | What the app does |
|---|---|---|
| `POST /auth/refresh` returns **both** a new `accessToken` and a new `refreshToken` | Refresh tokens are single-use (rotation). Reusing an old one is treated as theft and ends the sign-in on every device. | Save the new `refreshToken` every time. Never send two refreshes at once: queue requests while one refresh is running. |
| `POST /entries` and `PUT`: `occurredAt` must include a time zone | `2026-10-14T12:40:00` is ambiguous | Always send `toISOString()` (ends in `Z`). |
| `photoUri` links expire after 15 minutes | The contract says "links that expire" | Don't cache photo URLs. Fetch `GET /entries` again to get fresh links. When saving, send back the `photoUri` you received from the upload (or from the entry) unchanged. |
| A caregiver linked to **more than one** patient must send `patientId` on `POST /entries` | Otherwise the API cannot know who the record is about | Send `patientId` whenever the caregiver picked a patient; with one patient it can be left out. |

## 2. Additions (optional to use)

**Sign-in**
- `POST /auth/sign-up` returns **201** with the same body as sign-in
  (`accessToken`, `refreshToken`, `expiresIn`, `user`), so the person is signed in straight
  away (`needsEmailConfirmation` is always false). Optional field `timezone` (IANA name such
  as `America/St_Johns`, from `Intl.DateTimeFormat().resolvedOptions().timeZone`).
  An email already in use gives **409** `email_taken`.
- `POST /auth/password-reset/confirm` `{ token, newPassword }` returns 204. The reset email
  links to `PASSWORD_RESET_URL?token=...` (default `carecircle://reset-password?token=...`),
  so the app needs a "choose a new password" screen that reads the token and calls this.
  It signs the person out everywhere.
- `user` objects also include `timezone`.

**Me**
- `PATCH /me` `{ name?, timezone? }`. Role and email cannot be changed (422).
- `GET /me/preferences` also returns the medicine alarm's settings: `alarmSound` (true),
  `alarmVibration` (true) and `snoozeMinutes` (10; only 5, 10 or 15). Defaults in brackets.
  On `PUT /me/preferences` the four contract switches stay required and the three alarm
  settings are **optional**: leave one out to keep its saved value. So an app that sends
  only the four never resets the alarm. Any other snooze value gives 422.
- `DELETE /me/push-token` `{ token }`: call on sign-out so the phone stops receiving pushes.
- `GET /me/access-log` (patients): who viewed their data and when, newest first.
  A nice "Privacy" screen; it also answers the consent question in Issue 11.

**Reminders and medicines**
- `GET /reminders?day=…&timezone=…`: `timezone` is optional and defaults to the patient's.
  Send the phone's zone if the person travels.
- Each reminder also has `skipped` (true/false), `status` (`upcoming`, `due`, `taken`,
  `skipped`, `missed`, worked out by the server), `patientId` and `patientName`.
- **Caregivers** can call `GET /reminders?day=…` too: they get the doses of every linked
  patient (sorted by time), or of one with `&patientId=…`. An unlinked patient gives 404.
  Caregivers can read doses but never confirm or skip them (403).
- `POST /reminders/{id}/skip` (patient only): the alarm's **Skip**. **204**. Skipping again is
  harmless. A dose already taken gives **409** `already_taken`; more than 60 minutes early gives
  **422** `not_due`. Skipped doses show as `skipped`, never `missed`, and send no missed-dose
  alert to caregivers and no "time for your dose" push. Taking a skipped dose later is allowed
  (`acknowledge` clears the skip). The phone no longer needs to remember skips itself.
- `POST /reminders/{id}/acknowledge` more than 60 minutes **before** the time gives **422**
  `not_due`. Late confirmations are accepted and stored.
- `DELETE /medicines/{id}` stops a medicine from now on: past and confirmed doses stay, future
  ones are removed, and the medicine shows `stoppedAt` in `GET /medicines`.
- Reminders for a day are created on demand when the app asks for it (up to 14 days ahead),
  so the app works even if the background job is not running.

**Written records**
- `GET /entries?patientId=&kind=&from=&to=` filters (dates are `YYYY-MM-DD`, UTC days).
- Every entry includes `patientId`.
- `PUT` cannot change `kind` or `patientId` (422).
- Blank strings are stored as `null`.

## 3. Shapes the contract left open

`GET /care-links` items and the result of invite and accept:

```json
{
  "id": "…",
  "status": "pending | active | ended",
  "invitedEmail": "sam@example.com",
  "patient":   { "id": "…", "name": "Ana", "role": "patient", "email": "ana@example.com" },
  "caregiver": { "id": "…", "name": "Sam", "role": "caregiver", "email": "sam@example.com" },
  "createdAt": "2026-10-15T14:30:00.000Z",
  "acceptedAt": null,
  "endedAt": null
}
```

- `caregiver` is `null` while pending. The invited person sees pending invitations
  addressed to their email, including if they sign up after being invited.
- Invite: **201**; already invited or linked **409** `already_linked`; yourself **422**.
- Accept: **200** with the link. `GET /care-links?includeEnded=true` also shows ended links.
- `DELETE /care-links/{id}` also cancels (patient) or declines (caregiver) a pending invitation.

## 4. Errors and limits

- Extra codes: `409 conflict | email_taken | already_linked`, `413 too_large`,
  `415 unsupported_media_type`, `403 https_required` (plain HTTP in production),
  `422 not_due`.
- Unknown fields in a body are rejected with 422. This is how `recordedBy`, `role` and
  similar can never be smuggled in.
- `429 too_many_requests` comes with a `Retry-After` header (seconds). Limits: sign-in
  5 per minute per account and 10 per minute per IP; sign-up 10 per hour per IP;
  password reset 3 per hour per email.
- All date-times leave the API as UTC with milliseconds and `Z`.
- Access tokens last 15 minutes and refresh tokens 30 days.
