import {authorize,memberId,rpc,result,failure} from '@/lib/scms-integration/server';
export const dynamic='force-dynamic';export const runtime='nodejs';
export async function GET(req:Request){try{authorize(req);const p=await rpc('scms_athlete_lookup',{p_member:memberId(new URL(req.url).searchParams.get('scms_member_id'))});return result({success:true,data:p||{exists:false}});}catch(e){return failure(e)}}
