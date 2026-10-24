import { integrationDb, memberId, IntegrationError, failure, result, rpc } from '@/lib/scms-integration/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  try {
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin) throw new IntegrationError(403, 'Cross-origin request rejected');
    const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new IntegrationError(401, 'Sign in to update SCMS');
    const {data: {user}, error} = await integrationDb().auth.getUser(token);
    if (error || !user) throw new IntegrationError(401, 'Sign in again to update SCMS');
    // Explicit server-managed allowlist; browser roles and editable user metadata grant no access.
    const allowed = (process.env.SCMS_SYNC_ADMIN_USER_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
    if (!allowed.includes(user.id)) throw new IntegrationError(403, 'SCMS sync administrator access required');
    if (!req.headers.get('content-type')?.includes('application/json')) throw new IntegrationError(415, 'JSON required');
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 4000) throw new IntegrationError(413, 'Request too large');
    let body; try {body = JSON.parse(raw);} catch {throw new IntegrationError(400, 'Invalid JSON');}
    const id = memberId(body?.participantId);
    if (!['preview', 'confirm'].includes(body.action)) throw new IntegrationError(400, 'Preview or confirm required');
    const {data: source, error: sourceError} = await integrationDb().from('scms_athlete_sources').select('scms_member_id').eq('karate_participant_id', id).maybeSingle();
    if (sourceError) throw new IntegrationError(503, 'SCMS mapping is unavailable');
    if (!source) throw new IntegrationError(409, 'This participant is not linked to an SCMS athlete');
    const remote = await rpc('scms_athlete_lookup', {p_member: source.scms_member_id});
    if (!remote?.exists || remote.karatetech_participant_id !== id) throw new IntegrationError(409, 'Linked participant unavailable');
    const endpoint = process.env.SCMS_API_URL, key = process.env.SCMS_RETURN_SYNC_KEY;
    if (!endpoint || !key || key.length < 32) throw new IntegrationError(503, 'SCMS return connection is not configured');
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new IntegrationError(503, 'A secure SCMS URL is required');
    const response = await fetch(new URL('/api/integration/karatetech/return-sync', url), {
      method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${key}`},
      body: JSON.stringify({actor: user.id, remote, action: body.action, confirmation: body.confirmation}),
      signal: AbortSignal.timeout(15000), cache: 'no-store', redirect: 'error',
    });
    const data = await response.json();
    return result(data, response.status);
  } catch (error) {return failure(error);}
}
