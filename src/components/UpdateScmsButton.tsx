'use client';
import { useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
type Change = {field: string; before: unknown; after: unknown};
const labels: Record<string, string> = {participant_name:'Name',gender:'Gender',date_of_birth:'Date of birth',passport_ic:'IC / passport',nationality_code:'Nationality',weight:'Weight (kg)',height:'Height (cm)',email:'Email',phone:'Phone',emergency_contact_name:'Emergency contact',emergency_contact_phone:'Emergency phone'};
const value = (v: unknown) => v === null || v === '' ? 'Empty' : String(v);
export default function UpdateScmsButton({participantId, name}: {participantId: string; name: string}) {
 const [busy, setBusy] = useState(false), [review, setReview] = useState<{changes: Change[]; confirmation: string} | null>(null);
 const [error, setError] = useState(''), [message, setMessage] = useState('');
 const lock = useRef(false);
 async function request(action: 'preview' | 'confirm') {
  if (lock.current) return;
  lock.current = true; setBusy(true); setError(''); setMessage('');
  try {
   const {data: {session}} = await createClient().auth.getSession();
   if (!session) throw Error('Sign in to update SCMS. Local demo access cannot publish athlete changes.');
   const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/integration/scms/publish/`, {method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`}, body:JSON.stringify({participantId, action, confirmation: action === 'confirm' ? review?.confirmation : undefined})});
   const data = await response.json();
   if (!response.ok || !data.success) throw Error(data.error || 'SCMS update was not confirmed');
   if (action === 'preview') {
    if (!data.changes.length) {setReview(null); setMessage('SCMS already matches.');}
    else setReview({changes: data.changes, confirmation: data.confirmation});
   } else {setReview(null); setMessage('SCMS updated successfully.');}
  } catch (e) {setError(e instanceof Error ? e.message : 'Unable to update SCMS'); if (action === 'confirm') setReview(null);}
  finally {lock.current = false; setBusy(false);}
 }
 return <>
  <button type="button" disabled={busy} onClick={(e) => {e.stopPropagation(); void request('preview');}} className="px-2 py-1 border border-border rounded-md text-[10px] font-semibold hover:bg-secondary disabled:opacity-50 whitespace-nowrap">{busy ? 'Checking…' : 'Update SCMS'}</button>
  {message && <span role="status" className="text-[10px] text-green-700">{message}</span>}
  {error && <span role="alert" className="text-[10px] text-red-600 max-w-56 whitespace-normal">{error}</span>}
  {review && <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={e => e.stopPropagation()}>
   <section role="dialog" aria-modal="true" aria-labelledby={`scms-title-${participantId}`} className="bg-card text-foreground border border-border rounded-xl shadow-xl w-full max-w-xl max-h-[85vh] overflow-auto p-5 whitespace-normal">
    <h2 id={`scms-title-${participantId}`} className="font-bold text-lg">Confirm SCMS update</h2>
    <p className="text-sm my-3">Update the linked SCMS athlete for <strong>{name}</strong> with these saved KarateTech details?</p>
    <table className="w-full text-xs text-left"><thead><tr><th className="p-2">Field</th><th className="p-2">Current SCMS</th><th className="p-2">New value</th></tr></thead><tbody>{review.changes.map(c => <tr key={c.field} className="border-t border-border"><th className="p-2">{labels[c.field] || c.field}</th><td className="p-2 break-words">{value(c.before)}</td><td className="p-2 break-words">{value(c.after)}</td></tr>)}</tbody></table>
    <div className="flex justify-end gap-3 mt-5"><button type="button" disabled={busy} onClick={() => setReview(null)} className="px-4 py-2 border border-border rounded-lg">Cancel</button><button type="button" disabled={busy} onClick={() => void request('confirm')} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-50">{busy ? 'Updating…' : 'Confirm update'}</button></div>
   </section>
  </div>}
 </>;
}
