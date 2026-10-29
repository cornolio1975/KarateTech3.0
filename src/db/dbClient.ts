import { createClient } from '@/utils/supabase/client';
import { mockStore } from './mockStore';
import { 
  Country, Club, Coach, Category, Team, Participant, 
  TeamMember, ParticipantCategory, Payment, MedicalRecord, Document, ActivityLog, AuditLog, Bout, Official, Tournament, DisplayPlaylist, DisplayPlaylistSlide, TournamentPC, CategoryLock,
  isKataCategory, isKumiteCategory
} from './types';
import * as pcActions from '@/app/actions/pcControl';
import { desktopOverrides } from './desktopClient';
import { refreshScmsIntake } from './scmsIntake';

export const isDesktop = typeof window !== 'undefined' ? !!(window as any).isElectron : process.env.BUILD_TARGET === 'electron';

// Read Supabase credentials
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

export const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as any).message);
  }
  return JSON.stringify(error);
};

const toAuditRecord = (value: unknown): Record<string, unknown> | null => {
  if (value == null) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  return { value };
};

export const supabase = isSupabaseConfigured ? createClient() : null;

const isDev = process.env.NODE_ENV === 'development';
export const basePath = isDev ? '' : (process.env.NEXT_PUBLIC_BASE_PATH ?? '');

async function verifyCategoryLock(categoryId: string): Promise<void> {
  if (!supabase) return;
  if (typeof window === 'undefined') return;

  const isUuid = categoryId && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(categoryId);
  if (!isUuid) return;

  // Admin bypass
  if (window.location.pathname.includes('/admin')) return;
  const adminTakeover = localStorage.getItem('kt_admin_tatami_takeover');
  if (adminTakeover) return;

  const myTatami = `Tatami ${localStorage.getItem('kt_tatami_id') || 1}`;

  const { data: lock } = await supabase
    .from('category_locks')
    .select('tatami')
    .eq('category_id', categoryId)
    .eq('is_active', true)
    .maybeSingle();

  if (lock && lock.tatami !== myTatami) {
    throw new Error(`CATEGORY_ALREADY_LOCKED: Category is locked to ${lock.tatami}. You are on ${myTatami}.`);
  }
}

// Global DB client interface
import { localStore } from './localStore';
import { TournamentDatabase } from './types';
import { setActiveTournamentDb, activeTournamentDb } from './mockStore';

// Tournament-specific localStorage keys that must be cleared when switching tournaments
const TOURNAMENT_CACHE_KEYS = [
  'ts_bouts', 'ts_categories', 'ts_participants', 'ts_clubs',
  'ts_coaches', 'ts_cat_tatami_map', 'ts_participant_categories',
  'ts_teams', 'ts_team_members', 'ts_officials', 'ts_payments',
  'ts_medical_records', 'ts_documents', 'ts_activity_logs',
  'ts_display_playlists'
] as const;

export const dbManager = {
  async setActiveTournament(id: string): Promise<boolean> {
    const db = await localStore.loadTournament(id);
    if (db) {
      // Clear stale tournament-specific localStorage caches BEFORE setting new DB
      // This prevents stale data from the previous tournament appearing during load
      if (typeof window !== 'undefined') {
        TOURNAMENT_CACHE_KEYS.forEach(key => {
          try { localStorage.removeItem(key); } catch (e) {}
        });
        localStorage.setItem('ts_active_tournament_id', id);
      }
      setActiveTournamentDb(db);
      return true;
    }
    return false;
  },
  
  getActiveTournament(): TournamentDatabase | null {
    return activeTournamentDb;
  },

  closeTournament() {
    if (typeof window !== 'undefined') {
      TOURNAMENT_CACHE_KEYS.forEach(key => {
        try { localStorage.removeItem(key); } catch (e) {}
      });
      localStorage.removeItem('ts_active_tournament_id');
    }
    setActiveTournamentDb(null);
  },
  
  async createNewTournament(tournamentDetails: any): Promise<string> {
    const id = `tourn-${Date.now()}`;
    const newDb: TournamentDatabase = {
      tournament: {
        id,
        status: 'Draft',
        created_at: new Date().toISOString(),
        ...tournamentDetails
      },
      participants: [],
      categories: [],
      clubs: [],
      coaches: [],
      bouts: [],
      payments: [],
      medical: [],
      documents: [],
      teams: [],
      team_members: [],
      participant_categories: [],
      activity_logs: [],
      audit_logs: [],
      officials: [],
      display_playlists: []
    };
    await localStore.saveTournament(newDb);
    if (typeof window !== 'undefined') {
      TOURNAMENT_CACHE_KEYS.forEach(key => {
        try { localStorage.removeItem(key); } catch (e) {}
      });
      localStorage.setItem('ts_active_tournament_id', id);
    }
    setActiveTournamentDb(newDb);
    return id;
  }
};

/**
 * Returns the active tournament ID synchronously.
 * Primary source: in-memory activeTournamentDb (set when a tournament is opened).
 * Fallback: localStorage (survives hard browser refresh).
 */
export function getActiveTournamentIdSync(): string | null {
  if (activeTournamentDb?.tournament?.id) {
    return activeTournamentDb.tournament.id;
  }
  if (typeof window !== 'undefined') {
    return localStorage.getItem('ts_active_tournament_id');
  }
  return null;
}

const resolveActiveTournamentDb = async (): Promise<TournamentDatabase | null> => {
  const activeDb = dbManager.getActiveTournament();
  if (activeDb?.tournament?.id) {
    return activeDb;
  }

  if (typeof window !== 'undefined') {
    const activeTournamentId = localStorage.getItem('ts_active_tournament_id');
    if (activeTournamentId) {
      const loadedDb = await localStore.loadTournament(activeTournamentId);
      if (loadedDb) {
        setActiveTournamentDb(loadedDb);
        return loadedDb;
      }
    }
  }

  return null;
};

const persistTournamentPlaylists = async (playlists: DisplayPlaylist[]): Promise<void> => {
  const activeDb = await resolveActiveTournamentDb();
  if (!activeDb) {
    mockStore.displayPlaylists.replaceAll(playlists);
    return;
  }

  const updatedDb: TournamentDatabase = {
    ...activeDb,
    display_playlists: playlists
  };

  setActiveTournamentDb(updatedDb);
  mockStore.displayPlaylists.replaceAll(playlists);
  await localStore.saveTournament(updatedDb);
};

export const dbOriginal = {
  isSupabase: (): boolean => !!supabase,

  // 1. Countries
  countries: {
    list: async (): Promise<Country[]> => {
      if (supabase) {
        const { data, error } = await supabase.from('countries').select('*');
        if (error) throw new Error(describeError(error));
        return data || [];
      }
      return mockStore.countries.list();
    }
  },

  // 2. Clubs — shared global reference data, not tournament-scoped
  clubs: {
    list: async (): Promise<Club[]> => {
      // Clubs are shared reference data. When an activeTournamentDb is loaded, also
      // include any clubs stored in the tournament DB so offline data is visible.
      if (supabase) {
        try {
          const { data, error } = await supabase.from('clubs').select('*').order('name');
          if (error) throw new Error(describeError(error));
          // Merge with local tournament clubs (in case of offline additions)
          const localClubs = activeTournamentDb?.clubs || [];
          if (localClubs.length > 0) {
            const merged = [...(data || [])];
            for (const lc of localClubs) {
              if (!merged.find(c => c.id === lc.id)) merged.push(lc);
            }
            return merged.sort((a, b) => a.name.localeCompare(b.name));
          }
          return data || [];
        } catch (e: unknown) {
          console.warn('Supabase clubs list error, falling back to mockStore:', describeError(e));
        }
      }
      // When no Supabase, read from active tournament DB first
      if (activeTournamentDb?.clubs && activeTournamentDb.clubs.length > 0) {
        return activeTournamentDb.clubs;
      }
      return mockStore.clubs.list();
    },
    add: async (club: Omit<Club, 'id'>): Promise<Club> => {
      if (supabase) {
        const { data, error } = await supabase.from('clubs').insert([club]).select().single();
        if (error) throw new Error(describeError(error));
        return data;
      }
      return mockStore.clubs.add(club);
    },
    update: async (id: string, updates: Partial<Club>): Promise<Club> => {
      if (supabase) {
        const { data, error } = await supabase.from('clubs').update(updates).eq('id', id).select().single();
        if (error) throw new Error(describeError(error));
        return data;
      }
      return mockStore.clubs.update(id, updates);
    },
    delete: async (id: string): Promise<void> => {
      if (supabase) {
        const { error } = await supabase.from('clubs').delete().eq('id', id);
        if (error) throw new Error(describeError(error));
        return;
      }
      return mockStore.clubs.delete(id);
    }
  },

  // 3. Coaches
  coaches: {
    list: async (): Promise<Coach[]> => {
      if (supabase) {
        const { data, error } = await supabase.from('coaches').select('*').order('name');
        if (error) throw new Error(describeError(error));
        return data || [];
      }
      return mockStore.coaches.list();
    },
    add: async (coach: Omit<Coach, 'id'>): Promise<Coach> => {
      if (supabase) {
        const { data, error } = await supabase.from('coaches').insert([coach]).select().single();
        if (error) throw new Error(describeError(error));
        return data;
      }
      return mockStore.coaches.add(coach);
    }
  },

  // 4. Categories
  categories: {
    list: async (): Promise<Category[]> => {
      // ISOLATION: When a tournament is loaded, read categories from that tournament's DB.
      // This prevents cross-tournament data leakage.
      if (activeTournamentDb) {
        return mockStore.categories.list();
      }
      if (supabase) {
        try {
          const activeTournamentId = getActiveTournamentIdSync();
          let query = supabase.from('categories').select('*');
          if (activeTournamentId) {
            query = query.eq('tournament_id', activeTournamentId);
          }
          const { data, error } = await query.order('min_age', { ascending: true }).order('name');
          if (error) throw new Error(describeError(error));
          return data || [];
        } catch (e: unknown) {
          console.warn('Supabase categories list error, falling back to mockStore:', describeError(e));
        }
      }
      return mockStore.categories.list();
    },
    update: async (id: string, updates: Partial<Category>): Promise<Category> => {
      if (activeTournamentDb) {
        return mockStore.categories.update(id, updates);
      }
      if (supabase) {
        const isUuid = id && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
        if (!isUuid) {
          return mockStore.categories.update(id, updates);
        }
        try {
          await verifyCategoryLock(id);
          const { data, error } = await supabase.from('categories').update(updates).eq('id', id).select().single();
          if (error) throw new Error(describeError(error));
          return data;
        } catch (e: unknown) {
          const msg = describeError(e);
          // On network failure (fetch error / timeout) fall back to local store so the
          // app keeps working offline. Re-throw for real Supabase errors (schema, auth, RLS).
          const isNetworkError = msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('network');
          if (!isNetworkError) throw e;
          console.warn('Supabase categories update — network error, falling back to local store:', msg);
        }
      }
      return mockStore.categories.update(id, updates);
    },
    add: async (cat: Omit<Category, 'id'> & { id?: string }): Promise<Category> => {
      // ISOLATION: When a tournament is loaded, save to that tournament's local DB.
      if (activeTournamentDb) {
        return mockStore.categories.add(cat);
      }
      if (supabase) {
        const activeTournamentId = getActiveTournamentIdSync();
        const payload = activeTournamentId ? { ...cat, tournament_id: activeTournamentId } : cat;
        const { data, error } = await supabase.from('categories').insert([payload]).select().single();
        if (error) throw new Error(describeError(error));
        return data;
      }
      return mockStore.categories.add(cat);
    },
    merge: async (catIds: string[], mergedName: string): Promise<Category> => {
      if (supabase) {
        // Run SQL transaction equivalent or fall back to client operations for simplicity
        // For Supabase, we would call a custom RPC function:
        // const { data, error } = await supabase.rpc('merge_categories', { cat_ids: catIds, merged_name: mergedName });
        // Instead, let's implement the logic on client for dual compatibility:
        const list = await db.categories.list();
        const selected = list.filter(c => catIds.includes(c.id));
        if (selected.length < 2) throw new Error('Need at least 2 categories to merge');
        const minAge = Math.min(...selected.map(s => s.min_age));
        const maxAge = Math.max(...selected.map(s => s.max_age));
        const minWeight = Math.min(...selected.map(s => s.min_weight));
        const maxWeight = Math.max(...selected.map(s => s.max_weight));
        const gender = selected[0].gender;

        const mergedCat = await db.categories.add({
          name: mergedName,
          gender,
          min_age: minAge,
          max_age: maxAge,
          min_weight: minWeight,
          max_weight: maxWeight,
          capacity: 32,
          status: 'Open',
          format: selected[0].format || 'knockout'
        });

        // Reassign mapping
        const { error: mappingErr } = await supabase
          .from('participant_categories')
          .update({ category_id: mergedCat.id })
          .in('category_id', catIds);
        if (mappingErr) throw new Error(describeError(mappingErr));

        // Close old categories
        const { error: closeErr } = await supabase
          .from('categories')
          .update({ status: 'Closed' })
          .in('id', catIds);
        if (closeErr) throw new Error(describeError(closeErr));

        return mergedCat;
      }
      return mockStore.categories.merge(catIds, mergedName);
    },
    split: async (catId: string, split1: Partial<Category>, split2: Partial<Category>): Promise<[Category, Category]> => {
      if (supabase) {
        const original = (await db.categories.list()).find(c => c.id === catId);
        if (!original) throw new Error('Original category not found');

        const { id: _originalId, ...originalWithoutId } = original;

        const cat1 = await db.categories.add({ 
          ...originalWithoutId, 
          ...split1, 
          status: 'Open' 
        });
        const cat2 = await db.categories.add({ 
          ...originalWithoutId, 
          ...split2, 
          status: 'Open' 
        });

        // Redistribute participants based on age/weight
        const participants = await db.participants.list();
        const { data: mappings, error: mapErr } = await supabase
          .from('participant_categories')
          .select('*')
          .eq('category_id', catId);
        
        if (mapErr) throw new Error(describeError(mapErr));

        for (const m of (mappings || [])) {
          const p = participants.find(part => part.id === m.participant_id);
          if (p) {
            const age = mockStore.helpers.calculateAge(p.dob);
            const matchesCat1 = age >= cat1.min_age && age <= cat1.max_age && p.weight >= cat1.min_weight && p.weight <= cat1.max_weight;
            const targetCatId = matchesCat1 ? cat1.id : cat2.id;
            
            await supabase
              .from('participant_categories')
              .update({ category_id: targetCatId })
              .eq('id', m.id);
          }
        }

        // Close original category
        await supabase.from('categories').update({ status: 'Closed' }).eq('id', catId);
        return [cat1, cat2];
      }
      return mockStore.categories.split(catId, split1 as any, split2 as any);
    },
    delete: async (id: string): Promise<void> => {
      if (activeTournamentDb) {
        return mockStore.categories.delete(id);
      }
      if (supabase) {
        const { error } = await supabase.from('categories').delete().eq('id', id);
        if (error) throw new Error(describeError(error));
        return;
      }
      return mockStore.categories.delete(id);
    }
  },

  // 5. Teams
  teams: {
    list: async (): Promise<Team[]> => {
      if (supabase) {
        const { data, error } = await supabase.from('teams').select('*').order('name');
        if (error) throw new Error(describeError(error));
        return data || [];
      }
      return mockStore.teams.list();
    },
    get: async (id: string): Promise<Team | undefined> => {
      if (supabase) {
        const { data, error } = await supabase.from('teams').select('*').eq('id', id).single();
        if (error) throw new Error(describeError(error));
        return data;
      }
      return mockStore.teams.get(id);
    },
    add: async (team: Omit<Team, 'id' | 'score'>): Promise<Team> => {
      if (supabase) {
        const { data, error } = await supabase.from('teams').insert([team]).select().single();
        if (error) throw new Error(describeError(error));
        return data;
      }
      return mockStore.teams.add(team);
    },
    update: async (id: string, updates: Partial<Team>): Promise<Team> => {
      if (supabase) {
        const { data, error } = await supabase.from('teams').update(updates).eq('id', id).select().single();
        if (error) throw new Error(describeError(error));
        return data;
      }
      return mockStore.teams.update(id, updates);
    },
    members: async (teamId: string): Promise<Participant[]> => {
      if (supabase) {
        const { data, error } = await supabase
          .from('team_members')
          .select('participant_id')
          .eq('team_id', teamId);
        if (error) throw new Error(describeError(error));
        
        const participantIds = (data || []).map(d => d.participant_id);
        if (participantIds.length === 0) return [];

        const { data: members, error: memError } = await supabase
          .from('participants')
          .select('*')
          .in('id', participantIds)
          .is('deleted_at', null);
        if (memError) throw new Error(describeError(memError));
        return members || [];
      }
      return mockStore.teams.members(teamId);
    },
    addMember: async (teamId: string, participantId: string): Promise<TeamMember> => {
      if (supabase) {
        const team = await db.teams.get(teamId);
        const participant = await db.participants.get(participantId);
        if (!team || !participant) throw new Error('Team or Participant not found');
        if (participant.club_id !== team.club_id) {
          throw new Error('Verification failed: Participant must belong to the same club as the team.');
        }

        const { data, error } = await supabase
          .from('team_members')
          .insert([{ team_id: teamId, participant_id: participantId }])
          .select()
          .single();
        if (error) throw new Error(describeError(error));
        return data;
      }
      return mockStore.teams.addMember(teamId, participantId);
    },
    removeMember: async (teamId: string, participantId: string): Promise<void> => {
      if (supabase) {
        const { error } = await supabase
          .from('team_members')
          .delete()
          .eq('team_id', teamId)
          .eq('participant_id', participantId);
        if (error) throw new Error(describeError(error));
        return;
      }
      return mockStore.teams.removeMember(teamId, participantId);
    },
    delete: async (id: string): Promise<void> => {
      if (supabase) {
        const { error } = await supabase.from('teams').delete().eq('id', id);
        if (error) throw new Error(describeError(error));
        return;
      }
      // No-op for mock store (Supabase always connected in production)
      return;
    }
  },

  // 5b. Participant Categories Mappings
  participantCategories: {
    list: async (): Promise<ParticipantCategory[]> => {
      // ISOLATION: Route through active tournament DB to prevent cross-tournament leakage
      if (activeTournamentDb) {
        return mockStore.participantCategories.list();
      }
      if (supabase) {
        const activeTournamentId = getActiveTournamentIdSync();
        let query = supabase.from('participant_categories').select('*');
        if (activeTournamentId) {
          query = query.eq('tournament_id', activeTournamentId);
        }
        const { data, error } = await query;
        if (error) throw new Error(describeError(error));
        return data || [];
      }
      return mockStore.participantCategories.list();
    }
  },

  // 6. Participants
  participants: {
    list: async (): Promise<Participant[]> => {
      // SCMS writes normalized rows, while opened tournaments use a JSON snapshot.
      // Pull missing intake rows into this tournament only; never push cloud sync here.
      if (activeTournamentDb) {
        if (supabase && (typeof navigator === 'undefined' || navigator.onLine)) {
          const snapshot = activeTournamentDb;
          try {
            const added = await refreshScmsIntake(snapshot, supabase);
            if (added) await localStore.cacheTournament(snapshot);
          } catch (error) {
            console.warn(describeError(error));
            throw error;
          }
        }
        return mockStore.participants.list();
      }
      if (supabase) {
        try {
          const activeTournamentId = getActiveTournamentIdSync();
          let query = supabase.from('participants').select('*').is('deleted_at', null);
          if (activeTournamentId) {
            query = query.eq('tournament_id', activeTournamentId);
          }
          const { data, error } = await query.order('created_at', { ascending: false });
          if (error) throw new Error(describeError(error));
          return data || [];
        } catch (e: unknown) {
          console.warn('Supabase participants list error, falling back to mockStore:', describeError(e));
        }
      }
      return mockStore.participants.list();
    },
    listDeleted: async (): Promise<Participant[]> => {
      if (activeTournamentDb) {
        return mockStore.participants.listDeleted();
      }
      if (supabase) {
        const activeTournamentId = getActiveTournamentIdSync();
        let query = supabase.from('participants').select('*').not('deleted_at', 'is', null);
        if (activeTournamentId) {
          query = query.eq('tournament_id', activeTournamentId);
        }
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw new Error(describeError(error));
        return data || [];
      }
      return mockStore.participants.listDeleted();
    },
    get: async (id: string): Promise<Participant | undefined> => {
      // ISOLATION: Route through active tournament DB when one is open
      if (activeTournamentDb) {
        return mockStore.participants.get(id);
      }
      if (supabase) {
        const isUuid = id && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
        if (!isUuid) {
          return mockStore.participants.get(id);
        }
        const { data, error } = await supabase.from('participants').select('*').eq('id', id).maybeSingle();
        if (error) throw new Error(describeError(error));
        return data || undefined;
      }
      return mockStore.participants.get(id);
    },
    add: async (participant: Omit<Participant, 'id' | 'registration_no' | 'created_at'> & { id?: string; registration_no?: string }): Promise<Participant> => {
      // ISOLATION: Route through active tournament DB when one is open
      if (activeTournamentDb) {
        return mockStore.participants.add(participant);
      }
      if (supabase) {
        const activeTournamentId = getActiveTournamentIdSync();
        // Preserve a supplied registration_no (CSV round-trip); otherwise generate: REG-YYYY-<timestamp5>-<random4>
        if (participant.registration_no) {
          const payload = activeTournamentId ? { ...participant, tournament_id: activeTournamentId } : participant;
          const { data: insertData, error } = await supabase
            .from('participants')
            .insert([payload])
            .select()
            .single();
          if (error) throw new Error(describeError(error));
          const p = insertData as Participant;
          await db.participants.autoAssignCategory(p);
          await db.activityLogs.log(p.id, 'System', 'Registration Created', `Participant ${p.full_name} registered successfully`);
          return p;
        }
        const generateRegNo = () => {
          const year = new Date().getFullYear();
          const ts = Date.now() % 100000; // last 5 digits of timestamp
          const rand = Math.floor(1000 + Math.random() * 9000); // 4-digit random
          return `REG-${year}-${ts}-${rand}`;
        };

        let data: Participant | null = null;
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          const regNo = generateRegNo();
          const payload = activeTournamentId
            ? { ...participant, registration_no: regNo, tournament_id: activeTournamentId }
            : { ...participant, registration_no: regNo };
          const { data: insertData, error } = await supabase
            .from('participants')
            .insert([payload])
            .select()
            .single();
          if (!error) {
            data = insertData as Participant;
            break;
          }
          // Only retry on unique constraint violations
          if (error.code === '23505' && error.message.includes('registration_no')) {
            lastError = error as Error;
            await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
            continue;
          }
          throw new Error(describeError(error));
        }
        if (!data) throw lastError ?? new Error('Failed to generate unique registration number');

        const p = data as Participant;

        // Auto assign category in Supabase
        await db.participants.autoAssignCategory(p);

        // Logs
        await db.activityLogs.log(p.id, 'System', 'Registration Created', `Participant ${p.full_name} registered successfully`);
        return p;
      }
      return mockStore.participants.add(participant);
    },
    update: async (id: string, updates: Partial<Participant>, operator = 'Admin'): Promise<Participant> => {
      // ISOLATION: Route through active tournament DB when one is open
      if (activeTournamentDb) {
        return mockStore.participants.update(id, updates, operator);
      }
      if (supabase) {
        const original = await db.participants.get(id);
        const { data, error } = await supabase
          .from('participants')
          .update(updates)
          .eq('id', id)
          .select()
          .single();
        
        if (error) throw new Error(describeError(error));
        const p = data as Participant;

        // Auto re-assign category if criteria or event selections changed
        if (updates.dob || updates.weight || updates.gender || updates.isKumite !== undefined || updates.isKata !== undefined) {
          await db.participants.autoAssignCategory(p);
        }

        await db.activityLogs.log(id, operator, 'Details Edited', 'Personal details updated');
        await db.audit.log(operator, 'UPDATE', 'participants', id, toAuditRecord(original), toAuditRecord(p));
        return p;
      }
      return mockStore.participants.update(id, updates, operator);
    },
    delete: async (id: string, operator = 'Admin'): Promise<void> => {
      if (activeTournamentDb) {
        mockStore.participants.delete(id, operator);
        return;
      }
      if (supabase) {
        const isUuid = id && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
        if (!isUuid) {
          mockStore.participants.delete(id, operator);
          return;
        }
        const original = await db.participants.get(id);
        const { error } = await supabase
          .from('participants')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw new Error(describeError(error));

        await db.activityLogs.log(id, operator, 'Soft Deleted', 'Participant soft-deleted from active list');
        await db.audit.log(operator, 'DELETE', 'participants', id, toAuditRecord(original), null);
        return;
      }
      return mockStore.participants.delete(id, operator);
    },
    deleteAll: async (operator = 'Admin'): Promise<number> => {
      let count = 0;
      // ISOLATION: When a tournament is active, clear all participants from active DB
      if (activeTournamentDb) {
        count = mockStore.participants.deleteAll(operator);
      }
      if (supabase) {
        try {
          const activeTournamentId = getActiveTournamentIdSync();
          let query = supabase.from('participants').select('id');
          if (activeTournamentId) {
            query = query.eq('tournament_id', activeTournamentId);
          }
          const { data: all, error: listErr } = await query;
          if (!listErr && all && all.length > 0) {
            const ids = all.map((p: any) => p.id);
            if (!count) count = ids.length;
            await supabase.from('participant_categories').delete().in('participant_id', ids);
            await supabase.from('participants').delete().in('id', ids);
          }
          await db.activityLogs.log(null, operator, 'Bulk Delete', `Cleared ${count} participants from database`);
        } catch (e) {
          console.warn('Supabase bulk delete participants error:', describeError(e));
        }
      }
      if (!activeTournamentDb && !supabase) {
        count = mockStore.participants.deleteAll(operator);
      }
      return count;
    },
    restore: async (id: string, operator = 'Admin'): Promise<Participant> => {
      if (supabase) {
        const { data, error } = await supabase
          .from('participants')
          .update({ deleted_at: null })
          .eq('id', id)
          .select()
          .single();
        if (error) throw new Error(describeError(error));

        await db.activityLogs.log(id, operator, 'Restored', 'Participant restored from bin');
        await db.audit.log(operator, 'INSERT', 'participants', id, null, toAuditRecord(data));
        return data;
      }
      return mockStore.participants.restore(id, operator);
    },
    autoAssignCategory: async (p: Participant): Promise<Category[]> => {
      // ISOLATION: Route through active tournament DB when one is open
      if (activeTournamentDb) {
        return mockStore.participants.autoAssignCategory(p);
      }
      if (supabase) {
        const activeTournamentId = getActiveTournamentIdSync();
        const categories = await db.categories.list();
        const age = mockStore.helpers.calculateAge(p.dob);
        const pGenderNorm = (p.gender || '').toLowerCase().startsWith('f') ? 'Female' : (p.gender || '').toLowerCase().startsWith('m') ? 'Male' : 'Mixed';

        const wantKumite = p.isKumite === true;
        const wantKata = p.isKata === true;

        const matchedCategories = categories.filter(c => {
          if (c.status === 'Closed') return false;

          const cGenderNorm = c.gender || 'Male';
          const genderMatches = cGenderNorm === 'Mixed' || cGenderNorm === pGenderNorm;
          if (!genderMatches) return false;
          
          const ageMatches = age >= c.min_age && age <= c.max_age;
          if (!ageMatches) return false;
          
          const isKataCat = isKataCategory(c);
          const isKumiteCat = isKumiteCategory(c);
          
          if (wantKumite || wantKata) {
            if (isKataCat && !wantKata) return false;
            if (isKumiteCat && !wantKumite) return false;
          } else if (p.isKumite === false && p.isKata === false) {
            return false;
          }

          if (isKataCat) {
            return true;
          }

          const isWeightFree = (c.min_weight === 0 && (c.max_weight === 0 || c.max_weight >= 100));
          const weightMatches = isWeightFree || (p.weight >= c.min_weight && p.weight <= c.max_weight);
          return weightMatches;
        });

        // Remove old mapping ALWAYS
        await supabase.from('participant_categories').delete().eq('participant_id', p.id);
        
        if (matchedCategories.length > 0) {
          // Insert new mappings with tournament_id for isolation
          const inserts = matchedCategories.map(matched => ({
            participant_id: p.id,
            category_id: matched.id,
            manual_override: false,
            ...(activeTournamentId ? { tournament_id: activeTournamentId } : {})
          }));
          await supabase.from('participant_categories').insert(inserts);
        }
        return matchedCategories;
      }
      return mockStore.participants.autoAssignCategory(p);
    },
    assignCategoryManually: async (participantId: string, categoryId: string, operator = 'Admin'): Promise<void> => {
      if (supabase) {
        // Delete previous mappings
        await supabase.from('participant_categories').delete().eq('participant_id', participantId);
        // Insert custom mapping
        await supabase.from('participant_categories').insert([{
          participant_id: participantId,
          category_id: categoryId,
          manual_override: true
        }]);

        const cat = (await db.categories.list()).find(c => c.id === categoryId);
        await db.activityLogs.log(participantId, operator, 'Category Moved (Manual)', `Moved category manually to: ${cat ? cat.name : 'Custom Category'}`);
        return;
      }
      return mockStore.participants.assignCategoryManually(participantId, categoryId, operator);
    },
    removeCategoryMapping: async (participantId: string, categoryId: string): Promise<void> => {
      if (supabase) {
        await supabase.from('participant_categories')
          .delete()
          .eq('participant_id', participantId)
          .eq('category_id', categoryId);
        return;
      }
      return mockStore.participants.removeCategoryMapping(participantId, categoryId);
    },
    getAssignedCategory: async (participantId: string): Promise<Category | undefined> => {
      if (supabase) {
        // A participant may have more than one mapping (e.g. Kumite + Kata) — take the first
        const { data, error } = await supabase
          .from('participant_categories')
          .select('category_id')
          .eq('participant_id', participantId)
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(describeError(error));
        if (!data) return undefined;

        const categories = await db.categories.list();
        return categories.find(c => c.id === data.category_id);
      }
      return mockStore.participants.getAssignedCategory(participantId);
    }
  },

  // 7. Payments
  payments: {
    list: async (): Promise<Payment[]> => {
      if (activeTournamentDb) {
        return mockStore.payments.list();
      }
      if (supabase) {
        const { data, error } = await supabase.from('payments').select('*');
        if (error) throw new Error(describeError(error));
        return data || [];
      }
      return mockStore.payments.list();
    },
    create: async (participantId: string, pay: Partial<Payment>): Promise<Payment> => {
      if (activeTournamentDb) {
        return mockStore.payments.create(participantId, pay);
      }
      if (supabase) {
        const isUuid = participantId && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(participantId);
        if (!isUuid) return mockStore.payments.create(participantId, pay);
        const { data, error } = await supabase
          .from('payments')
          .insert([{ participant_id: participantId, amount: pay.amount || 150, status: pay.status || 'Unpaid', payment_method: pay.payment_method }])
          .select()
          .single();
        if (error) throw new Error(describeError(error));
        return data;
      }
      return mockStore.payments.create(participantId, pay);
    },
    update: async (id: string, updates: Partial<Payment>): Promise<Payment> => {
      if (activeTournamentDb) {
        return mockStore.payments.update(id, updates);
      }
      if (supabase) {
        const { data, error } = await supabase.from('payments').update(updates).eq('id', id).select().single();
        if (error) throw new Error(describeError(error));
        return data;
      }
      return mockStore.payments.update(id, updates);
    }
  },

  // 8. Medical Records
  medical: {
    get: async (participantId: string): Promise<MedicalRecord | undefined> => {
      if (activeTournamentDb) {
        return mockStore.medical.get(participantId);
      }
      if (supabase) {
        const isUuid = participantId && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(participantId);
        if (!isUuid) return mockStore.medical.get(participantId);
        const { data, error } = await supabase.from('medical_records').select('*').eq('participant_id', participantId).maybeSingle();
        if (error) throw new Error(describeError(error));
        return data || undefined;
      }
      return mockStore.medical.get(participantId);
    },
    create: async (participantId: string, med: Partial<MedicalRecord>): Promise<MedicalRecord> => {
      if (activeTournamentDb) {
        return mockStore.medical.create(participantId, med);
      }
      if (supabase) {
        const isUuid = participantId && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(participantId);
        if (!isUuid) return mockStore.medical.create(participantId, med);
        const { data, error } = await supabase
          .from('medical_records')
          .insert([{ participant_id: participantId, conditions: med.conditions || 'None', allergies: med.allergies || 'None', blood_type: med.blood_type || 'O+', has_clearance: med.has_clearance }])
          .select()
          .single();
        if (error) throw new Error(describeError(error));
        return data;
      }
      return mockStore.medical.create(participantId, med);
    },
    update: async (id: string, updates: Partial<MedicalRecord>): Promise<MedicalRecord> => {
      if (activeTournamentDb) {
        return mockStore.medical.update(id, updates);
      }
      if (supabase) {
        const { data, error } = await supabase.from('medical_records').update(updates).eq('id', id).select().single();
        if (error) throw new Error(describeError(error));
        return data;
      }
      return mockStore.medical.update(id, updates);
    }
  },

  // 9. Documents
  documents: {
    list: async (participantId: string): Promise<Document[]> => {
      if (activeTournamentDb) {
        return mockStore.documents.list(participantId);
      }
      if (supabase) {
        const isUuid = participantId && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(participantId);
        if (!isUuid) return mockStore.documents.list(participantId);
        const { data, error } = await supabase.from('documents').select('*').eq('participant_id', participantId);
        if (error) throw new Error(describeError(error));
        return data || [];
      }
      return mockStore.documents.list(participantId);
    },
    upload: async (participantId: string, name: string, docType: string, fileUrl: string): Promise<Document> => {
      if (activeTournamentDb) {
        return mockStore.documents.upload(participantId, name, docType, fileUrl);
      }
      if (supabase) {
        const isUuid = participantId && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(participantId);
        if (!isUuid) return mockStore.documents.upload(participantId, name, docType, fileUrl);
        const { data, error } = await supabase
          .from('documents')
          .insert([{ participant_id: participantId, name, doc_type: docType, file_url: fileUrl }])
          .select()
          .single();
        if (error) throw new Error(describeError(error));
        return data;
      }
      return mockStore.documents.upload(participantId, name, docType, fileUrl);
    },
    delete: async (id: string): Promise<void> => {
      if (activeTournamentDb) {
        return mockStore.documents.delete(id);
      }
      if (supabase) {
        const { error } = await supabase.from('documents').delete().eq('id', id);
        if (error) throw new Error(describeError(error));
        return;
      }
      return mockStore.documents.delete(id);
    }
  },

  // 10. Activity Logs
  activityLogs: {
    list: async (participantId: string): Promise<ActivityLog[]> => {
      if (activeTournamentDb) {
        return mockStore.activityLogs.list(participantId);
      }
      if (supabase) {
        const isUuid = participantId && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(participantId);
        if (!isUuid) return mockStore.activityLogs.list(participantId);
        const { data, error } = await supabase
          .from('activity_logs')
          .select('*')
          .eq('participant_id', participantId)
          .order('created_at', { ascending: false });
        if (error) throw new Error(describeError(error));
        return data || [];
      }
      return mockStore.activityLogs.list(participantId);
    },
    log: async (participantId: string | null, operatorName: string, action: string, details: string): Promise<ActivityLog> => {
      if (supabase) {
        const isUuid = participantId && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(participantId);
        const validParticipantId = isUuid ? participantId : null;
        const { data, error } = await supabase
          .from('activity_logs')
          .insert([{ participant_id: validParticipantId, operator_name: operatorName, action, details }])
          .select()
          .single();
        if (error) throw new Error(describeError(error));
        return data;
      }
      return mockStore.activityLogs.log(participantId, operatorName, action, details);
    }
  },

  // 11. Audit Logs
  audit: {
    list: async (): Promise<AuditLog[]> => {
      if (supabase) {
        const { data, error } = await supabase
          .from('audit_logs')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw new Error(describeError(error));
        return data || [];
      }
      return mockStore.audit.list();
    },
    log: async (operator: string, action: 'INSERT' | 'UPDATE' | 'DELETE', tableName: string, recordId: string, oldValues: Record<string, unknown> | null, newValues: Record<string, unknown> | null): Promise<AuditLog> => {
      if (supabase) {
        const { data, error } = await supabase
          .from('audit_logs')
          .insert([{ 
            user_email: operator, 
            action, 
            table_name: tableName, 
            record_id: recordId, 
            old_values: oldValues, 
            new_values: newValues 
          }])
          .select()
          .single();
        if (error) throw new Error(describeError(error));
        return data;
      }
      return mockStore.audit.log(operator, action, tableName, recordId, oldValues, newValues);
    }
  },

  // 12. Bouts & Brackets
  bouts: {
    list: async (): Promise<Bout[]> => {
      // ISOLATION: Route through active tournament DB to prevent cross-tournament leakage
      if (activeTournamentDb) {
        return mockStore.bouts.list();
      }
      if (supabase) {
        try {
          const activeTournamentId = getActiveTournamentIdSync();
          let query = supabase.from('bouts').select('*');
          if (activeTournamentId) {
            query = query.eq('tournament_id', activeTournamentId);
          }
          const { data, error } = await query;
          if (error) throw new Error(describeError(error));
          return data || [];
        } catch (e: unknown) {
          console.warn('Supabase bouts list error, falling back to mockStore:', describeError(e));
        }
      }
      return mockStore.bouts.list();
    },
    listForCategory: async (catId: string): Promise<Bout[]> => {
      if (activeTournamentDb) {
        return mockStore.bouts.listForCategory(catId);
      }
      if (supabase) {
        const activeTournamentId = getActiveTournamentIdSync();
        let query = supabase.from('bouts').select('*').eq('category_id', catId);
        if (activeTournamentId) {
          query = query.eq('tournament_id', activeTournamentId);
        }
        const { data, error } = await query.order('bout_no');
        if (error) throw new Error(describeError(error));
        return data || [];
      }
      return mockStore.bouts.listForCategory(catId);
    },
    clearDraw: async (catId: string): Promise<void> => {
      if (activeTournamentDb) {
        return mockStore.bouts.clearDraw(catId);
      }
      if (supabase) {
        const { error } = await supabase.from('bouts').delete().eq('category_id', catId);
        if (error) throw new Error(describeError(error));
        return;
      }
      return mockStore.bouts.clearDraw(catId);
    },
    saveBouts: async (catId: string, newBouts: Bout[]): Promise<void> => {
      if (activeTournamentDb) {
        return mockStore.bouts.saveBouts(catId, newBouts);
      }
      if (supabase) {
        const { error } = await supabase.from('bouts').insert(newBouts);
        if (error) throw new Error(describeError(error));
        return;
      }
      return mockStore.bouts.saveBouts(catId, newBouts);
    },
    clearAllBouts: async (): Promise<void> => {
      if (activeTournamentDb) {
        mockStore.bouts.clearAllBouts();
        return;
      }
      if (supabase) {
        try {
          const activeTournamentId = getActiveTournamentIdSync();
          let query = supabase.from('bouts').select('id');
          if (activeTournamentId) {
            query = (query as any).eq('tournament_id', activeTournamentId);
          }
          const { data } = await query;
          if (data && data.length > 0) {
            const ids = data.map((b: any) => b.id);
            await supabase.from('bouts').delete().in('id', ids);
          }
        } catch (e) {
          console.warn('Supabase clearAllBouts error:', e);
        }
      }
      mockStore.bouts.clearAllBouts();
      if (typeof window !== 'undefined') {
        localStorage.setItem('ts_bouts', JSON.stringify([]));
      }
    },
    resetAllSchedules: async (): Promise<void> => {
      if (activeTournamentDb) {
        mockStore.bouts.resetAllSchedules();
        return;
      }
      if (supabase) {
        try {
          const activeTournamentId = getActiveTournamentIdSync();
          let query = supabase.from('bouts').select('id');
          if (activeTournamentId) {
            query = (query as any).eq('tournament_id', activeTournamentId);
          }
          const { data } = await query;
          if (data && data.length > 0) {
            const ids = data.map((b: any) => b.id);
            await supabase.from('bouts').update({ tatami: null, scheduled_time: null }).in('id', ids);
          }
        } catch (e) {
          console.warn('Supabase resetAllSchedules error:', e);
        }
      }
      mockStore.bouts.resetAllSchedules();
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('ts_bouts');
        if (stored) {
          const list = JSON.parse(stored);
          const updated = list.map((b: any) => ({ ...b, tatami: null, scheduled_time: null }));
          localStorage.setItem('ts_bouts', JSON.stringify(updated));
        }
      }
    },
    generateDraw: async (catId: string, drawType: string, hasThirdPlace: boolean): Promise<Bout[]> => {
      console.log('[dbClient.generateDraw] catId:', catId, 'drawType:', drawType, 'hasThirdPlace:', hasThirdPlace, 'isSupabase:', !!supabase);

      // Resolve the category's assigned tatami.
      // Priority: 1) ts_cat_tatami_map (admin-set, never overwritten by Supabase sync)
      //           2) ts_categories.assigned_tatami (legacy fallback)
      let resolvedTatami: string | undefined;
      if (typeof window !== 'undefined') {
        try {
          // First try the dedicated map (most reliable)
          const rawMap = localStorage.getItem('ts_cat_tatami_map');
          if (rawMap) {
            const catTatamiMap = JSON.parse(rawMap);
            if (catTatamiMap[String(catId)]) {
              resolvedTatami = catTatamiMap[String(catId)];
              console.log('[dbClient.generateDraw] resolved tatami from ts_cat_tatami_map:', resolvedTatami);
            }
          }
          // Fall back to ts_categories
          if (!resolvedTatami) {
            const rawCats = localStorage.getItem('ts_categories');
            if (rawCats) {
              const catList = JSON.parse(rawCats);
              const matchedCat = catList.find((c: any) => String(c.id) === String(catId));
              if (matchedCat?.assigned_tatami) {
                resolvedTatami = matchedCat.assigned_tatami;
                console.log('[dbClient.generateDraw] resolved tatami from ts_categories:', resolvedTatami);
              }
            }
          }
        } catch (e) {
          console.warn('[dbClient.generateDraw] failed to read tatami from localStorage:', e);
        }
      }

      // ISOLATION: Route through active tournament DB when one is open
      if (activeTournamentDb) {
        return mockStore.bouts.generateDraw(catId, drawType, hasThirdPlace, undefined, resolvedTatami);
      }

      if (supabase) {
        const activeTournamentId = getActiveTournamentIdSync();
        // Fetch active mappings from Supabase (scoped to active tournament)
        let mappingQuery = supabase
          .from('participant_categories')
          .select('participant_id')
          .eq('category_id', catId);
        if (activeTournamentId) {
          mappingQuery = mappingQuery.eq('tournament_id', activeTournamentId);
        }
        const { data: mappings, error: mapErr } = await mappingQuery;
        if (mapErr) throw new Error(describeError(mapErr));

        console.log('[dbClient.generateDraw] Supabase mappings fetched count:', mappings?.length || 0);
        const participantIds = (mappings || []).map(m => m.participant_id);
        let athletes: Participant[] = [];
        if (participantIds.length > 0) {
          let partQuery = supabase
            .from('participants')
            .select('*')
            .in('id', participantIds)
            .is('deleted_at', null)
            .neq('status', 'Cancelled');
          if (activeTournamentId) {
            partQuery = partQuery.eq('tournament_id', activeTournamentId);
          }
          const { data: partData, error: partErr } = await partQuery;
          if (partErr) throw partErr;
          athletes = partData || [];
        }

        console.log('[dbClient.generateDraw] Supabase active athletes count:', athletes.length, 'tatami:', resolvedTatami);
        const generated = mockStore.bouts.generateDraw(catId, drawType, hasThirdPlace, athletes, resolvedTatami);
        
        // Remove the 'id' field so Supabase can generate proper UUIDs
        // Inject tournament_id for isolation
        const generatedWithoutId = generated.map(({ id, ...rest }) => ({
          ...rest,
          ...(activeTournamentId ? { tournament_id: activeTournamentId } : {})
        }));

        await supabase.from('bouts').delete().eq('category_id', catId);
        const { data, error } = await supabase.from('bouts').insert(generatedWithoutId).select();
        if (error) throw new Error(describeError(error));

        const savedBouts = data || [];
        // Sync local storage / mockStore cache
        mockStore.bouts.saveBouts(catId, savedBouts);
        return savedBouts;
      }
      return mockStore.bouts.generateDraw(catId, drawType, hasThirdPlace, undefined, resolvedTatami);
    },
    generateRepechage: async (catId: string): Promise<Bout[]> => {
      // ISOLATION: Route through active tournament DB when one is open
      if (activeTournamentDb) {
        return mockStore.bouts.generateRepechage(catId);
      }
      if (supabase) {
        try {
          const activeTournamentId = getActiveTournamentIdSync();
          const generated = mockStore.bouts.generateRepechage(catId);
          await supabase.from('bouts').delete().eq('category_id', catId).eq('round_no', 98);
          const generatedWithoutId = generated.map(({ id, ...rest }) => ({
            ...rest,
            ...(activeTournamentId ? { tournament_id: activeTournamentId } : {})
          }));
          const { data, error } = await supabase.from('bouts').insert(generatedWithoutId).select();
          if (error) throw new Error(describeError(error));
          const saved = data || [];
          // Reload only bouts scoped to active tournament
          let allQuery = supabase.from('bouts').select('*');
          if (activeTournamentId) {
            allQuery = allQuery.eq('tournament_id', activeTournamentId);
          }
          const { data: allDbBouts } = await allQuery;
          if (allDbBouts) {
            localStorage.setItem('ts_bouts', JSON.stringify(allDbBouts));
          }
          return saved;
        } catch (e: unknown) {
          console.warn('Supabase repechage error:', describeError(e));
        }
      }
      return mockStore.bouts.generateRepechage(catId);
    },
    updateBoutResult: async (boutId: string, winnerId: string, scoreA: number, scoreB: number): Promise<Bout> => {
      if (supabase) {
        try {
          mockStore.bouts.updateBoutResult(boutId, winnerId, scoreA, scoreB);
        } catch (e) {
          console.warn('Local mockStore sync skipped:', e);
        }
        
        try {
          const { data, error } = await supabase.from('bouts').update({
            winner_id: winnerId,
            score_a: scoreA,
            score_b: scoreB,
            status: 'Completed'
          }).eq('id', boutId).select().single();
          
          // Fetch fresh list from Supabase to correctly calculate and advance brackets
          const { data: dbBouts, error: boutsErr } = await supabase.from('bouts').select('*');
          if (!boutsErr && dbBouts) {
            const bout = dbBouts.find(b => b.id === boutId);
            if (bout) {
              if (bout.round_no === 98) {
                const nextBoutNo = bout.bout_no + 1;
                const nextBout = dbBouts.find(b => b.category_id === bout.category_id && b.round_no === 98 && b.bout_no === nextBoutNo);
                if (nextBout) {
                  await supabase.from('bouts').update({ participant_a_id: winnerId }).eq('id', nextBout.id);
                }
              } else if (bout.round_no !== 99 && bout.round_no < 7) {
                const maxRound = Math.max(...dbBouts.filter(b => b.category_id === bout.category_id && b.round_no !== 99 && b.round_no !== 98).map(b => b.round_no), 1);
                let changes = true;
                while (changes) {
                  changes = false;
                  for (let r = 1; r < maxRound; r++) {
                    const currentRoundBouts = dbBouts.filter(b => b.category_id === bout.category_id && b.round_no === r);
                    const nextRoundBouts = dbBouts.filter(b => b.category_id === bout.category_id && b.round_no === r + 1);
                    
                    for (const nb of nextRoundBouts) {
                      const feederA = currentRoundBouts.find(cb => cb.bout_no === nb.bout_no * 2 - 1);
                      const feederB = currentRoundBouts.find(cb => cb.bout_no === nb.bout_no * 2);
                      
                      let nextA = nb.participant_a_id;
                      let nextB = nb.participant_b_id;
                      let nextWinner = nb.winner_id;
                      let nextStatus = nb.status;
                      
                      if (feederA && feederA.winner_id !== nb.participant_a_id) {
                        nextA = feederA.winner_id;
                      }
                      if (feederB && feederB.winner_id !== nb.participant_b_id) {
                        nextB = feederB.winner_id;
                      }
                      
                      const feederAResolved = feederA ? (feederA.status === 'Completed' || feederA.status === 'Walkover') : true;
                      const feederBResolved = feederB ? (feederB.status === 'Completed' || feederB.status === 'Walkover') : true;
                      
                      if (feederAResolved && feederBResolved) {
                        if (nextA && !nextB) {
                          nextWinner = nextA;
                          nextStatus = 'Walkover';
                        } else if (!nextA && nextB) {
                          nextWinner = nextB;
                          nextStatus = 'Walkover';
                        } else if (!nextA && !nextB) {
                          nextWinner = null;
                          nextStatus = 'Walkover';
                        }
                      }
                      
                      if (nb.participant_a_id !== nextA || nb.participant_b_id !== nextB || nb.winner_id !== nextWinner || nb.status !== nextStatus) {
                        nb.participant_a_id = nextA;
                        nb.participant_b_id = nextB;
                        nb.winner_id = nextWinner;
                        nb.status = nextStatus;
                        changes = true;
                        
                        await supabase.from('bouts').update({
                          participant_a_id: nextA,
                          participant_b_id: nextB,
                          winner_id: nextWinner,
                          status: nextStatus
                        }).eq('id', nb.id);
                      }
                    }
                  }
                }
              }
              // Auto-complete category
              const catBouts = dbBouts.filter(b => b.category_id === bout.category_id);
              if (catBouts.length > 0) {
                const allCompleted = catBouts.every(b => b.status === 'Completed' || b.status === 'Walkover');
                if (allCompleted) {
                  await supabase.from('categories').update({ draw_status: 'Completed' }).eq('id', bout.category_id);
                  
                  // Auto-save FINAL version via bracketVersions (local caching)
                  const { data: catData } = await supabase.from('categories').select('*').eq('id', bout.category_id).single();
                  const { data: parts } = await supabase.from('participants').select('*');
                  
                  if (catData && parts) {
                    const { createVersion } = await import('./bracketVersions');
                    const tId = getActiveTournamentIdSync();
                    
                    await createVersion({
                      tournamentId: tId || catData.tournament_id || 'remote',
                      category: catData,
                      bouts: catBouts,
                      participants: parts,
                      reason: 'BOUT_RESULT_UPDATE',
                      status: 'FINAL',
                      createdBy: 'system'
                    }).catch(e => console.warn('Remote auto-save version failed:', e));
                  }
                }
              }
              
              // Check repechage
              const { data: catData } = await supabase.from('categories').select('format').eq('id', bout.category_id).single();
              if (catData?.format === 'wkf_repechage') {
                const maxRound = Math.max(...catBouts.filter(b => b.round_no !== 99 && b.round_no !== 98).map(b => b.round_no), 1);
                const finalBout = catBouts.find(b => b.round_no === maxRound && b.bout_no === 1);
                if (finalBout && finalBout.participant_a_id && finalBout.participant_b_id) {
                  const hasRepechage = catBouts.some(b => b.round_no === 98);
                  if (!hasRepechage) {
                    await db.bouts.generateRepechage(bout.category_id);
                  }
                }
              }
            }
          }

          if (error) throw new Error(describeError(error));
          return data;
        } catch (e: unknown) {
          console.warn('Supabase bouts table update result error, falling back to mockStore:', describeError(e));
        }
      }
      return mockStore.bouts.updateBoutResult(boutId, winnerId, scoreA, scoreB);
    },
    reassignParticipant: async (boutId: string, position: 'AKA' | 'AO', newParticipantId: string, categoryId: string): Promise<Bout> => {
      const activeTournamentId = getActiveTournamentIdSync() ?? undefined;
      
      // Perform server-side logic and validation via mockStore first
      let updatedMockBout: Bout;
      try {
        updatedMockBout = mockStore.bouts.reassignParticipant(boutId, position, newParticipantId, categoryId, activeTournamentId);
      } catch (mockErr: unknown) {
        throw new Error(describeError(mockErr));
      }

      if (activeTournamentDb) {
        return updatedMockBout;
      }

      if (supabase) {
        try {
          // Double verify in Supabase
          let mappingQuery = supabase
            .from('participant_categories')
            .select('*')
            .eq('participant_id', newParticipantId)
            .eq('category_id', categoryId);
          
          if (activeTournamentId) {
            mappingQuery = mappingQuery.eq('tournament_id', activeTournamentId);
          }
          
          const { data: mappings, error: mapErr } = await mappingQuery;
          if (mapErr) throw mapErr;
          if (!mappings || mappings.length === 0) {
            throw new Error('Participant does not belong to this category.');
          }

          const updatePayload = position === 'AKA' 
            ? { participant_a_id: newParticipantId } 
            : { participant_b_id: newParticipantId };

          const { data, error } = await supabase
            .from('bouts')
            .update(updatePayload)
            .eq('id', boutId)
            .eq('category_id', categoryId)
            .select()
            .single();

          if (error) throw error;
          
          // Add audit log
          await supabase.from('audit_logs').insert([{
            action: 'UPDATE',
            table_name: 'bouts',
            record_id: boutId,
            new_values: { position, newParticipantId, categoryId, action: 'MANUAL_REASSIGNMENT' }
          }]);

          return data;
        } catch (e: unknown) {
          console.error('Supabase reassignParticipant failed:', describeError(e));
          throw new Error('Failed to save reassignment to database: ' + describeError(e));
        }
      }

      return updatedMockBout;
    },
    updateBoutState: async (id: string, updates: Partial<Bout>): Promise<Bout> => {
      if (supabase) {
        try {
          const { data: currentBout } = await supabase.from('bouts').select('category_id').eq('id', id).single();
          if (currentBout) {
            await verifyCategoryLock(currentBout.category_id);
          }

          let updatedBout: Bout | null = null;
          const { data, error } = await supabase.from('bouts').update(updates).eq('id', id).select().single();
          
          if (error) {
            // Schema fallback: update core fields first, then retry the VR-specific columns separately
            // so older databases continue to work without blocking the feature.
            const coreUpdates: Record<string, any> = {};
            const vrUpdates: Record<string, any> = {};
            if (updates.score_a !== undefined) coreUpdates.score_a = updates.score_a;
            if (updates.score_b !== undefined) coreUpdates.score_b = updates.score_b;
            if (updates.status !== undefined) coreUpdates.status = updates.status;
            if (updates.winner_id !== undefined) coreUpdates.winner_id = updates.winner_id;
            if (updates.victory_method !== undefined) coreUpdates.victory_method = updates.victory_method;
            if (updates.tatami !== undefined) coreUpdates.tatami = updates.tatami;
            if (updates.scheduled_time !== undefined) coreUpdates.scheduled_time = updates.scheduled_time;
            if (updates.vr_file_url !== undefined) vrUpdates.vr_file_url = updates.vr_file_url;
            if (updates.vr_metadata !== undefined) vrUpdates.vr_metadata = updates.vr_metadata;
            if (updates.vr_recorded_at !== undefined) vrUpdates.vr_recorded_at = updates.vr_recorded_at;
            if (updates.vr_duration_seconds !== undefined) vrUpdates.vr_duration_seconds = updates.vr_duration_seconds;
            if (updates.vr_camera_label !== undefined) vrUpdates.vr_camera_label = updates.vr_camera_label;

            const { data: coreData, error: coreErr } = await supabase.from('bouts').update(coreUpdates).eq('id', id).select().single();
            if (coreErr) throw coreErr;

            if (Object.keys(vrUpdates).length > 0) {
              try {
                const { data: vrData, error: vrErr } = await supabase.from('bouts').update(vrUpdates).eq('id', id).select().single();
                if (!vrErr && vrData) {
                  updatedBout = { ...coreData, ...vrData, ...updates } as Bout;
                } else {
                  updatedBout = { ...coreData, ...updates } as Bout;
                }
              } catch {
                updatedBout = { ...coreData, ...updates } as Bout;
              }
            } else if (coreData) {
              updatedBout = { ...coreData, ...updates } as Bout;
            }
          } else if (data) {
            updatedBout = data as Bout;
          }

          if (updatedBout) {
            if ((updatedBout.status === 'Completed' && updatedBout.winner_id) || updates.winner_id === null) {
              const winnerId = updates.winner_id === null ? null : updatedBout.winner_id;
              const { data: dbBouts, error: boutsErr } = await supabase.from('bouts').select('*');
              if (!boutsErr && dbBouts) {
                const bout = dbBouts.find(b => b.id === id);
                if (bout) {
                  if (bout.round_no === 98) {
                    const nextBoutNo = bout.bout_no + 1;
                    const nextBout = dbBouts.find(b => b.category_id === bout.category_id && b.round_no === 98 && b.bout_no === nextBoutNo);
                    if (nextBout) {
                      await supabase.from('bouts').update({ participant_a_id: winnerId }).eq('id', nextBout.id);
                    }
                  } else if (bout.round_no !== 99 && bout.round_no < 7) {
                    const nextRoundNo = bout.round_no + 1;
                    const nextBoutNo = Math.ceil(bout.bout_no / 2);
                    const nextBout = dbBouts.find(b => b.category_id === bout.category_id && b.round_no === nextRoundNo && b.bout_no === nextBoutNo);
                    if (nextBout) {
                      const isSlotA = bout.bout_no % 2 !== 0;
                      const updateData = isSlotA 
                        ? { participant_a_id: winnerId } 
                        : { participant_b_id: winnerId };

                      await supabase.from('bouts').update(updateData).eq('id', nextBout.id);
                    }
                  }
                }
              }
            }
            return updatedBout;
          }
        } catch (e: unknown) {
          console.warn('Supabase bouts table update error, falling back to mockStore:', describeError(e));
        }
      }
      return mockStore.bouts.updateBoutState(id, updates);
    },
    update: async (id: string, updates: Partial<Bout>): Promise<Bout> => {
      return db.bouts.updateBoutState(id, updates);
    },
    resetBoutResult: async (boutId: string, matchDuration: number): Promise<Bout> => {
      if (supabase) {
        try {
          const { data: currentBout } = await supabase.from('bouts').select('category_id').eq('id', boutId).single();
          if (currentBout) {
            await verifyCategoryLock(currentBout.category_id);
          }
          mockStore.bouts.resetBoutResult(boutId, matchDuration);
        } catch (e) {
          console.warn('Local mockStore reset skipped:', e);
        }

        const { data: dbBouts, error: boutsErr } = await supabase.from('bouts').select('*');
        if (!boutsErr && dbBouts) {
          const bout = dbBouts.find(b => b.id === boutId);
          if (bout && bout.round_no !== 99 && bout.round_no < 7) {
            const nextRoundNo = bout.round_no + 1;
            const nextBoutNo = Math.ceil(bout.bout_no / 2);
            const nextBout = dbBouts.find(b => b.category_id === bout.category_id && b.round_no === nextRoundNo && b.bout_no === nextBoutNo);
            if (nextBout) {
              const isSlotA = bout.bout_no % 2 !== 0;
              const currentWinnerId = bout.winner_id;
              if (currentWinnerId) {
                const nextWinnerId = isSlotA ? nextBout.participant_a_id : nextBout.participant_b_id;
                if (nextWinnerId === currentWinnerId) {
                  const updateData = isSlotA 
                    ? { participant_a_id: null } 
                    : { participant_b_id: null };
                  await supabase.from('bouts').update(updateData).eq('id', nextBout.id);
                }
              }
            }
          }
        }

        try {
          const { data, error } = await supabase.from('bouts').update({
            winner_id: null,
            score_a: 0,
            score_b: 0,
            senshu_a: false,
            senshu_b: false,
            penalties_a: '',
            penalties_b: '',
            penalties_c1_a: '0',
            penalties_c2_a: '0',
            penalties_c3_a: '0',
            penalties_c1_b: '0',
            penalties_c2_b: '0',
            penalties_c3_b: '0',
            points_aka_history: '',
            points_ao_history: '',
            victory_method: '',
            timer_seconds: matchDuration,
            timer_active: false,
            status: 'Scheduled'
          }).eq('id', boutId).select().single();

          if (error) throw new Error(describeError(error));
          return data;
        } catch (e: unknown) {
          console.warn('Supabase bouts table reset error, falling back to mockStore:', describeError(e));
        }
      }
      return mockStore.bouts.resetBoutResult(boutId, matchDuration);
    },
    clearAllDraws: async (): Promise<void> => {
      mockStore.bouts.clearAllDraws();
      if (supabase) {
        try {
          await supabase.from('bouts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        } catch (e: unknown) {
          console.warn('Supabase delete all bouts error:', describeError(e));
        }
      }
    }
  },

  // 13. Officials
  officials: {
    list: async (): Promise<Official[]> => {
      // ISOLATION: Officials are tournament-specific
      if (activeTournamentDb) {
        return mockStore.officials.list();
      }
      if (supabase) {
        const activeTournamentId = getActiveTournamentIdSync();
        let query = supabase.from('officials').select('*');
        if (activeTournamentId) {
          query = query.eq('tournament_id', activeTournamentId);
        }
        const { data, error } = await query;
        if (error) throw new Error(describeError(error));
        return data || [];
      }
      return mockStore.officials.list();
    },
    add: async (off: Omit<Official, 'id'>): Promise<Official> => {
      if (supabase) {
        const { data, error } = await supabase.from('officials').insert([off]).select().single();
        if (error) throw new Error(describeError(error));
        return data;
      }
      return mockStore.officials.add(off);
    },
    update: async (id: string, updates: Partial<Official>): Promise<Official> => {
      if (supabase) {
        const { data, error } = await supabase.from('officials').update(updates).eq('id', id).select().single();
        if (error) throw new Error(describeError(error));
        return data;
      }
      return mockStore.officials.update(id, updates);
    },
    delete: async (id: string): Promise<void> => {
      if (supabase) {
        const { error } = await supabase.from('officials').delete().eq('id', id);
        if (error) throw new Error(describeError(error));
        return;
      }
      return mockStore.officials.delete(id);
    }
  },

  // 14. Tournaments
  tournaments: {
    list: async (): Promise<Tournament[]> => {
      if (supabase) {
        try {
          const { data, error } = await supabase
            .from('tournaments')
            .select('id, name, organizer, status, date, date_iso, venue, city, featured, deleted_at, settings, registration_close, registration_close_iso, discipline, medals_gold, medals_silver, medals_bronze, total_participants, total_clubs');

          if (error) throw new Error(describeError(error));
          return data || [];
        } catch (e: unknown) {
          console.warn('Supabase tournaments table list error, falling back to mockStore:', describeError(e));
        }
      }
      return mockStore.tournaments.list();
    },
    add: async (tour: Omit<Tournament, 'id'>): Promise<Tournament> => {
      if (supabase) {
        try {
          const { data, error } = await supabase.from('tournaments').insert([tour]).select().single();
          if (error) throw new Error(describeError(error));
          return data;
        } catch (e: unknown) {
          console.warn('Supabase tournaments table add error, falling back to mockStore:', describeError(e));
        }
      }
      return mockStore.tournaments.add(tour);
    },
    update: async (id: string, updates: Partial<Tournament>): Promise<Tournament> => {
      if (supabase) {
        try {
          const { data, error } = await supabase.from('tournaments').update(updates).eq('id', id).select().single();
          if (error) throw new Error(describeError(error));
          return data;
        } catch (e: unknown) {
          console.warn('Supabase tournaments table update error, falling back to mockStore:', describeError(e));
        }
      }
      return mockStore.tournaments.update(id, updates);
    },
    delete: async (id: string): Promise<void> => {
      if (supabase) {
        try {
          const { error } = await supabase.from('tournaments').delete().eq('id', id);
          if (error) throw new Error(describeError(error));
          return;
        } catch (e: unknown) {
          console.warn('Supabase tournaments table delete error, falling back to mockStore:', describeError(e));
        }
      }
      return mockStore.tournaments.delete(id);
    }
  },

  // 17. Display Playlists
  displayPlaylists: {
    list: async (): Promise<DisplayPlaylist[]> => {
      const activeDb = await resolveActiveTournamentDb();
      if (activeDb) {
        const playlists = activeDb.display_playlists || [];
        mockStore.displayPlaylists.replaceAll(playlists);
        return playlists;
      }

      if (supabase) {
        try {
          // If we had a tournament scope in supabase, we'd filter here.
          // For now, we fetch all or just rely on the local active tournament mockStore sync.
          const { data, error } = await supabase.from('display_playlists').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            mockStore.displayPlaylists.replaceAll(data);
            return data;
          }
        } catch (e: unknown) {
          console.warn('Supabase display_playlists list error, falling back to mockStore:', describeError(e));
        }
      }
      return mockStore.displayPlaylists.list();
    },
    add: async (playlist: Omit<DisplayPlaylist, 'id'>): Promise<DisplayPlaylist> => {
      const activeDb = await resolveActiveTournamentDb();
      if (activeDb) {
        const newPlaylist: DisplayPlaylist = {
          ...playlist,
          id: `playlist-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        const nextPlaylists = [newPlaylist, ...(activeDb.display_playlists || [])];
        await persistTournamentPlaylists(nextPlaylists);
        return newPlaylist;
      }

      if (supabase) {
        const newPlaylist: DisplayPlaylist = {
          ...playlist,
          id: `playlist-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        try {
          const { data, error } = await supabase.from('display_playlists').insert([newPlaylist]).select().single();
          if (!error && data) {
            mockStore.displayPlaylists.upsert(data);
            return data;
          }
        } catch (e: unknown) {
          console.warn('Supabase display_playlists add error, falling back to mockStore:', describeError(e));
        }
      }
      return mockStore.displayPlaylists.add(playlist);
    },
    update: async (id: string, updates: Partial<DisplayPlaylist>): Promise<DisplayPlaylist> => {
      const activeDb = await resolveActiveTournamentDb();
      if (activeDb) {
        const currentPlaylists = activeDb.display_playlists || [];
        const idx = currentPlaylists.findIndex(playlist => playlist.id === id);
        if (idx === -1) {
          throw new Error('DisplayPlaylist not found');
        }

        const updatedPlaylist: DisplayPlaylist = {
          ...currentPlaylists[idx],
          ...updates,
          updated_at: new Date().toISOString()
        };
        const nextPlaylists = [...currentPlaylists];
        nextPlaylists[idx] = updatedPlaylist;
        await persistTournamentPlaylists(nextPlaylists);
        return updatedPlaylist;
      }

      if (supabase) {
        const updatedPayload = { ...updates, updated_at: new Date().toISOString() };
        try {
          const { data, error } = await supabase.from('display_playlists').update(updatedPayload).eq('id', id).select().single();
          if (!error && data) {
            mockStore.displayPlaylists.upsert(data);
            return data;
          }
        } catch (e: unknown) {
          console.warn('Supabase display_playlists update error, falling back to mockStore:', describeError(e));
        }
      }
      return mockStore.displayPlaylists.update(id, updates);
    },
    delete: async (id: string): Promise<void> => {
      const activeDb = await resolveActiveTournamentDb();
      if (activeDb) {
        const nextPlaylists = (activeDb.display_playlists || []).filter(playlist => playlist.id !== id);
        await persistTournamentPlaylists(nextPlaylists);
        return;
      }

      if (supabase) {
        try {
          const { error } = await supabase.from('display_playlists').delete().eq('id', id);
          if (!error) {
            mockStore.displayPlaylists.delete(id);
            return;
          }
        } catch (e: unknown) {
          console.warn('Supabase display_playlists delete error, falling back to mockStore:', describeError(e));
        }
      }
      mockStore.displayPlaylists.delete(id);
    }
  },

  // 15. PC Control & Category Locks
  pcControl: {
    acquireLock: async (tournamentId: string, categoryId: string, pcId: string, tatami?: string, username?: string): Promise<{ success: boolean; lock?: CategoryLock }> => {
      return await pcActions.acquireLockAction(tournamentId, categoryId, pcId, tatami, username);
    },

    releaseLock: async (tournamentId: string, categoryId: string, pcId?: string): Promise<void> => {
      return await pcActions.releaseLockAction(tournamentId, categoryId, pcId);
    },

    getActiveLocks: async (tournamentId: string): Promise<CategoryLock[]> => {
      return await pcActions.getActiveLocks(tournamentId);
    },

    registerPC: async (pcIdentifier: string, pcName: string, tournamentId?: string, tatami?: string, userId?: string, username?: string): Promise<TournamentPC> => {
      return await pcActions.registerPC(pcIdentifier, pcName, tournamentId, tatami, userId, username);
    },

    heartbeat: async (pcId: string, currentCategoryId?: string, currentMatchId?: string): Promise<{ is_admin_controlled: boolean } | void> => {
      return await pcActions.heartbeat(pcId, currentCategoryId, currentMatchId);
    },

    setAdminControlled: async (tournamentId: string, tatami: string, isControlled: boolean): Promise<void> => {
      return await pcActions.setAdminControlled(tournamentId, tatami, isControlled);
    },

    overrideLock: async (tournamentId: string, categoryId: string, operatorUsername: string): Promise<void> => {
      return await pcActions.overrideLock(tournamentId, categoryId, operatorUsername);
    },
    
    getPcs: async (tournamentId?: string): Promise<TournamentPC[]> => {
      return await pcActions.getPcs(tournamentId);
    }
  }
};

export const db = isDesktop ? new Proxy(dbOriginal, {
  get(target, prop, receiver) {
    if (prop in desktopOverrides) {
      // For any nested object like 'participants', 'clubs' we return a proxy that combines original with overrides
      return new Proxy(Reflect.get(target, prop, receiver), {
        get(nestedTarget, nestedProp, nestedReceiver) {
          if (desktopOverrides[prop as keyof typeof desktopOverrides][nestedProp]) {
            return desktopOverrides[prop as keyof typeof desktopOverrides][nestedProp];
          }
          return Reflect.get(nestedTarget, nestedProp, nestedReceiver);
        }
      });
    }
    return Reflect.get(target, prop, receiver);
  }
}) as typeof dbOriginal : dbOriginal;

const DEFAULT_PLAYLISTS: DisplayPlaylist[] = [
  {
    id: 'playlist-default-main',
    name: 'Main Stage Arena Presentation',
    description: 'Complete rotation of Live Scoreboards, Category Brackets, Medals Leaderboard, and Match Schedule.',
    tatami: 'ALL',
    is_active: true,
    slides: [
      { id: 's1', type: 'live_scoreboard', title: 'Live Kumite Scoreboard', duration_seconds: 25, tatami_filter: 'ALL' },
      { id: 's2', type: 'kata_scoreboard', title: 'WKF Kata Scoreboard', duration_seconds: 25, tatami_filter: 'ALL' },
      { id: 's3', type: 'bracket', title: 'Category Brackets & Draws', duration_seconds: 20 },
      { id: 's4', type: 'medals', title: 'Club Medal Standings Leaderboard', duration_seconds: 15 },
      { id: 's5', type: 'schedule', title: 'Upcoming Tatami Match Schedule', duration_seconds: 15 },
      { id: 's6', type: 'announcement', title: 'Official Championship Announcement', duration_seconds: 12, announcement_text: 'Welcome to KarateTech Open Championship 2026! Respect rules, honor opponents.' }
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  },
  {
    id: 'playlist-tatami-1',
    name: 'Tatami 1 Arena Dedicated Loop',
    description: 'Focused rotation for Ring 1 featuring live match scoreboard and Tatami 1 schedule.',
    tatami: 'Tatami 1',
    is_active: false,
    slides: [
      { id: 't1-s1', type: 'live_scoreboard', title: 'Tatami 1 Live Match', duration_seconds: 30, tatami_filter: 'Tatami 1' },
      { id: 't1-s2', type: 'schedule', title: 'Tatami 1 Upcoming Bouts', duration_seconds: 15, tatami_filter: 'Tatami 1' },
      { id: 't1-s3', type: 'medals', title: 'Medal Standings', duration_seconds: 15 }
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];
