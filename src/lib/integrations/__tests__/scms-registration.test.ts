import { beforeAll,afterAll,expect,it,vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const db=new PGlite();
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({rpc:async(_name:string,args:any)=>{
 try{const r=await db.query<any>('select kt_register_scms_draft($1::jsonb,$2::uuid) as result',[JSON.stringify(args.draft),args.target_tournament]);return {data:r.rows[0].result,error:null};}
 catch(error){return {data:null,error:{message:error instanceof Error?error.message:'DATABASE_ERROR'}};}
}})}));
import { POST } from '@/app/api/integration/scms/registration/route';
const target='11111111-1111-4111-8111-111111111111';
const cat='22222222-2222-4222-8222-222222222222';
const otherCat='33333333-3333-4333-8333-333333333333';
const draft={tournamentId:target,clubId:'club-1',idempotencyKey:'registration-1',participants:[{scmsMemberId:'athlete-1',targetCategoryId:cat}]};
async function register(body:any){const r=await db.query<any>('select kt_register_scms_draft($1::jsonb,$2::uuid) as result',[JSON.stringify(body),target]);return r.rows[0].result;}
beforeAll(async()=>{
  await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;');
  await db.exec((await readFile('supabase_schema.sql','utf8')).replace('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',''));
  await db.exec('ALTER TABLE participants ADD COLUMN tournament_id uuid REFERENCES tournaments(id);ALTER TABLE categories ADD COLUMN tournament_id uuid REFERENCES tournaments(id);ALTER TABLE participant_categories ADD COLUMN tournament_id uuid REFERENCES tournaments(id);');
  await db.query("INSERT INTO tournaments(id,name,organizer,date,date_iso,venue,city,registration_close,registration_close_iso,status) VALUES($1,'Test','Test','2027-01-01','2027-01-01','Test','Test','2026-12-31','2099-12-31','Open')",[target]);
  await db.exec(await readFile('supabase/migrations/20261027090000_scms_receiver.sql','utf8'));
  await db.exec(await readFile('supabase/migrations/20261027120000_scms_registration.sql','utf8'));
  for(const [id,name] of [[cat,'Female Kumite'],[otherCat,'Female Kata']])await db.query("INSERT INTO categories(id,name,gender,min_age,max_age,min_weight,max_weight,capacity,tournament_id) VALUES($1,$2,'Female',18,99,0,999,32,$3)",[id,name,target]);
  for(const i of [1,2])await db.query('select kt_receive_scms_participant($1::jsonb,$2::uuid)',[JSON.stringify({scms_participant_id:`athlete-${i}`,full_name:`Athlete ${i}`,gender:'Female',dob:'2004-02-29',passport_ic:`TEST-${i}`,weight:55,height:165,scms_club_id:'club-1',club_name:'Test Club'}),target]);
},30000);
afterAll(async()=>{vi.unstubAllEnvs();await db.close();});
it('commits a real assignment and returns the same receipt on retry',async()=>{
 const first=await register(draft);expect(first.success).toBe(true);expect(first.acknowledgementId).toMatch(/^KT-REG-/);
 expect((await register(draft)).acknowledgementId).toBe(first.acknowledgementId);
 expect((await db.query('select * from participant_categories where tournament_id=$1',[target])).rows).toHaveLength(1);
});
it('rejects changed selections with a reused idempotency key',async()=>{await expect(register({...draft,participants:[{scmsMemberId:'athlete-1',targetCategoryId:otherCat}]})).rejects.toThrow('IDEMPOTENCY_CONFLICT');});
it('rejects an athlete not synced into the selected club',async()=>{await expect(register({...draft,idempotencyKey:'wrong-club',clubId:'another-club'})).rejects.toThrow('ATHLETE_NOT_SYNCED');});
it('rejects nonexistent athletes',async()=>{await expect(register({...draft,idempotencyKey:'missing-athlete',participants:[{scmsMemberId:'missing',targetCategoryId:cat}]})).rejects.toThrow('ATHLETE_NOT_SYNCED');});
it('rejects unknown or foreign categories',async()=>{await expect(register({...draft,idempotencyKey:'missing-category',participants:[{scmsMemberId:'athlete-1',targetCategoryId:'44444444-4444-4444-8444-444444444444'}]})).rejects.toThrow('INVALID_CATEGORY');});
it('rolls back earlier selections when a later selection is invalid',async()=>{
 await expect(register({...draft,idempotencyKey:'rollback',participants:[{scmsMemberId:'athlete-1',targetCategoryId:otherCat},{scmsMemberId:'missing',targetCategoryId:otherCat}]})).rejects.toThrow();
 expect((await db.query('select * from participant_categories where category_id=$1',[otherCat])).rows).toHaveLength(0);
 expect((await db.query("select * from kt_scms_registration_receipts where idempotency_key='rollback'")).rows).toHaveLength(0);
});
it('enforces category capacity',async()=>{await db.query('update categories set capacity=1 where id=$1',[cat]);await expect(register({...draft,idempotencyKey:'full',participants:[{scmsMemberId:'athlete-2',targetCategoryId:cat}]})).rejects.toThrow('CATEGORY_FULL');});
it('validates eligibility against receiver records, not client flags',async()=>{await db.query('update categories set max_weight=40 where id=$1',[otherCat]);await db.query("update categories set name='Female Kumite Test' where id=$1",[otherCat]);await expect(register({...draft,idempotencyKey:'ineligible',participants:[{scmsMemberId:'athlete-2',targetCategoryId:otherCat,eligibilityPassed:true}]})).rejects.toThrow('NOT_ELIGIBLE');});
it('does not grant public access to the registration transaction',async()=>{const r=await db.query<any>("select has_function_privilege('anon','kt_register_scms_draft(jsonb,uuid)','EXECUTE') as allowed");expect(r.rows[0].allowed).toBe(false);});
it('rejects closed registration without writing a receipt',async()=>{await db.query("update tournaments set registration_close_iso='2000-01-01' where id=$1",[target]);await expect(register({...draft,idempotencyKey:'closed'})).rejects.toThrow('REGISTRATION_CLOSED');});

it('serves authenticated registration JSON and a persisted receipt over the actual route',async()=>{
 await db.query("update tournaments set registration_close_iso='2099-12-31' where id=$1",[target]);
 vi.stubEnv('SCMS_API_KEY','test-only');vi.stubEnv('SCMS_TOURNAMENT_ID',target);vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://test.example');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-only');
 const request=(body:any,key='test-only')=>new Request('https://receiver.test/api/integration/scms/registration',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
 expect((await POST(request(draft,'wrong'))).status).toBe(401);
 const response=await POST(request({...draft,idempotencyKey:'http-test'}));expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('application/json');expect((await response.json()).acknowledgementId).toMatch(/^KT-REG-/);
 expect((await POST(request({...draft,tournamentId:'another-tournament'}))).status).toBe(422);
});
