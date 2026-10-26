import { NextResponse } from 'next/server';
import { authorizeScms, receiveParticipant, unavailable } from '@/lib/integrations/scms';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const denied = authorizeScms(request);
  if (denied) return denied;
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON.' }, { status: 400 }); }
  if (!Array.isArray(body?.participants) || !body.participants.length || body.participants.length > 100) return NextResponse.json({ success: false, error: 'Send between 1 and 100 participants.' }, { status: 400 });
  try {
    const results = [];
    for (const p of body.participants) results.push(await receiveParticipant(p));
    return NextResponse.json({ success: true, total: results.length, created: results.filter(r => r.status === 'CREATED').length, updated: results.filter(r => r.status === 'UPDATED').length, failed: results.filter(r => !r.success).length, results });
  } catch { return unavailable(); }
}
