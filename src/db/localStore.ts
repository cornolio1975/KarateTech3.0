import localforage from 'localforage';
import { TournamentDatabase, Tournament } from './types';
import { supabase } from './dbClient';

// Initialize the tournaments store
const dbStore = localforage.createInstance({
  name: 'KarateTechDB',
  storeName: 'tournaments'
});

export const localStore = {
  /** Local cache only: intake reads must never upload a stale competition snapshot. */
  async cacheTournament(db: TournamentDatabase): Promise<void> {
    await dbStore.setItem(`ktournament_${db.tournament.id}`, db);
  },
  /**
   * Save a complete tournament database to IndexedDB and sync to Supabase.
   */
  async saveTournament(db: TournamentDatabase): Promise<void> {
    if (!db || !db.tournament || !db.tournament.id) {
      throw new Error('Invalid tournament database: Missing ID');
    }
    
    // Always update last modified before saving
    db.tournament.last_modified = new Date().toISOString();

    // Resolve the canonical UUID to use for both IndexedDB key and Supabase
    let syncId = db.tournament.id;
    const isProperUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(syncId);
    if (!isProperUUID) {
      // Legacy tr_... IDs: derive a deterministic UUID so both stores use the same key
      syncId = '00000000-0000-4000-8000-' + syncId.replace(/[^0-9a-fA-F]/g, '0').padStart(12, '0').slice(-12);
      // Promote the id in the object so future saves use the UUID
      db.tournament.id = syncId;
    }

    // 1. Save to Local IndexedDB using the canonical UUID key
    await dbStore.setItem(`ktournament_${syncId}`, db);

    // 2. Sync to Supabase Cloud
    if (supabase) {
      try {
        const nowIso = new Date().toISOString();
        const payload: Record<string, any> = {
          id: syncId,
          name: db.tournament.name || 'Untitled Tournament',
          discipline: db.tournament.discipline,
          poster_emoji: db.tournament.poster_emoji,
          banner_gradient: db.tournament.banner_gradient,
          status: db.tournament.status || 'Draft',
          organizer: db.tournament.organizer || 'KarateTech Organizer',
          venue: db.tournament.venue || 'Main Stadium',
          city: db.tournament.city || 'Local City',
          date: db.tournament.date || new Date().toLocaleDateString(),
          date_iso: db.tournament.date_iso || nowIso,
          registration_close: db.tournament.registration_close || new Date().toLocaleDateString(),
          registration_close_iso: db.tournament.registration_close_iso || nowIso,
          pdf_url: db.tournament.pdf_url,
          data: db,
          last_modified: db.tournament.last_modified || nowIso
        };

        const { error } = await supabase.from('tournaments').upsert(payload, { onConflict: 'id' });
        
        if (error) {
          console.warn('Supabase Cloud Sync Error:', error.message || error);
        } else {
          console.log('✅ Successfully synced tournament to Supabase Cloud:', db.tournament.name);
        }
      } catch (e) {
        console.warn('Cloud sync failed, data is saved locally.', e);
      }
    }
  },

  /**
   * Load a complete tournament database from Cloud or IndexedDB.
   */
  async loadTournament(id: string): Promise<TournamentDatabase | null> {
    let cloudDb: TournamentDatabase | null = null;
    
    // Attempt to load from Cloud first if available
    if (supabase && typeof navigator !== 'undefined' && navigator.onLine) {
       try {
         const { data, error } = await supabase.from('tournaments').select('*').eq('id', id).single();
         if (!error && data && 'data' in data && data.data) {
           cloudDb = data.data as TournamentDatabase;
           // Cache it locally!
           await dbStore.setItem(`ktournament_${id}`, cloudDb);
         }
       } catch (e) {
         console.warn('Cloud load failed, falling back to local.', e);
       }
    }
    
    if (cloudDb) return cloudDb;
    
    return await dbStore.getItem<TournamentDatabase>(`ktournament_${id}`);
  },

  /**
   * Get a list of all saved tournaments (merging Local + Cloud).
   */
  async listTournaments(): Promise<Tournament[]> {
    const keys = await dbStore.keys();
    const tournamentKeys = keys.filter(key => key.startsWith('ktournament_'));
    
    const localTournaments: Tournament[] = [];
    for (const key of tournamentKeys) {
      const db = await dbStore.getItem<TournamentDatabase>(key);
      if (db && db.tournament) {
        localTournaments.push(db.tournament);
      }
    }
    
    const allTournaments = [...localTournaments];

    // Merge cloud tournaments (excluding deleted ones)
    if (supabase && typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const { data, error } = await supabase.from('tournaments')
          .select('id, name, status, last_modified, deleted_at')
          .is('deleted_at', null)
          .neq('status', 'Deleted');

        if (!error && data) {
          for (const c of data) {
            if (c.status === 'Deleted' || c.deleted_at) continue;
            
            const existingIdx = allTournaments.findIndex(t => {
              if (t.id === c.id) return true;
              let tSyncId = t.id;
              if (!tSyncId.includes('-') || tSyncId.length < 32) {
                tSyncId = '00000000-0000-4000-8000-' + tSyncId.replace(/[^0-9a-fA-F]/g, '0').padStart(12, '0').slice(-12);
              }
              return tSyncId === c.id;
            });

            if (existingIdx >= 0) {
              const localT = allTournaments[existingIdx];
              const localTime = new Date(localT.last_modified || 0).getTime();
              const cloudTime = new Date(c.last_modified || 0).getTime();
              if (cloudTime > localTime) {
                allTournaments[existingIdx] = { ...localT, name: c.name, status: c.status, last_modified: c.last_modified };
              }
            } else {
              // Not in local store at all
              allTournaments.push({
                 id: c.id,
                 name: c.name,
                 status: c.status,
                 last_modified: c.last_modified,
                 created_at: c.last_modified,
                 organizer: 'Cloud Backup',
                 date: '',
                 date_iso: '',
                 venue: '',
                 city: '',
                 registration_close: '',
                 registration_close_iso: ''
              });
            }
          }
        }
      } catch (e) {
        console.warn('Failed to fetch cloud tournaments list', e);
      }
    }
    
    // Final deduplication by id (handles cases where same tournament is stored under multiple keys)
    const seenIds = new Set<string>();
    const deduped = allTournaments.filter(t => {
      if (seenIds.has(t.id)) return false;
      seenIds.add(t.id);
      return true;
    });

    // Filter out any locally marked deleted records & sort by last_modified descending
    return deduped
      .filter(t => t.status !== 'Deleted')
      .sort((a, b) => {
        const dateA = new Date(a.last_modified || a.created_at || 0).getTime();
        const dateB = new Date(b.last_modified || b.created_at || 0).getTime();
        return dateB - dateA;
      });
  },

  /**
   * Delete a tournament from IndexedDB and Supabase.
   */
  async deleteTournament(id: string): Promise<void> {
    if (!id) return;

    let syncId = id;
    if (!syncId.includes('-') || syncId.length < 32) {
      syncId = '00000000-0000-4000-8000-' + syncId.replace(/[^0-9a-fA-F]/g, '0').padStart(12, '0').slice(-12);
    }

    // 1. Remove all matching keys from Local IndexedDB
    try {
      const keys = await dbStore.keys();
      for (const key of keys) {
        if (key.startsWith('ktournament_')) {
          if (key === `ktournament_${id}` || key === `ktournament_${syncId}`) {
            await dbStore.removeItem(key);
          } else {
            const item = await dbStore.getItem<TournamentDatabase>(key);
            if (item?.tournament?.id === id || item?.tournament?.id === syncId) {
              await dbStore.removeItem(key);
            }
          }
        }
      }
    } catch (e) {
      console.warn('Error purging IndexedDB keys:', e);
    }

    // 2. Remove from Supabase Cloud
    if (supabase) {
      try {
        // Attempt deletion by syncId first
        await supabase.from('tournaments').delete().eq('id', syncId);
        // Attempt deletion by raw id if valid
        if (id !== syncId && id.includes('-')) {
          await supabase.from('tournaments').delete().eq('id', id);
        }
      } catch (e) {
        console.warn('Cloud delete failed', e);
      }
    }
  }
};
