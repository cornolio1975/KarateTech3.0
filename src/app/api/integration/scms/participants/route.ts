import {authorize,readPayload,rpc,result,failure,IntegrationError} from '@/lib/scms-integration/server';
export const dynamic='force-dynamic';export const runtime='nodejs';
export async function POST(req:Request){try{authorize(req);const p=await readPayload(req);const key=req.headers.get('idempotency-key');if(!key||!/^SCMS-[a-f0-9]{64}$/.test(key))throw new IntegrationError(400,'A valid idempotency key is required');const d=await rpc('scms_athlete_upsert',{p_payload:p,p_key:key});return result({success:true,...d});}catch(e){return failure(e)}}
