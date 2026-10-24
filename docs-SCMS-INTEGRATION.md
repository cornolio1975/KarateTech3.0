# SCMS athlete integration v1

The receiver lives at `/api/integration/scms/health`, `/sync-status?scms_member_id=<uuid>` and `/participants` (POST). All routes require a server-only Bearer key. Health verifies database RPC availability and contract version. Responses are never cached. No browser role can execute the intake RPCs or read source snapshots.

## Deploy to isolated staging first

1. Back up the database and inspect duplicate SCMS mapping keys before applying `supabase/migrations/20261023123502_scms_athlete_receiver.sql`. Apply it to a disposable staging database first. No live database was changed during implementation.
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY` for that staging project. Set a random server-only `SCMS_INTEGRATION_KEY` of at least 32 characters. Set the identical value in staging SCMS as `KARATETECH_API_KEY` through secure hosting configuration. Never put these server keys in `NEXT_PUBLIC_*` variables or Git.
3. Build with `npm ci` then `npm run build:integration`. Deploy the standalone Node application behind HTTPS. The old `build:hostinger` command deliberately removes API routes for static export and cannot provide this integration. Static GitHub Pages cannot host it either.
4. Point staging SCMS `KARATETECH_API_URL` at the HTTPS Node origin. Complete the matching SCMS migration and tests before connecting real athletes. A successful build is not proof of deployed credentials, auth or live connectivity.

## Ownership and matching

SCMS owns the athlete name, DOB, gender, club, IC/passport, nationality code from KarateTech's `countries` table, email, phone, weight (kg), height (cm), and emergency contact name/phone. Club/source IDs, branch ID, member number and belt grade are kept in server-only source metadata. Medical notes, fees, approvals and credentials are not copied. KarateTech continues to own categories, tournament participation, payment/medical/competition status and results.

Existing participant UUIDs remain stable on every update. The source member UUID is mapped to the participant UUID. Same name + DOB or IC/passport under another source ID is a conflict, not an automatic merge. Existing clubs with the same name require an explicitly reviewed `scms_club_mappings` entry rather than guessing club identity. Legacy mapping rows without a verified source snapshot also require reconciliation. No existing athlete is silently adopted or remapped.

A source revision stops older requests overwriting newer data. Names/DOB and club transfers require reconciliation. SCMS performs a full contract read-back before recording success. Measurements and IC/passport must be supplied; the receiver never invents them to satisfy required database fields. Unknown country codes fail atomically. Missing optional data remains null. The receiver preserves tournament-owned columns.

## Tests

The cross-repository mock integration test is in SCMS `tests/athlete-sync.test.cjs`. Set `KARATETECH_TEST_ROOT` to this checkout and run `npm run test:athlete-sync` from SCMS. It runs actual request handlers and client over loopback HTTP with two disposable PGlite databases. A test-only session adapter replaces Supabase Auth; the real SCMS role/RLS/transaction SQL is exercised. It does not authenticate real Supabase users or prove multi-process PostgreSQL lock behavior, deployed HTTPS/network access, or production rollout.

The required page-export build repair moves existing page bodies into adjacent `Content.tsx` files and updates imports. Control/scoreboard bodies are unchanged ; scoring, colors and layout are preserved.

## Confirmed return updates from KarateTech

The Participants table now has **Update SCMS** beside each row's existing actions. Save participant edits first, select Update SCMS, review the old SCMS and new KarateTech field values, then choose **Confirm update** or **Cancel**. Preview and cancellation do not change SCMS. Confirmation is bound to the verified administrator, the saved KarateTech snapshot, and the SCMS member revision, and expires after five minutes. Concurrent changes require a fresh preview; same-field conflicts require reconciliation. A successful return update records the external administrator UUID in SCMS sync history. Existing UUID mappings are preserved; unlinked participants cannot create SCMS members through this action.

Apply `supabase/migrations/20261023145535_scms_return_sync.sql` to KarateTech staging after the receiver migration, and apply SCMS `20261023145537_karatetech_return_sync.sql` after its athlete-field migration. Both Node apps must be deployed together. Configure these server-only values:

| App | Variable | Value |
| --- | --- | --- |
| KarateTech | `SCMS_API_URL` | HTTPS origin of the SCMS Node application |
| KarateTech | `SCMS_RETURN_SYNC_KEY` | Dedicated random secret of at least 32 characters |
| SCMS | `KARATETECH_RETURN_SYNC_KEY` | The identical dedicated return secret |
| KarateTech | `SCMS_SYNC_ADMIN_USER_IDS` | Comma-separated Supabase Auth user UUIDs allowed to publish |

Existing Supabase server credentials remain required. No key or allowlist is read from the browser. Users must sign in through Supabase Auth; demo/local-only logins cannot publish. Until credentials, allowlist, migrations and Node hosting are configured, the button displays an error and does not report success. Offline tournament edits must reach the cloud participant database before previewing this action.

Shared profile fields (name, DOB, gender, IC/passport, nationality, email, phone, measurements, emergency contact) can now return to SCMS after explicit confirmation. SCMS member number, branch, club transfers, approval status and belt rank remain outside this return action. Tournament categories, brackets, scores, fees and medical/competition statuses are not copied to the SCMS member. A club mismatch stops the update for reconciliation. SCMS forward sync refuses to erase an unconfirmed KarateTech profile edit.
