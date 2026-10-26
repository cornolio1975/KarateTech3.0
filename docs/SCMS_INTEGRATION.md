# SCMS → KarateTech 3.0 athlete receiver

SCMS destination: `https://karatetech3.spsportdatasolution.org`.
The old static Hostinger build removed all API routes. Loading the website did
not prove it could receive athletes: API paths returned the HTML fallback.

## Production setup

1. Take a database backup. Apply
   `supabase/migrations/20261027090000_scms_receiver.sql` to the **KarateTech**
   Supabase database. This adds mapping tables and a restricted transaction
   function. It does not delete or reset existing competition data.
2. Configure the KarateTech Node server with:
   - `NEXT_PUBLIC_SUPABASE_URL`: the existing KarateTech Supabase URL.
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: its existing public key.
   - `SUPABASE_SERVICE_ROLE_KEY`: its server-only service role key.
   - `SCMS_API_KEY`: a strong shared integration secret.
   - `SCMS_TOURNAMENT_ID`: the UUID of the intended existing tournament.
3. Configure the **SCMS** server with `KARATETECH_API_URL` set to the destination
   above and `KARATETECH_API_KEY` matching KarateTech's `SCMS_API_KEY`.
   Never paste secrets into source control or put them in `NEXT_PUBLIC_` values.
4. Deploy KarateTech as a **Node.js application**, using `npm ci`,
   `npm run build:hostinger`, and `npm start`. Let the host supply `PORT`.
   Build and runtime must use the same `BUILD_TARGET=server` setting; set it in
   the host environment. `npm run build:server` is also portable across Windows
   and Linux. `next start` uses the complete project and `.next` directory.
   For a minimal standalone deployment, copy `public` to
   `.next/standalone/public` and `.next/static` to
   `.next/standalone/.next/static`, then run
   `HOSTNAME=0.0.0.0 node .next/standalone/server.js` instead of `next start`.
5. Test Connection in SCMS, then send an authorized test athlete. Confirm it
   appears in the intended tournament before sending the full roster.

`npm run build:hostinger:static` preserves the legacy static ZIP export for
frontend-only uses. It cannot receive athlete transfers. Existing Electron and
GitHub Pages build commands remain separate.

## Contract

All routes below require `Authorization: Bearer <shared key>`:

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/integration/scms/health` | JSON readiness, including database and tournament checks |
| POST | `/api/integration/scms/participants` | One confirmed participant ID, validation error, or duplicate conflict |
| POST | `/api/integration/scms/participants/batch` | Up to 100 individual outcomes and aggregate counts |
| GET | `/api/integration/scms/participants/{scmsId}` | Mapped athlete identity in the configured tournament |
| GET | `/api/integration/scms/sync-status?scms_participant_id={scmsId}` | Same identity/status response |

Required athlete fields: `scms_participant_id`, `full_name`, `gender` (Male/Female),
`dob` (real YYYY-MM-DD), `passport_ic`, positive numeric `weight` and `height`.
Optional contact, club and country fields are mapped without fabricated defaults.
The destination tournament comes from server configuration, never from an
untrusted request. Each source ID is mapped separately per tournament.

Repeated transfers update only SCMS-owned profile fields. Status, payment,
medical decisions, categories, draws, scores, and bout results stay unchanged.
Matching identities under different source IDs return HTTP 409 for review.
The database transaction rolls back both participant and link on failure.
Service-only mapping tables and RPC are inaccessible to anonymous/browser roles.
Do not rotate the destination tournament while a transfer is in progress.

## Verification

`npm test` includes receiver input/auth tests, existing draw/scoring tests, and
an embedded PostgreSQL test of the real SQL migration against the repository's
schema. It covers retries, duplicate conflicts, rollback, destination isolation,
and database role permissions. These tests do not contact production or prove
that production secrets and migrations have been configured.

A clean server build also required moving reusable page implementations into
components: Next.js rejects named component exports from `page.tsx`. Control
panel markup, scoring behavior and red/blue competitor colors are unchanged.
