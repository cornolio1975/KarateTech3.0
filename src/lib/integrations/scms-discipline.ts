/** Legacy senders omit these fields; new senders must supply a consistent selection. */
export function scmsDiscipline(p: Record<string, unknown>) {
  if (p.discipline === 'Non-Active' || (p.isKumite === false && p.isKata === false)) {
    throw new Error('Non-active athlete: transfer blocked. Select Kumite, Kata or Both before sending.');
  }
  if (p.discipline == null && p.isKumite == null && p.isKata == null) return null;
  if (!['Both', 'Kumite', 'Kata'].includes(String(p.discipline))) throw new Error('Invalid athlete discipline.');
  const flags = { isKumite: p.discipline === 'Both' || p.discipline === 'Kumite',
    isKata: p.discipline === 'Both' || p.discipline === 'Kata' };
  if (p.isKumite !== flags.isKumite || p.isKata !== flags.isKata) throw new Error('Athlete discipline does not match the selected events.');
  return flags;
}
