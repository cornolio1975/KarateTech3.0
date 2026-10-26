import { NextResponse } from 'next/server';
import { authorizeScms, receiveParticipant, unavailable } from '@/lib/integrations/scms';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const denied = authorizeScms(request);
  if (denied) return denied;
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON.' }, { status: 400 }); }
  try {
    const result = await receiveParticipant(body);
    return NextResponse.json(result, { status: result.success ? 200 : result.status === 'SUSPECTED_DUPLICATE' ? 409 : result.status === 'INVALID' ? 422 : 503 });
  } catch { return unavailable(); }
}
