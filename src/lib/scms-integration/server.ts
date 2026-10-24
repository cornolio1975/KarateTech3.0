import {createClient} from '@supabase/supabase-js';
import {createHash,timingSafeEqual} from 'node:crypto';
export class IntegrationError extends Error {constructor(public status:number,message:string){super(message)}}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function memberId(v:unknown){if(typeof v!=='string'||!uuid.test(v))throw new IntegrationError(400,'A valid SCMS member UUID is required');return v;}
export function authorize(req:Request){
 const key=process.env.SCMS_INTEGRATION_KEY;
 if(!key || key.length<32)throw new IntegrationError(503,'SCMS integration is not configured');
 const supplied=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 if(!timingSafeEqual(createHash('sha256').update(key).digest(),createHash('sha256').update(supplied).digest()))throw new IntegrationError(401,'Unauthorized');
}
export function integrationDb(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw new IntegrationError(503,'SCMS database connection is not configured');
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export function result(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}})}
export function failure(e:unknown){return result({success:false,error:e instanceof IntegrationError?e.message:'SCMS integration is unavailable'},e instanceof IntegrationError?e.status:503)}
export async function rpc(name:string,args:Record<string,unknown>){
 const {data,error}=await integrationDb().rpc(name,args);
 if(error){
  if(error.code==='23505'||error.code==='P0002')throw new IntegrationError(409,'Participant identity or club mapping needs reconciliation');
  if(error.code==='22023'||error.code==='22007'||error.code==='23502'||error.code==='23503'||error.code==='23514')throw new IntegrationError(422,'Correct the required athlete fields or country code before syncing');
  throw new IntegrationError(503,'SCMS database integration is not ready');
 }
 return data;
}
export async function readPayload(req:Request){
 if(!req.headers.get('content-type')?.includes('application/json'))throw new IntegrationError(415,'JSON required');
 if(Number(req.headers.get('content-length'))>16000)throw new IntegrationError(413,'Request too large');
 const raw=await req.text();if(Buffer.byteLength(raw)>16000)throw new IntegrationError(413,'Request too large');
 let p;try{p=JSON.parse(raw)}catch{throw new IntegrationError(400,'Invalid JSON')}
 if(!p||typeof p!=='object'||Array.isArray(p)||p.contract_version!==1)throw new IntegrationError(400,'Athlete contract v1 required');
 if(typeof p.source_revision!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(p.source_revision)||!Number.isFinite(Date.parse(p.source_revision)))throw new IntegrationError(422,'Source revision required');
 memberId(p.scms_member_id);memberId(p.scms_club_id);if(p.scms_branch_id!==null)memberId(p.scms_branch_id);
 for(const k of ['participant_name','club_name','gender','date_of_birth'])if(typeof p[k]!=='string'||!p[k].trim()||p[k].length>200)throw new IntegrationError(422,'Required athlete identity missing');
 if(!['Male','Female'].includes(p.gender)||!/^\d{4}-\d{2}-\d{2}$/.test(p.date_of_birth))throw new IntegrationError(422,'Correct gender and date of birth');
 if(!Number.isFinite(Date.parse(p.date_of_birth)) || new Date(p.date_of_birth).toISOString().slice(0,10)!==p.date_of_birth || p.date_of_birth>new Date().toISOString().slice(0,10))throw new IntegrationError(422,'Correct date of birth');
 for(const [k,max] of Object.entries({member_no:80,email:150,phone:30,passport_ic:50,nationality_code:3,belt_rank:100,emergency_contact_name:150,emergency_contact_phone:30}))
  if(p[k]!==null && (typeof p[k]!=='string'||p[k].length>max))throw new IntegrationError(422,'Invalid '+k);
 for(const k of ['weight','height'])if(p[k]!==null && (typeof p[k]!=='number'||!Number.isFinite(p[k])||p[k]<=0||p[k]>999.99))throw new IntegrationError(422,'Invalid '+k);
 return p;
}
