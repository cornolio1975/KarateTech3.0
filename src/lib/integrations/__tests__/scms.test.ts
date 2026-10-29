import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizeScms, validateParticipant } from '../scms';
const athlete = { scms_participant_id: 'member-1', full_name: 'Test Athlete', gender: 'Female', dob: '2004-02-29', passport_ic: 'P1234567', weight: 55, height: 165 };
afterEach(() => vi.unstubAllEnvs());
describe('SCMS receiver input and authorization', () => {
  it('accepts genuine valid fields', () => expect(validateParticipant(athlete)).toBeNull());
  it.each([null, [], {}, { ...athlete, dob: '2003-02-29' }, { ...athlete, weight: Infinity }, { ...athlete, height: 0 }, { ...athlete, passport_ic: 'N/A' }, { ...athlete, full_name: '' }, { ...athlete, gender: 'Unknown' }, { ...athlete, dob: '2999-01-01' }])('rejects invalid or fabricated data %j', value => expect(validateParticipant(value)).toBeTruthy());
  it('fails closed without receiver key', () => { vi.stubEnv('SCMS_API_KEY',''); expect(authorizeScms(new Request('https://example.test'))?.status).toBe(503); });
  it('rejects missing or incorrect credentials', () => { vi.stubEnv('SCMS_API_KEY','test-secret'); expect(authorizeScms(new Request('https://example.test'))?.status).toBe(401); expect(authorizeScms(new Request('https://example.test',{headers:{Authorization:'Bearer wrong'}}))?.status).toBe(401); });
  it('accepts matching integration credentials', () => { vi.stubEnv('SCMS_API_KEY','test-secret'); expect(authorizeScms(new Request('https://example.test',{headers:{Authorization:'Bearer test-secret'}}))).toBeNull(); });
});

it.each([
  {discipline:'Both',isKumite:true,isKata:true},
  {discipline:'Kumite',isKumite:true,isKata:false},
  {discipline:'Kata',isKumite:false,isKata:true},
])('accepts consistent event flags %j', flags=>expect(validateParticipant({...athlete,...flags})).toBeNull());
it.each([
  {discipline:'Non-Active',isKumite:false,isKata:false},
  {discipline:'Kata',isKumite:true,isKata:false},
  {discipline:'Both',isKumite:'true',isKata:true},
])('rejects inactive or inconsistent flags %j',flags=>expect(validateParticipant({...athlete,...flags})).toBeTruthy());
