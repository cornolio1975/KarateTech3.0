'use client';

import React from 'react';
import { useTournament } from '@/context/TournamentContext';
import { ParticipantsContent } from '@/app/participants/Content';

export default function ClubParticipantsPage() {
  const { clubId } = useTournament();

  if (!clubId) return null;

  return (
    <div className="w-full h-full">
      <ParticipantsContent isClubMode={true} clubId={clubId} />
    </div>
  );
}
