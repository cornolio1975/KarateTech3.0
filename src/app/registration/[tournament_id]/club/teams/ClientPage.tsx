'use client';

import React from 'react';
import { useTournament } from '@/context/TournamentContext';
import { TeamsContent } from '@/components/TeamsWorkspace';

export default function ClubTeamsPage() {
  const { clubId } = useTournament();

  if (!clubId) return null;

  return (
    <div className="w-full h-full">
      <TeamsContent isClubMode={true} clubId={clubId} />
    </div>
  );
}
