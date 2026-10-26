import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export function authorizeScms(request: Request): NextResponse | null {
  const expected = process.env.SCMS_API_KEY?.trim();
  if (!expected) return NextResponse.json({ success: false, error: 'SCMS receiver is not configured.' }, { status: 503 });
  const supplied = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] || '';
  const hash = (s: string) => createHash('sha256').update(s).digest();
  if (!supplied || !timingSafeEqual(hash(expected), hash(supplied))) {
    return NextResponse.json({ success: false, error: 'Invalid integration credentials.' }, { status: 401 });
  }
  return null;
}

export function receiverDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Receiver database is not configured.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function validateParticipant(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'A participant object is required.';
  const p = value as Record<string, unknown>;
  const limits: Record<string, number> = { scms_participant_id: 150, full_name: 200, passport_ic: 50, club_name: 150, email: 150, phone: 30, emergency_contact_name: 150, emergency_contact_phone: 30, scms_club_id: 150, club_id: 150 };
  for (const [field, limit] of Object.entries(limits)) {
    if (p[field] != null && (typeof p[field] !== 'string' || String(p[field]).length > limit)) return `Invalid ${field} (maximum ${limit} characters).`;
  }
  if (!String(p.scms_participant_id || '').trim() || !String(p.full_name || '').trim()) return 'SCMS participant ID and full name are required.';
  if (!['Male', 'Female'].includes(String(p.gender))) return 'Gender must be Male or Female.';
  const dob = String(p.dob || '');
  const parsed = new Date(`${dob}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dob || parsed > new Date()) return 'A valid date of birth is required.';
  if (!String(p.passport_ic || '').trim() || ['N/A', 'NA'].includes(String(p.passport_ic).trim().toUpperCase())) return 'A real IC or passport number is required.';
  for (const field of ['weight', 'height']) {
    if (typeof p[field] !== 'number' || !Number.isFinite(p[field]) || Number(p[field]) <= 0 || Number(p[field]) >= 1000) return `A valid ${field} greater than zero is required.`;
  }
  if (p.nationality_code != null && !/^[A-Z]{3}$/.test(String(p.nationality_code))) return 'Nationality must be a three-letter country code.';
  return null;
}

export function receiverTournament() {
  const id = process.env.SCMS_TOURNAMENT_ID || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('SCMS_TOURNAMENT_ID is not configured.');
  return id;
}

export async function receiveParticipant(p: Record<string, unknown>) {
  const invalid = validateParticipant(p);
  if (invalid) return { success: false, status: 'INVALID', scms_participant_id: p?.scms_participant_id, error: invalid };
  const { data, error } = await receiverDb().rpc('kt_receive_scms_participant', { payload: p, target_tournament: receiverTournament() });
  if (error) {
    console.error('SCMS receiver database operation failed:', error.code);
    return { success: false, status: 'ERROR', scms_participant_id: p.scms_participant_id, error: 'Transfer could not be saved. Verify the receiver database migration and configuration.' };
  }
  return data;
}

export function unavailable() {
  return NextResponse.json({ success: false, error: 'SCMS receiver is unavailable. Check server configuration and database migration.' }, { status: 503 });
}
