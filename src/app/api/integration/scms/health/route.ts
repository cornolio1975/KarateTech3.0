import { NextResponse } from 'next/server';
import { authorizeScms, receiverDb, receiverTournament, unavailable } from '@/lib/integrations/scms';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const denied = authorizeScms(request);
  if (denied) return denied;
  try {
    const tournament = receiverTournament();
    const { data: target, error: targetError } = await receiverDb().from('tournaments').select('id').eq('id', tournament).is('deleted_at', null).maybeSingle();
    if (targetError || !target) return unavailable();
    const { error } = await receiverDb().from('kt_scms_participant_links').select('scms_participant_id').limit(1);
    if (error) return unavailable();
    return NextResponse.json({ success: true, status: 'healthy', service: 'KarateTech SCMS receiver' });
  } catch { return unavailable(); }
}
