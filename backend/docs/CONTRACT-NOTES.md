# Notes for Biplav: how the API differs from api-contract.md v1

Everything in the contract is built as written. This page lists **additions** (nothing
the app already relies on was changed) and the places where the contract was silent and
the API had to choose. Please read sections 1 and 2 before wiring up sign-in.

Interactive docs with every request and response: run the API and open
http://localhost:8000/docs.

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
- `DELETE /me/push-token` `{ token }`: call on sign-out so the phone stops receiving pushes.
- `GET /me/access-log` (patients): who viewed their data and when, newest first.
  A nice "Privacy" screen; it also answers the consent question in Issue 11.

**Reminders and medicines**
- `GET /reminders?day=…&timezone=…`: `timezone` is optional and defaults to the account's.
  Send the phone's zone if the person travels.
- `POST /reminders/{id}/acknowledge` more than 60 minutes **before** the time gives **422**
  `not_due`. Late confirmations are accepted and stored.
- `DELETE /medicines/{id}` stops a medicine: past reminders stay, future ones are removed.
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
