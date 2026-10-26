'use client';

import React from 'react';
import { useTournament } from '@/context/TournamentContext';
import { OfficialsContent } from '@/components/OfficialsWorkspace';

export default function ClubOfficialsPage() {
  const { clubId } = useTournament();

  if (!clubId) return null;

  return (
    <div className="w-full h-full">
      <OfficialsContent isClubMode={true} clubId={clubId} />
    </div>
  );
}
