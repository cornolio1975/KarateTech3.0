import { GET as getParticipant } from '../participants/[participantId]/route';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const participantId = new URL(request.url).searchParams.get('scms_participant_id') || '';
  return getParticipant(request, { params: Promise.resolve({ participantId }) });
}
