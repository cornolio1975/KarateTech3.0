import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const db = new PGlite();
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: async (_name: string, args: any) => {
  try { const result = await db.query<{ result: any }>('select kt_receive_scms_participant($1::jsonb,$2::uuid) as result',[JSON.stringify(args.payload),args.target_tournament]); return { data: result.rows[0].result, error:null }; }
  catch { return { data:null, error:{code:'TEST_CONSTRAINT'} }; }
} }) }));
import { POST } from '@/app/api/integration/scms/participants/route';
const tournament = '11111111-1111-4111-8111-111111111111';
const p = { scms_participant_id:'athlete-1', full_name:'Test Athlete', gender:'Female', dob:'2004-02-29', passport_ic:'TEST-001', weight:55, height:165, scms_club_id:'club-1', club_name:'Test Club' };
async function receive(payload: Record<string, unknown>, target = tournament) {
  const result = await db.query<{ result: any }>('select kt_receive_scms_participant($1::jsonb,$2::uuid) as result',[JSON.stringify(payload),target]);
  return result.rows[0].result;
}
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;`);
  // Use the repository's production schema; UUID generation is built into Postgres.
  const schema = (await readFile('supabase_schema.sql','utf8')).replace('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";','');
  await db.exec(schema);
  await db.exec('ALTER TABLE participants ADD COLUMN tournament_id uuid REFERENCES tournaments(id);');
  await db.query("INSERT INTO tournaments(id,name,organizer,date,date_iso,venue,city,registration_close,registration_close_iso) VALUES($1,'Test','Test','2027-01-01','2027-01-01','Test','Test','2026-12-31','2026-12-31')",[tournament]);
  await db.exec(await readFile('supabase/migrations/20261027090000_scms_receiver.sql','utf8'));
}, 30000);
afterAll(async () => { vi.unstubAllEnvs(); await db.close(); });
it('creates and retries without duplicate identities; preserves competition state', async () => {
  const first = await receive(p); expect(first.success).toBe(true); expect(first.status).toBe('CREATED');
  await db.query("update participants set status='Checked In', payment_status='Paid', remarks='Competition-owned note' where id=$1",[first.karate_participant_id]);
  const second = await receive({ ...p, weight:56 }); expect(second.karate_participant_id).toBe(first.karate_participant_id); expect(second.status).toBe('UPDATED');
  const rows = await db.query<any>('select * from participants where id=$1',[first.karate_participant_id]); expect(rows.rows[0].weight).toBe('56.00'); expect(rows.rows[0].status).toBe('Checked In'); expect(rows.rows[0].payment_status).toBe('Paid'); expect(rows.rows[0].remarks).toBe('Competition-owned note');
});
it('blocks duplicate identity under a different source ID', async () => {
  const result = await receive({ ...p, scms_participant_id:'athlete-duplicate' }); expect(result.status).toBe('SUSPECTED_DUPLICATE'); expect(result.success).toBe(false);
});
it('rolls back participant and identity link if a constraint fails', async () => {
  await expect(receive({ ...p, scms_participant_id:'rollback', passport_ic:'TEST-OTHER', full_name:'Different Athlete', nationality_code:'ZZZ' })).rejects.toThrow();
  const rows = await db.query('select * from kt_scms_participant_links where scms_participant_id=$1',['rollback']); expect(rows.rows).toHaveLength(0);
});
it('rejects an unconfigured or nonexistent destination tournament', async () => {
  await expect(receive(p,'99999999-9999-4999-8999-999999999999')).rejects.toThrow();
});
it('exposes neither mappings nor the write function to public database roles', async () => {
  const r = await db.query<any>("select has_function_privilege('anon','kt_receive_scms_participant(jsonb,uuid)','EXECUTE') as anon,has_function_privilege('authenticated','kt_receive_scms_participant(jsonb,uuid)','EXECUTE') as authenticated"); expect(r.rows[0]).toEqual({anon:false,authenticated:false});
});

it('serves the authenticated SCMS HTTP contract with confirmed IDs and per-athlete conflicts', async () => {
  vi.stubEnv('SCMS_API_KEY','test-secret'); vi.stubEnv('SCMS_TOURNAMENT_ID',tournament);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://test.example'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-key');
  const request = (body: unknown, key = 'test-secret') => new Request('https://receiver.example/api/integration/scms/participants',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  expect((await POST(request(p,'wrong'))).status).toBe(401);
  expect((await POST(request({...p,passport_ic:''}))).status).toBe(422);
  const created = await POST(request({...p,scms_participant_id:'http-1',full_name:'HTTP Athlete',passport_ic:'HTTP-001'}));
  expect(created.status).toBe(200); const confirmed = await created.json(); expect(confirmed.success).toBe(true); expect(confirmed.karate_participant_id).toMatch(/^[0-9a-f-]{36}$/);
  const retried = await POST(request({...p,scms_participant_id:'http-1',full_name:'HTTP Athlete',passport_ic:'HTTP-001'})); expect((await retried.json()).karate_participant_id).toBe(confirmed.karate_participant_id);
  expect((await POST(request({...p,scms_participant_id:'http-duplicate',full_name:'HTTP Athlete',passport_ic:'HTTP-001'}))).status).toBe(409);
});
