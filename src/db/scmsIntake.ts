import type { SupabaseClient } from '@supabase/supabase-js';
import type { Participant, TournamentDatabase } from './types';

/** Read normalized SCMS intake without pushing a tournament snapshot to cloud. */
export async function refreshScmsIntake(
  snapshot: TournamentDatabase,
  client: SupabaseClient,
): Promise<number> {
  const tournamentId = snapshot.tournament.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tournamentId)) return 0;
  const { data, error } = await client.from('participants').select('*')
    .eq('tournament_id', tournamentId).like('registration_no', 'SCMS-%')
    .is('deleted_at', null);
  if (error) throw new Error(`Unable to refresh SCMS intake: ${error.message}`);

  // Include local tombstones in this set so refresh cannot restore deleted athletes.
  // Refresh source-owned details; competition state and local tombstones stay intact.
  const knownIds = new Set((snapshot.participants || []).map(p => p.id));
  let updated = 0;
  const additions: Participant[] = [];
  for (const row of data || []) {
    if (row.tournament_id !== tournamentId || row.deleted_at ||
        !row.registration_no?.startsWith('SCMS-')) continue;
    if (knownIds.has(row.id)) {
      const local = snapshot.participants.find(p => p.id === row.id);
      if (local && !local.deleted_at) {
        const fields = ['full_name', 'gender', 'dob', 'passport_ic', 'weight', 'height',
          'email', 'phone', 'club_id', 'emergency_contact_name',
          'emergency_contact_phone', 'nationality_code'] as const;
        let changed = false;
        for (const field of fields) {
          if (Object.hasOwn(row, field) && local[field] !== row[field]) {
            Object.assign(local, { [field]: row[field] });
            changed = true;
          }
        }
        // Ignore legacy empty flags; active transfers always have an explicit selection.
        if ((row.isKumite === true || row.isKata === true) &&
            typeof row.isKumite === 'boolean' && typeof row.isKata === 'boolean' &&
            (local.isKumite !== row.isKumite || local.isKata !== row.isKata)) {
          local.isKumite = row.isKumite;
          local.isKata = row.isKata;
          changed = true;
        }
        if (changed) updated++;
      }
      continue;
    }
    knownIds.add(row.id);
    additions.push(row as Participant);
  }
  if (additions.length) snapshot.participants = [...(snapshot.participants || []), ...additions];
  return additions.length + updated;
}
