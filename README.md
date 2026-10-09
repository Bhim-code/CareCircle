# CareCircle

Medication reminders for patients, with alerts to the family and caregivers who look after them.
This is the foundation: sign up, sign in, password-reset request, role-aware dashboard.
Reminders, caregiver links and escalation come next.

Expo SDK 57 · React Native · TypeScript · Expo Router · Supabase (optional)

## Run it

```bash
npm install
npx expo start        # press a (Android), w (web), or scan the QR code with Expo Go
```

With no `.env` file the app starts in **demo mode**: an in-memory backend with two accounts
(`patient@demo.test` and `caregiver@demo.test`, password `demo1234`). Demo mode exists only in
development builds and can never switch on in a release build.

## Developer tools (development builds only)

A small floating button (bottom right) opens the dev panel: turn on dev mode, switch between
patient and caregiver instantly with no sign-in, and exit back to the real session.
The sign-in screen also has a "Dev mode: skip sign-in" button.
Both are built by `DevModeAuthService`, a decorator around whichever auth service is in use,
and are created only when `__DEV__` is true, so release builds contain no dev mode.

## Connect Supabase

1. Create a project at supabase.com.
2. SQL Editor: run `supabase/schema.sql`.
3. Authentication > Providers > Email: set minimum password length to 8.
   For quick testing, turn off "Confirm email".
4. Copy `.env.example` to `.env` and fill in the Project URL and anon key
   (Project Settings > API). Never use the `service_role` key in the app.
5. Restart: `npx expo start -c`.

## Structure

```
src/
  domain/          Interfaces and rules. No framework code.
                   IAuthService, ISessionStorage, IRolePolicy, AuthError
  application/     Logic that uses only the domain.
                   RolePolicy -> PatientPolicy / CaregiverPolicy, validators, messages
  infrastructure/  Adapters to the outside world.
                   SupabaseAuthService, DemoAuthService, DevModeAuthService (decorator),
                   AsyncSessionStorage
  presentation/    React: theme, components, AuthProvider, hooks
  app/             Expo Router screens (routes only)
  container.ts     The one place that picks concrete classes
tests/             node:test unit tests
supabase/          Database schema
```

Screens depend on `IAuthService`, never on Supabase. To change backend (for example to Laravel),
write one new class that implements the interface and change one line in `container.ts`.

## Checks

```bash
npm run typecheck
npm test
```

## Known gaps

- Password reset sends the email, but there is no "choose a new password" screen yet.
- Sessions are stored with AsyncStorage (unencrypted). Before release, move to an encrypted store.
- Reminders, caregiver invites, push notifications and escalation are not built yet.
