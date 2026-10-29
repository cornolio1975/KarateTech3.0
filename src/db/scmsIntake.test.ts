import { describe, expect, it, vi } from 'vitest';
import { refreshScmsIntake } from './scmsIntake';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TournamentDatabase } from './types';

const id = '11111111-1111-4111-8111-111111111111';
function fixture(rows: object[], error: object | null = null) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(), is: vi.fn().mockResolvedValue({ data: rows, error }) };
  const client = { from: vi.fn().mockReturnValue(query) };
  const snapshot = { tournament: { id }, participants: [], bouts: [{ id: 'protected' }],
    participant_categories: [{ id: 'manual' }] } as unknown as TournamentDatabase;
  return { snapshot, query, client: client as unknown as SupabaseClient };
}
const athlete = { id: 'mock', tournament_id: id, registration_no: 'SCMS-test', status: 'Pending' };

describe('SCMS intake into opened tournament snapshots', () => {
  it('makes normalized intake visible and remains idempotent without touching competition data', async () => {
    const { snapshot, client, query } = fixture([athlete]);
    const bouts = snapshot.bouts;
    const mappings = snapshot.participant_categories;
    expect(await refreshScmsIntake(snapshot, client)).toBe(1);
    expect(await refreshScmsIntake(snapshot, client)).toBe(0);
    expect(snapshot.participants).toEqual([athlete]);
    expect(query.eq).toHaveBeenCalledWith('tournament_id', id);
    expect(snapshot.bouts).toBe(bouts);
    expect(snapshot.participant_categories).toBe(mappings);
  });
  it('never imports another tournament, deleted rows or unrelated cloud athletes', async () => {
    const { snapshot, client } = fixture([{ ...athlete, tournament_id: 'other' },
      { ...athlete, deleted_at: '2026-10-30' }, { ...athlete, registration_no: 'REG-test' }]);
    expect(await refreshScmsIntake(snapshot, client)).toBe(0);
  });
  it('preserves local edits and local tombstones', async () => {
    const { snapshot, client } = fixture([athlete]);
    const local = { ...athlete, status: 'Confirmed', deleted_at: '2026-10-30' };
    snapshot.participants = [local] as unknown as TournamentDatabase['participants'];
    expect(await refreshScmsIntake(snapshot, client)).toBe(0);
    expect(snapshot.participants).toEqual([local]);
  });
  it('reports access failures and preserves the snapshot', async () => {
    const { snapshot, client } = fixture([], { message: 'permission denied' });
    await expect(refreshScmsIntake(snapshot, client)).rejects.toThrow('permission denied');
    expect(snapshot.participants).toEqual([]);
  });
});

it('refreshes only discipline flags on an existing received athlete', async () => {
  const { snapshot, client } = fixture([{...athlete,isKumite:false,isKata:true}]);
  const local={...athlete,isKumite:true,isKata:true,status:'Checked In',remarks:'Keep me'};
  snapshot.participants=[local] as unknown as TournamentDatabase['participants'];
  expect(await refreshScmsIntake(snapshot,client)).toBe(1);
  expect(local).toMatchObject({isKumite:false,isKata:true,status:'Checked In',remarks:'Keep me'});
  expect(await refreshScmsIntake(snapshot,client)).toBe(0);
});

it('refreshes latest SCMS details on the same athlete without changing competition state', async () => {
  const { snapshot, client } = fixture([{...athlete, full_name:'Latest Name', passport_ic:'010203-04-5678',
    dob:'2001-02-03', weight:62, height:172, phone:'0123456789', email:null, isKumite:true,isKata:false}]);
  const local={...athlete, full_name:'Old Name', weight:55, email:'old@example.test',
    status:'Checked In', payment_status:'Paid', medical_status:'Cleared', remarks:'Keep me'};
  snapshot.participants=[local] as unknown as TournamentDatabase['participants'];
  const categories=snapshot.participant_categories;
  expect(await refreshScmsIntake(snapshot,client)).toBe(1);
  expect(snapshot.participants).toHaveLength(1);
  expect(local).toMatchObject({full_name:'Latest Name',weight:62,height:172,email:null,
    isKumite:true,isKata:false,status:'Checked In',payment_status:'Paid',medical_status:'Cleared',remarks:'Keep me'});
  expect(snapshot.participant_categories).toBe(categories);
  expect(await refreshScmsIntake(snapshot,client)).toBe(0);
});
