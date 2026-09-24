'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { db, basePath, dbManager, getActiveTournamentIdSync } from '@/db/dbClient';
import { Bout, Participant, Club, Category, isKataCategory } from '@/db/types';
import { SportdataBracket } from '@/components/SportdataBracket';

function BracketDisplayContent() {
  const searchParams = useSearchParams();
  const categoryId = searchParams.get('categoryId');

  const [bouts, setBouts] = useState<Bout[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  // Initial load
  useEffect(() => {
    if (!categoryId) return;
    loadData();
  }, [categoryId]);

  // Real-time broadcast listener & Polling for live updates
  useEffect(() => {
    if (!categoryId) return;

    let channel: BroadcastChannel | null = null;
    if (typeof window !== 'undefined') {
      try {
        channel = new BroadcastChannel('wkf-scoreboard-sync');
        channel.onmessage = (event) => {
          if (['MATCH_FINISHED', 'BOUT_UPDATED', 'SYNC_FULL_STATE', 'REFRESH_DATA', 'REFRESH_DISPLAY'].includes(event.data?.type)) {
            fetchBoutsQuietly();
          }
        };
      } catch (e) {}
    }

    const intervalId = setInterval(() => {
      fetchBoutsQuietly();
    }, 2500); // 2.5 seconds fallback poll for live synchronization
    
    return () => {
      clearInterval(intervalId);
      if (channel) channel.close();
    };
  }, [categoryId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const activeId = getActiveTournamentIdSync();
      if (activeId) {
        await dbManager.loadTournament(activeId);
      }
      const [bList, pList, clList, catList] = await Promise.all([
        db.bouts.list(),
        db.participants.list(),
        db.clubs.list(),
        db.categories.list()
      ]);
      setBouts(bList);
      setParticipants(pList);
      setClubs(clList);
      setCategories(catList);
    } catch (err) {
      console.error('Error loading bracket data', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchBoutsQuietly = async () => {
    try {
      const activeId = getActiveTournamentIdSync();
      if (activeId) {
        await dbManager.loadTournament(activeId);
      }
      const bList = await db.bouts.list();
      setBouts(bList);
    } catch (err) {
      // ignore silent errors on poll
    }
  };

  const [loadedNotification, setLoadedNotification] = useState<string | null>(null);

  const handleBoutClick = (bout: Bout) => {
    // Broadcast match switch across any open operator/referee/scoreboard screens
    if (typeof window !== 'undefined') {
      try {
        const channel = new BroadcastChannel('wkf-scoreboard-sync');
        channel.postMessage({
          type: 'LOAD_BOUT',
          boutId: bout.id,
          categoryId: bout.category_id
        });
        channel.close();
      } catch (e) {}
    }

    const aka = participants.find(p => p.id === bout.participant_a_id);
    const ao = participants.find(p => p.id === bout.participant_b_id);
    const matchLabel = `R${bout.round_no}-B${bout.bout_no}${aka && ao ? ` (${aka.full_name} vs ${ao.full_name})` : ''}`;
    
    setLoadedNotification(`⚡ Loaded Match ${matchLabel} to Scoreboard`);
    setTimeout(() => setLoadedNotification(null), 3500);
  };

  if (!categoryId) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <h1 className="text-xl font-bold">No Category Selected</h1>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="animate-pulse text-lg font-bold">Loading Live Bracket...</div>
      </div>
    );
  }

  const category = categories.find(c => c.id === categoryId);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background relative">
      {/* Active Toast Notification */}
      {loadedNotification && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-yellow-500 text-black px-4 py-2 rounded-full font-black text-xs shadow-2xl flex items-center gap-2 border-2 border-white/40 animate-bounce">
          <span>🎯</span>
          <span>{loadedNotification}</span>
        </div>
      )}

      {/* Optional Top Status Bar for Broadcast display */}
      <div className="shrink-0 bg-primary/10 border-b border-primary/20 px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-foreground uppercase tracking-wider">{category?.name || 'Tournament Bracket'}</h1>
        </div>
        <div className="flex items-center gap-4 text-xs font-bold">
          <div className="flex items-center gap-1.5 text-emerald-500">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            LIVE SYNC
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto p-4 md:p-8">
        <div className="w-full h-full min-h-[800px] border border-border rounded-xl bg-card overflow-hidden shadow-2xl">
          <SportdataBracket
            bouts={bouts}
            participants={participants}
            clubs={clubs}
            categories={categories}
            selectedCatId={categoryId}
            canModify={true}
            onBoutClick={handleBoutClick}
            hideZoomControls={false}
          />
        </div>
      </div>
    </div>
  );
}

export default function BracketsDisplayPage() {
  return (
    <Suspense fallback={<div className="h-screen w-screen flex items-center justify-center font-bold">Initializing...</div>}>
      <BracketDisplayContent />
    </Suspense>
  );
}
