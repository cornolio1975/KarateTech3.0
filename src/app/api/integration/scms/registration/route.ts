import { NextResponse } from 'next/server';
import { authorizeScms, receiverDb, receiverTournament, unavailable } from '@/lib/integrations/scms';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const errors: Record<string,string> = {
  INVALID_DRAFT: 'A club, idempotency key, and between 1 and 100 unique athlete/category selections are required.',
  WRONG_TOURNAMENT: 'This receiver is configured for a different tournament.',
  REGISTRATION_CLOSED: 'Tournament registration is closed or the tournament is unavailable.',
  ATHLETE_NOT_SYNCED: 'Sync every selected athlete to this tournament and club before registering.',
  INVALID_CATEGORY: 'A category is unavailable or does not belong to this tournament. Refresh categories.',
  NOT_ELIGIBLE: 'An athlete does not meet the selected category’s age, gender, or weight requirements.',
  CATEGORY_FULL: 'A selected category has reached capacity.',
  IDEMPOTENCY_CONFLICT: 'This submission key was already used with different selections. Start a new draft.',
};
export async function POST(request: Request) {
  const denied=authorizeScms(request); if(denied)return denied;
  let draft;
  try { draft=await request.json(); } catch { return NextResponse.json({success:false,error:'Invalid JSON.'},{status:400}); }
  if(!draft || !Array.isArray(draft.participants) || !draft.participants.length || draft.participants.length>100 || typeof draft.clubId!=='string' || !draft.clubId.trim() || draft.clubId.length>150 || typeof draft.idempotencyKey!=='string' || !draft.idempotencyKey.trim() || draft.idempotencyKey.length>150) return NextResponse.json({success:false,error:errors.INVALID_DRAFT},{status:422});
  try {
    const target=receiverTournament();
    if(draft.tournamentId!==target)return NextResponse.json({success:false,error:errors.WRONG_TOURNAMENT},{status:422});
    const {data,error}=await receiverDb().rpc('kt_register_scms_draft',{draft,target_tournament:target});
    if(error){const known=errors[error.message];if(known)return NextResponse.json({success:false,error:known},{status:error.message==='IDEMPOTENCY_CONFLICT'?409:422});return unavailable();}
    if(!data?.success || typeof data.acknowledgementId!=='string')return unavailable();
    return NextResponse.json(data);
  }catch{return unavailable();}
}
