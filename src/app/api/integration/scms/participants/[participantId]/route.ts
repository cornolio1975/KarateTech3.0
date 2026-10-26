import { NextResponse } from 'next/server';
import { authorizeScms, receiverDb, receiverTournament, unavailable } from '@/lib/integrations/scms';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ participantId: string }> }) {
  const denied = authorizeScms(request);
  if (denied) return denied;
  try {
    const { participantId } = await context.params;
    const db = receiverDb();
    const { data: link, error } = await db.from('kt_scms_participant_links').select('karate_participant_id,last_synced_at').eq('scms_participant_id', participantId).eq('tournament_id', receiverTournament()).maybeSingle();
    if (error) return unavailable();
    if (!link) return NextResponse.json({ success: false, error: 'Participant not found.' }, { status: 404 });
    const { data: participant, error: pError } = await db.from('participants').select('id,full_name,dob,gender').eq('id', link.karate_participant_id).is('deleted_at', null).maybeSingle();
    if (pError) return unavailable();
    if (!participant) return NextResponse.json({ success: false, error: 'Participant not found.' }, { status: 404 });
    return NextResponse.json({ success: true, karate_participant: participant, sync_info: { status: 'synced', last_synced_at: link.last_synced_at } });
  } catch { return unavailable(); }
}
