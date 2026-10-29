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
  // Existing competition-owned status, event selections and measurements stay intact.
  const knownIds = new Set((snapshot.participants || []).map(p => p.id));
  const additions: Participant[] = [];
  for (const row of data || []) {
    if (row.tournament_id !== tournamentId || row.deleted_at ||
        !row.registration_no?.startsWith('SCMS-') || knownIds.has(row.id)) continue;
    knownIds.add(row.id);
    additions.push(row as Participant);
  }
  if (additions.length) snapshot.participants = [...(snapshot.participants || []), ...additions];
  return additions.length;
}
