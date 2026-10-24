'use client';

import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { db, basePath } from '@/db/dbClient';
import { Bout, Participant, Club } from '@/db/types';
import {
  Zap, Play, Square, RotateCcw, X, Award, Timer, Clock,
  ChevronLeft, Volume2, VolumeX, RefreshCw, Undo, Save, Check, Award as MedalIcon, Tv, Maximize2, Minimize2, List, MonitorPlay, ExternalLink, LayoutDashboard, ArrowRight, Trophy
} from 'lucide-react';
import { useTournament } from '@/context/TournamentContext';
import DisplayPlaylistModal from '@/components/DisplayPlaylistModal';

export interface ScoreboardRef {
  undoLastAction: () => void;
  confirmResult: () => void;
  saveResult?: () => Promise<void> | void;
  rematch?: () => void;
}

export const KumiteScoreboardControl = React.forwardRef<ScoreboardRef, { boutId?: string, onClose?: () => void, onLogEvent?: (category: 'SCORE'|'PENALTY'|'TIMER'|'SYSTEM', msg: string) => void }>(({ boutId: propBoutId, onClose, onLogEvent }, ref) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const boutId = propBoutId || searchParams.get('boutId');
  const catId = searchParams.get('catId'); // passed from categories page
  const { tournamentName, acquireLock, releaseLock, activeTournamentId, activeLocks, tatamiId, updateTatamiTelemetry, userEmail, takeoverTatami } = useTournament();

  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);

  React.useImperativeHandle(ref, () => ({
    undoLastAction: () => handleUndo(),
    confirmResult: () => handleConfirmResult(),
    saveResult: () => handleSaveResult(),
    rematch: () => handleRematch()
  }));
  const [isLockedByOther, setIsLockedByOther] = useState<boolean>(false);
  const [bout, setBout] = useState<Bout | null>(null);
  const [competitorAka, setCompetitorAka] = useState<Participant | null>(null);
  const [competitorAo, setCompetitorAo] = useState<Participant | null>(null);
  const [clubs, setClubs] = useState<Club[]>([]);

  const getClubName = useCallback((participant: Participant | null | undefined): string => {
    if (!participant) return '';
    if (participant.club_id) {
      const found = clubs.find(c => c.id === participant.club_id);
      if (found?.name) return found.name;
    }
    if ((participant as any).dojo) return (participant as any).dojo;
    if ((participant as any).club) return (participant as any).club;
    return '';
  }, [clubs]);

  // Live scoring state
  const [scoreAka, setScoreAka] = useState<number>(0);
  const [scoreAo, setScoreAo] = useState<number>(0);
  const [senshuAka, setSenshuAka] = useState<boolean>(false);
  const [senshuAo, setSenshuAo] = useState<boolean>(false);

  // Track who scored first in the match (null = no one yet, 'aka' or 'ao', 'none' if simultaneous first scores occurred)
  const [firstScorer, setFirstScorer] = useState<'aka' | 'ao' | 'none' | null>(null);

  // Track which fighters scored their first valid point in the current stoppage sequence
  const [stoppageScorers, setStoppageScorers] = useState<('aka' | 'ao')[]>([]);
  const [stoppageInitialSenshu, setStoppageInitialSenshu] = useState<'aka' | 'ao' | 'none' | null>(null);

  // Penalties WKF System: C1, C2, C3, HC, H (0 to 5)
  const [c1Aka, setC1Aka] = useState<number>(0);
  const [c1Ao, setC1Ao] = useState<number>(0);

  // Technique log arrays (storing raw point values e.g. 3, 2, 1 for tie breaks)
  const [pointsAka, setPointsAka] = useState<number[]>([]);
  const [pointsAo, setPointsAo] = useState<number[]>([]);
  const [eventsAka, setEventsAka] = useState<{ fighter: string; points: number; technique: string; timestamp: number; matchId: string }[]>([]);
  const [eventsAo, setEventsAo] = useState<{ fighter: string; points: number; technique: string; timestamp: number; matchId: string }[]>([]);
  const [showPointHistory, setShowPointHistory] = useState(false);

  // Timer state
  const [timeLeft, setTimeLeft] = useState<number>(1800);
  const [timerActive, setTimerActive] = useState<boolean>(false);
  const [matchDuration, setMatchDuration] = useState<number>(180);
  const [readinessCountdown, setReadinessCountdown] = useState<number | null>(null);

  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [hasTimerRun, setHasTimerRun] = useState<boolean>(false);

  // History stack for Undo
  const [history, setHistory] = useState<any[]>([]);

  // Modal / Saving states
  const [showFinishModal, setShowFinishModal] = useState<boolean>(false);
  const [winnerSide, setWinnerSide] = useState<'aka' | 'ao' | null>(null);
  const [winMethod, setWinMethod] = useState<string>('Points');
  const [winnerConfirmed, setWinnerConfirmed] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  // Result workflow states: Timer Ends → Confirm Result → Save Result → Next Match
  const [resultConfirmed, setResultConfirmed] = useState<boolean>(false);
  const [resultSaved, setResultSaved] = useState<boolean>(false);
  // Ref mirror for synchronous reads in async callbacks (avoids React state timing issues)
  const resultConfirmedRef = useRef<boolean>(false);
  useEffect(() => { resultConfirmedRef.current = resultConfirmed; }, [resultConfirmed]);

  // Spectator View launch & management states
  const [spectatorConnected, setSpectatorConnected] = useState<boolean>(false);
  const [isStandbyActive, setIsStandbyActive] = useState<boolean>(false);
  const [popupBlocked, setPopupBlocked] = useState<boolean>(false);
  const [isSpectatorModalOpen, setIsSpectatorModalOpen] = useState<boolean>(false);

  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const lastSpectatorHeartbeat = useRef<number>(0);
  const spectatorWindowRef = useRef<Window | null>(null);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.warn(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const readinessCountdownRef = useRef<NodeJS.Timeout | null>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const broadcastStateRef = useRef<() => void>(() => {});
  const soundPlayedRef = useRef<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Auto-unlock AudioContext on first user interaction so sounds work without manual click
  useEffect(() => {
    const getOrCreateAudioCtx = () => {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      return audioCtxRef.current;
    };

    const unlock = () => {
      try {
        const ctx = getOrCreateAudioCtx();
        if (ctx.state === 'suspended') {
          ctx.resume();
        }
      } catch { /* ignore */ }
    };

    // Try immediately (works if page was opened via user gesture)
    unlock();

    // Also unlock on first interaction as a fallback
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    document.addEventListener('touchstart', unlock, { once: true });

    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('touchstart', unlock);
    };
  }, []);

  // Open Spectator Window helper
  const openSpectatorWindow = useCallback((mode: 'default' | 'new-tab' | 'new-window' | 'same-page' = 'default') => {
    if (typeof window === 'undefined') return;
    const activeTournamentId = localStorage.getItem('ts_active_tournament_id');
    const tournamentParam = activeTournamentId ? `&tournament=${encodeURIComponent(activeTournamentId)}` : '';
    const specUrl = `${window.location.origin}${basePath}/display?boutId=${boutId}&liveOnly=true${tournamentParam}`;
    let specWindow: Window | null = null;
    
    if (mode === 'same-page') {
      window.location.href = specUrl;
      return;
    }
    
    if (mode === 'default') {
      specWindow = window.open(specUrl, 'KarateTechSpectator');
    } else if (mode === 'new-tab') {
      specWindow = window.open(specUrl, '_blank');
    } else if (mode === 'new-window') {
      specWindow = window.open(specUrl, '_blank', 'width=1200,height=800,menubar=no,status=no');
    }
    
    spectatorWindowRef.current = specWindow;
    
    if (!specWindow || specWindow.closed || typeof specWindow.closed === 'undefined') {
      setPopupBlocked(true);
    } else {
      setPopupBlocked(false);
      try {
        specWindow.focus();
      } catch (e) {
        console.warn('Could not focus spectator window:', e);
      }
    }
  }, [boutId]);

  // Setup broadcast channel & heartbeat checks
  useEffect(() => {
    setMounted(true);
    let channel: BroadcastChannel | null = null;

    if (typeof window !== 'undefined') {
      channel = new BroadcastChannel('wkf-scoreboard-sync');
      broadcastChannelRef.current = channel;
      const urlHistory = new URLSearchParams(window.location.search).get('history') === 'true';
      setShowPointHistory(urlHistory || localStorage.getItem('ts_show_point_history_referee') === 'true');

      // Send initial handshake ping
      channel.postMessage({ type: 'PING' });

      // Helper to broadcast full state
      const broadcastFullState = async () => {
        const activeTournamentId = localStorage.getItem('ts_active_tournament_id');
        if (activeTournamentId && channel) {
          try {
            const { localStore } = await import('@/db/localStore');
            const tournamentDb = await localStore.loadTournament(activeTournamentId);
            if (tournamentDb) {
              channel.postMessage({
                type: 'SYNC_FULL_STATE',
                allBouts: tournamentDb.bouts || [],
                allParticipants: tournamentDb.participants || [],
                allCategories: tournamentDb.categories || [],
                allClubs: tournamentDb.clubs || [],
                playlists: tournamentDb.display_playlists || []
              });
            }
          } catch (e) {
            console.warn('Failed to broadcast full state', e);
          }
        }
      };

      // Handle message events
      channel.onmessage = async (event) => {
        const data = event.data;
        if (data.type === 'PONG' || data.type === 'SPECTATOR_CONNECTED') {
          lastSpectatorHeartbeat.current = Date.now();
          setSpectatorConnected(true);
          if (data.type === 'SPECTATOR_CONNECTED') {
            broadcastStateRef.current();
          }
        } else if (data.type === 'SPECTATOR_DISCONNECTED') {
          setSpectatorConnected(false);
        } else if (data.type === 'SET_IDLE') {
          setIsStandbyActive(Boolean(data.isIdle));
        } else if (data.type === 'REQUEST_FULL_STATE') {
          await broadcastFullState();
          broadcastStateRef.current();
        } else if (data.type === 'LOAD_BOUT' && data.boutId) {
          try {
            const bList = await db.bouts.list();
            const targetBout = bList.find(b => b.id === data.boutId);
            if (targetBout) {
              setBout(targetBout);
              const pList = await db.participants.list();
              const compAka = pList.find(p => p.id === targetBout.participant_a_id) || null;
              const compAo = pList.find(p => p.id === targetBout.participant_b_id) || null;
              setCompetitorAka(compAka);
              setCompetitorAo(compAo);
              setScoreAka(targetBout.score_a || 0);
              setScoreAo(targetBout.score_b || 0);
              setSenshuAka(targetBout.senshu_a || false);
              setSenshuAo(targetBout.senshu_b || false);
              setC1Aka(parseInt(targetBout.penalties_c1_a || '0') || 0);
              setC1Ao(parseInt(targetBout.penalties_c1_b || '0') || 0);
              setTimeLeft((targetBout.timer_seconds || 180) * 10);
              setTimerActive(false);
              if (readinessCountdownRef.current) clearInterval(readinessCountdownRef.current);
              setReadinessCountdown(5);
              let remaining = 5;
              readinessCountdownRef.current = setInterval(() => {
                remaining -= 1;
                setReadinessCountdown(remaining > 0 ? remaining : null);
                if (remaining <= 0 && readinessCountdownRef.current) {
                  clearInterval(readinessCountdownRef.current);
                  readinessCountdownRef.current = null;
                }
              }, 1000);
              setWinnerSide(targetBout.winner_id ? (targetBout.winner_id === targetBout.participant_a_id ? 'aka' : 'ao') : null);
              setWinnerConfirmed(targetBout.status === 'Completed');
              setResultConfirmed(targetBout.status === 'Completed');
            }
          } catch (e) {
            console.error('Failed to load bout on broadcast message', e);
          }
        }
      };

      // Save helper to ref so we can use it outside useEffect
      (window as any)._broadcastFullState = broadcastFullState;
    }

    // Ping interval to maintain keep-alive
    const pingInterval = setInterval(() => {
      broadcastChannelRef.current?.postMessage({ type: 'PING' });
    }, 1000);

    // Timeout checking connection health
    const healthInterval = setInterval(() => {
      if (lastSpectatorHeartbeat.current > 0 && Date.now() - lastSpectatorHeartbeat.current > 2500) {
        setSpectatorConnected(false);
      }
    }, 1000);

    // Auto-launch spectator window after 500ms if no connection is established
    const autoOpenTimeout = setTimeout(() => {
      if (lastSpectatorHeartbeat.current === 0) {
        openSpectatorWindow('default');
      }
    }, 500);

    return () => {
      clearInterval(pingInterval);
      clearInterval(healthInterval);
      clearTimeout(autoOpenTimeout);
      if (readinessCountdownRef.current) clearInterval(readinessCountdownRef.current);
      channel?.close();
    };
  }, [openSpectatorWindow]);

  // Trigger Superior Points fanfare when winner is determined by superior points
  useEffect(() => {
    if (winnerSide && winMethod === 'Superior Points' && soundPlayedRef.current !== winnerSide) {
      soundPlayedRef.current = winnerSide;
      playSuperiorPointsSound();
    } else if (!winnerSide) {
      soundPlayedRef.current = null;
    }
  }, [winnerSide, winMethod]);

  // Fetch bout data
  const loadBoutData = useCallback(async () => {
    if (!boutId) return;
    try {
      setLoading(true);
      const [bList, pList, cList, clList] = await Promise.all([
        db.bouts.list(),
        db.participants.list(),
        db.categories.list(),
        db.clubs.list()
      ]);
      setClubs(clList);
      const currentBout = bList.find(b => b.id === boutId);
      if (currentBout) {
        // --- ADMIN LOCK CHECK ---
        const myTatami = `Tatami ${tatamiId || 1}`;
        const lock = activeLocks.find(l => l.category_id === currentBout.category_id && l.is_active);
        
        if (lock && lock.tatami !== myTatami) {
          if (typeof window !== 'undefined') {
            alert(`CATEGORY ALREADY IN USE\nThis category is currently being managed by ${lock.tatami?.toUpperCase()}. Please select another category.`);
          }
          setLoading(false);
          return;
        }
    
        // Attempt to formally acquire lock from backend
        const lockResult = await acquireLock(currentBout.category_id);
        if (!lockResult.success) {
          if (typeof window !== 'undefined') {
            alert(`CATEGORY ALREADY IN USE\nThis category is currently being managed by another Tatami. Please select another category.`);
          }
          setLoading(false);
          return;
        }

        setBout(currentBout);

        const compAka = pList.find(p => p.id === currentBout.participant_a_id) || null;
        const compAo = pList.find(p => p.id === currentBout.participant_b_id) || null;
        setCompetitorAka(compAka);
        setCompetitorAo(compAo);

        setScoreAka(currentBout.score_a ?? 0);
        setScoreAo(currentBout.score_b ?? 0);
        setSenshuAka(currentBout.senshu_a ?? false);
        setSenshuAo(currentBout.senshu_b ?? false);

        let parsedEventsAka: { fighter: string; points: number; technique: string; timestamp: number; matchId: string }[] = [];
        let parsedEventsAo: { fighter: string; points: number; technique: string; timestamp: number; matchId: string }[] = [];
        let savedPointsAka: number[] = [];
        let savedPointsAo: number[] = [];

        if (currentBout.points_aka_history) {
          if (currentBout.points_aka_history.startsWith('[')) {
            try {
              parsedEventsAka = JSON.parse(currentBout.points_aka_history);
              savedPointsAka = parsedEventsAka.map(e => e.points);
            } catch (e) {
              console.error(e);
            }
          } else {
            savedPointsAka = currentBout.points_aka_history.split(',').map(Number).filter(Boolean);
            parsedEventsAka = savedPointsAka.map(pts => ({
              fighter: 'AKA',
              points: pts,
              technique: pts === 1 ? 'Yuko' : pts === 2 ? 'Waza-ari' : pts === 3 ? 'Ippon' : 'Point',
              timestamp: 0,
              matchId: currentBout.id
            }));
          }
        }

        if (currentBout.points_ao_history) {
          if (currentBout.points_ao_history.startsWith('[')) {
            try {
              parsedEventsAo = JSON.parse(currentBout.points_ao_history);
              savedPointsAo = parsedEventsAo.map(e => e.points);
            } catch (e) {
              console.error(e);
            }
          } else {
            savedPointsAo = currentBout.points_ao_history.split(',').map(Number).filter(Boolean);
            parsedEventsAo = savedPointsAo.map(pts => ({
              fighter: 'AO',
              points: pts,
              technique: pts === 1 ? 'Yuko' : pts === 2 ? 'Waza-ari' : pts === 3 ? 'Ippon' : 'Point',
              timestamp: 0,
              matchId: currentBout.id
            }));
          }
        }

        // Determine first scorer from saved history or Senshu columns directly
        if (currentBout.senshu_a) {
          setFirstScorer('aka');
        } else if (currentBout.senshu_b) {
          setFirstScorer('ao');
        } else {
          if (savedPointsAka.length > 0 && savedPointsAo.length > 0) {
            setFirstScorer('none');
          } else {
            setFirstScorer(null);
          }
        }

        setC1Aka(currentBout.penalties_c1_a ? parseInt(currentBout.penalties_c1_a) || 0 : 0);
        setC1Ao(currentBout.penalties_c1_b ? parseInt(currentBout.penalties_c1_b) || 0 : 0);

        setPointsAka(savedPointsAka);
        setPointsAo(savedPointsAo);
        setEventsAka(parsedEventsAka);
        setEventsAo(parsedEventsAo);

        const boutCat = cList.find(c => c.id === currentBout.category_id);
        const configuredTimer = boutCat?.category_timer_seconds ?? (boutCat as any)?.time_duration;
        const resolvedSecs = (configuredTimer !== undefined && currentBout.status !== 'Running' && currentBout.timer_active !== true)
          ? configuredTimer
          : (currentBout.timer_seconds ?? configuredTimer ?? 180);

        setTimeLeft(resolvedSecs * 10);
        setMatchDuration(resolvedSecs);
        setHasTimerRun(false);

        let loadedWinnerSide: 'aka' | 'ao' | null = null;
        if (currentBout.status === 'Completed' && currentBout.winner_id) {
          if (currentBout.winner_id === currentBout.participant_a_id) {
            loadedWinnerSide = 'aka';
          } else if (currentBout.winner_id === currentBout.participant_b_id) {
            loadedWinnerSide = 'ao';
          }
        }
        setWinnerSide(loadedWinnerSide);
        setWinMethod(loadedWinnerSide ? 'Points' : ''); // Provide fallback string
        setWinnerConfirmed(currentBout.status === 'Completed');
        setResultConfirmed(currentBout.status === 'Completed');
        setResultSaved(currentBout.status === 'Completed');
        resultConfirmedRef.current = currentBout.status === 'Completed';

        // Seed history with clean match start state for complete undo support
        const initialSnap = {
          scoreAka: currentBout.score_a ?? 0,
          scoreAo: currentBout.score_b ?? 0,
          senshuAka: currentBout.senshu_a ?? false,
          senshuAo: currentBout.senshu_b ?? false,
          firstScorer: currentBout.senshu_a ? 'aka' : currentBout.senshu_b ? 'ao' : null,
          hasTimerRun: false,
          c1Aka: currentBout.penalties_c1_a ? parseInt(currentBout.penalties_c1_a) || 0 : 0,
          c1Ao: currentBout.penalties_c1_b ? parseInt(currentBout.penalties_c1_b) || 0 : 0,
          pointsAka: savedPointsAka,
          pointsAo: savedPointsAo,
          stoppageScorers: [],
          eventsAka: parsedEventsAka,
          eventsAo: parsedEventsAo,
          winnerSide: loadedWinnerSide,
          winMethod: loadedWinnerSide ? 'Points' : '',
          timeLeft: (currentBout.timer_seconds ?? 180) * 10
        };
        setHistory([initialSnap]);
      }
    } catch (err) {
      console.error('Error loading scoreboard bout details:', err);
    } finally {
      setLoading(false);
    }
  }, [boutId]);

  useEffect(() => {
    if (mounted) {
      loadBoutData();
    }
  }, [mounted, loadBoutData]);

  const prevFirstScorerRef = useRef<'aka' | 'ao' | 'none' | null>(null);

  // Derive Senshu state from firstScorer
  // This ensures Senshu is always consistent with who scored first
  useEffect(() => {
    if (firstScorer === 'aka') {
      setSenshuAka(true);
      setSenshuAo(false);
      if (prevFirstScorerRef.current !== 'aka' && onLogEvent) {
        // Log if Senshu wasn't already awarded to AKA
        onLogEvent('SCORE', 'Senshu awarded to AKA');
      }
    } else if (firstScorer === 'ao') {
      setSenshuAo(true);
      setSenshuAka(false);
      if (prevFirstScorerRef.current !== 'ao' && onLogEvent) {
        // Log if Senshu wasn't already awarded to AO
        onLogEvent('SCORE', 'Senshu awarded to AO');
      }
    } else {
      setSenshuAka(false);
      setSenshuAo(false);
      if ((prevFirstScorerRef.current === 'aka' || prevFirstScorerRef.current === 'ao') && onLogEvent) {
        // Log if Senshu was revoked or cleared from someone
        onLogEvent('SCORE', 'Senshu revoked/cleared');
      }
    }
    prevFirstScorerRef.current = firstScorer;
  }, [firstScorer, onLogEvent]);

  // Broadcast function to sync displays
  const broadcastState = useCallback(() => {
    if (!broadcastChannelRef.current) return;
    const effectiveTatami = (takeoverTatami || tatamiId || (userEmail === 'tatami_2@spsportdatasolution.org' ? 2 : userEmail === 'tatami_1@spsportdatasolution.org' ? 1 : (bout?.tatami === 'Tatami 2' ? 2 : 1))) as 1 | 2;

    broadcastChannelRef.current.postMessage({
      type: 'SYNC_MATCH_STATE',
      boutId,
      categoryId: bout?.category_id,
      tatami: `Tatami ${effectiveTatami}`,
      roundNo: bout?.round_no,
      boutNo: bout?.bout_no,
      matchCode: bout ? `R${bout.round_no}B${bout.bout_no}` : undefined,
      akaName: competitorAka?.full_name || 'TBD Red',
      akaClub: getClubName(competitorAka),
      aoName: competitorAo?.full_name || 'TBD Blue',
      aoClub: getClubName(competitorAo),
      scoreAka,
      scoreAo,
      senshuAka,
      senshuAo,
      firstScorer,
      c1Aka,
      c2Aka: 0,
      c3Aka: 0,
      c1Ao,
      c2Ao: 0,
      c3Ao: 0,
      pointsAka,
      pointsAo,
      eventsAka,
      eventsAo,
      showPointHistory,
      timeLeft,
      timerActive,
      winner: winnerSide,
      winMethod: winMethod,
      resultConfirmed: resultConfirmed || winnerConfirmed || bout?.status === 'Completed',
      matchDuration
    });
  }, [
    boutId, competitorAka, competitorAo, scoreAka, scoreAo,
    senshuAka, senshuAo, firstScorer,
    c1Aka, c1Ao,
    pointsAka, pointsAo, eventsAka, eventsAo, showPointHistory,
    timeLeft, timerActive, winnerSide, winMethod, matchDuration, winnerConfirmed, resultConfirmed, bout,
    takeoverTatami, tatamiId, userEmail
  ]);

  useEffect(() => {
    broadcastStateRef.current = broadcastState;
  }, [broadcastState]);

  // Broadcast state updates in real-time
  useEffect(() => {
    if (mounted && bout) {
      broadcastState();

      const effectiveTatami = (takeoverTatami || tatamiId || (userEmail === 'tatami_2@spsportdatasolution.org' ? 2 : userEmail === 'tatami_1@spsportdatasolution.org' ? 1 : (bout?.tatami === 'Tatami 2' ? 2 : 1))) as 1 | 2;
      
      try {
        localStorage.setItem(`kt_active_bout_id_${effectiveTatami}`, bout.id);
        localStorage.setItem(`ts_active_bout_id_${effectiveTatami}`, bout.id);
        localStorage.setItem('kt_active_bout_id', bout.id);
        localStorage.setItem('ts_active_bout_id', bout.id);
      } catch (e) {}

      updateTatamiTelemetry({
        tatamiId: effectiveTatami,
        currentCategoryId: bout.category_id,
        currentMatchId: bout.id,
        currentMatchCode: `R${bout.round_no}B${bout.bout_no}`,
        currentBoutNo: bout.bout_no,
        currentScreenState: 'Kumite Scoreboard (Live)',
        status: 'online'
      });

      const saveDraft = async () => {
        try {
          await db.bouts.updateBoutState(boutId!, {
            status: bout?.status === 'Completed' ? 'Completed' : 'Running',
            tatami: `Tatami ${effectiveTatami}`,
            score_a: scoreAka,
            score_b: scoreAo,
            senshu_a: senshuAka,
            senshu_b: senshuAo,
            penalties_c1_a: String(c1Aka),
            penalties_c2_a: '0',
            penalties_c3_a: '0',
            penalties_c1_b: String(c1Ao),
            penalties_c2_b: '0',
            penalties_c3_b: '0',
            points_aka_history: JSON.stringify(eventsAka),
            points_ao_history: JSON.stringify(eventsAo),
            timer_seconds: Math.round(timeLeft / 10),
            timer_active: timerActive
          });
        } catch (e) {
          console.warn('Background draft save error', e);
        }
      };

      const debounceTimeout = setTimeout(saveDraft, 2000);
      return () => clearTimeout(debounceTimeout);
    }
  }, [
    scoreAka, scoreAo, senshuAka, senshuAo,
    c1Aka, c1Ao,
    pointsAka, pointsAo, eventsAka, eventsAo,
    timeLeft, timerActive, winnerSide, winMethod, mounted, bout, broadcastState, boutId,
    takeoverTatami, tatamiId, userEmail, updateTatamiTelemetry
  ]);

  // Sound generator
  const triggerBuzzer = () => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const audioCtx = audioCtxRef.current;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(320, audioCtx.currentTime);

      gainNode.gain.setValueAtTime(0.8, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.2);

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 1.2);
    } catch (err) {
      console.warn('Audio Context error:', err);
    }
  };

  const triggerBeep = () => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const audioCtx = audioCtxRef.current;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      
      const playBellRing = (startTime: number) => {
        const gainNode = audioCtx.createGain();
        gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime + startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + startTime + 0.6);
        gainNode.connect(audioCtx.destination);

        const freqs = [880, 1200, 1760];
        freqs.forEach((f) => {
          const osc = audioCtx.createOscillator();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(f, audioCtx.currentTime + startTime);
          osc.connect(gainNode);
          osc.start(audioCtx.currentTime + startTime);
          osc.stop(audioCtx.currentTime + startTime + 0.6);
        });
      };

      playBellRing(0);
      playBellRing(0.4);
      playBellRing(0.8);
    } catch (err) {
      console.warn('Audio Context error:', err);
    }
  };

  const playSuperiorPointsSound = () => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const audioCtx = audioCtxRef.current;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      
      const playTone = (freq: number, start: number, duration: number) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime + start);
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + start + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + start);
        osc.stop(audioCtx.currentTime + start + duration);
      };

      playTone(523.25, 0, 0.15);
      playTone(659.25, 0.15, 0.15);
      playTone(783.99, 0.3, 0.15);
      playTone(1046.50, 0.45, 0.35);
    } catch (err) {
      console.warn('Audio Context sound error:', err);
    }
  };

  const playHansokuAlarm = () => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const audioCtx = audioCtxRef.current;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      
      const playAlarmTone = (start: number) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(180, audioCtx.currentTime + start);
        gain.gain.setValueAtTime(0.8, audioCtx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + start + 0.4);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + start);
        osc.stop(audioCtx.currentTime + start + 0.4);
      };

      playAlarmTone(0);
      playAlarmTone(0.5);
      playAlarmTone(1.0);
    } catch (err) {
      console.warn('Alarm sound error:', err);
    }
  };

  // Helper to determine the winner automatically upon match expiration based on WKF rules
  const autoDetermineWinner = (): { side: 'aka' | 'ao'; method: string } | null => {
    if (scoreAka > scoreAo) {
      return { side: 'aka', method: 'Points' };
    }
    if (scoreAo > scoreAka) {
      return { side: 'ao', method: 'Points' };
    }

    // 1. Tie score: First tiebreaker is Senshu (first scorer advantage)
    if (senshuAka) {
      return { side: 'aka', method: 'SENSHU' };
    }
    if (senshuAo) {
      return { side: 'ao', method: 'SENSHU' };
    }

    // 2. Senshu is OFF for both: Second tiebreaker is superior scoring techniques (highest scoring technique achieved)
    const countTech = (arr: number[], tech: number) => arr.filter(x => x === tech).length;

    // 2a. Check Ippon (3 points)
    const ipponAka = countTech(pointsAka, 3);
    const ipponAo = countTech(pointsAo, 3);
    if (ipponAka !== ipponAo) {
      return ipponAka > ipponAo
        ? { side: 'aka', method: 'Superior Points' }
        : { side: 'ao', method: 'Superior Points' };
    }

    // 2b. Check Waza-ari (2 points)
    const wazaAka = countTech(pointsAka, 2);
    const wazaAo = countTech(pointsAo, 2);
    if (wazaAka !== wazaAo) {
      return wazaAka > wazaAo
        ? { side: 'aka', method: 'Superior Points' }
        : { side: 'ao', method: 'Superior Points' };
    }

    // 2c. Check Yuko (1 point)
    const yukoAka = countTech(pointsAka, 1);
    const yukoAo = countTech(pointsAo, 1);
    if (yukoAka !== yukoAo) {
      return yukoAka > yukoAo
        ? { side: 'aka', method: 'Superior Points' }
        : { side: 'ao', method: 'Superior Points' };
    }

    // Complete tie: default suggestion is Hantei (referee decision)
    return null;
  };

  // Derive projected winner dynamically when time ends (before saving)
  useEffect(() => {
    if (timeLeft === 0 && !timerActive && bout?.status !== 'Completed') {
      const result = autoDetermineWinner();
      if (result) {
        setWinnerSide(result.side);
        setWinMethod(result.method);
      } else {
        setWinnerSide(null);
        setWinMethod('Hantei');
      }
    }
  }, [timeLeft, timerActive, scoreAka, scoreAo, senshuAka, senshuAo, c1Aka, c1Ao, bout?.status]);

  // Timer runner loop
  useEffect(() => {
    if (timerActive) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            return 0;
          }
          return prev - 1;
        });
      }, 100);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerActive]);

  useEffect(() => {
    if (!timerActive) return;

    if (timeLeft === 0) {
      setTimerActive(false);
      triggerBuzzer();
      if (onLogEvent) onLogEvent('TIMER', 'Match time expired (00:00) — Buzzer sounded');
      return;
    }

    if (timeLeft === 150) {
      triggerBeep();
      if (onLogEvent) onLogEvent('TIMER', '15s warning (Atoshibaraku)');
    }
  }, [timeLeft, timerActive, onLogEvent, triggerBeep, triggerBuzzer]);

  // Save current state to history for undo operations
  const pushHistory = (
    prevScoreAka = scoreAka,
    prevScoreAo = scoreAo,
    prevSenshuAka = senshuAka,
    prevSenshuAo = senshuAo,
    prevFirstScorer = firstScorer,
    prevHasTimerRun = hasTimerRun,
    prevC1Aka = c1Aka,
    prevC1Ao = c1Ao,
    prevPointsAka = pointsAka,
    prevPointsAo = pointsAo,
    prevStoppageScorers = stoppageScorers,
    prevStoppageInitialSenshu = stoppageInitialSenshu,
    prevEventsAka = eventsAka,
    prevEventsAo = eventsAo,
    prevWinnerSide = winnerSide,
    prevWinMethod = winMethod,
    prevTimeLeft = timeLeft
  ) => {
    setHistory((prev) => [
      ...prev,
      {
        scoreAka: prevScoreAka,
        scoreAo: prevScoreAo,
        senshuAka: prevSenshuAka,
        senshuAo: prevSenshuAo,
        firstScorer: prevFirstScorer,
        hasTimerRun: prevHasTimerRun,
        c1Aka: prevC1Aka,
        c1Ao: prevC1Ao,
        pointsAka: prevPointsAka,
        pointsAo: prevPointsAo,
        stoppageScorers: prevStoppageScorers,
        stoppageInitialSenshu: prevStoppageInitialSenshu,
        eventsAka: prevEventsAka,
        eventsAo: prevEventsAo,
        winnerSide: prevWinnerSide,
        winMethod: prevWinMethod,
        timeLeft: prevTimeLeft
      }
    ]);
  };

  // Undo action: undoes actions all the way back to match start time
  const handleUndo = useCallback(() => {
    if (history.length === 0) return;

    // Pause timer on undo so operator can make corrections cleanly
    setTimerActive(false);

    if (history.length <= 1) {
      // Revert completely back to initial match start snapshot (timer, scores, penalties, senshu)
      const initial = history[0];
      if (initial) {
        setScoreAka(initial.scoreAka ?? 0);
        setScoreAo(initial.scoreAo ?? 0);
        setSenshuAka(initial.senshuAka ?? false);
        setSenshuAo(initial.senshuAo ?? false);
        setFirstScorer(initial.firstScorer ?? null);
        setHasTimerRun(initial.hasTimerRun ?? false);
        setC1Aka(initial.c1Aka ?? 0);
        setC1Ao(initial.c1Ao ?? 0);
        setPointsAka(initial.pointsAka ?? []);
        setPointsAo(initial.pointsAo ?? []);
        setEventsAka(initial.eventsAka ?? []);
        setEventsAo(initial.eventsAo ?? []);
        setStoppageScorers(initial.stoppageScorers ?? []);
        setStoppageInitialSenshu(initial.stoppageInitialSenshu ?? null);
        setWinnerSide(initial.winnerSide ?? null);
        setWinMethod(initial.winMethod ?? '');
        setShowFinishModal(false);
        setWinnerConfirmed(false);
        setResultConfirmed(false);
        setResultSaved(false);
        if (initial.timeLeft !== undefined) {
          setTimeLeft(initial.timeLeft);
        }
      }
      if (onLogEvent) onLogEvent('SYSTEM', 'Undo: Reverted all the way back to match start time and state');
      return;
    }

    const lastState = history[history.length - 1];
    setScoreAka(lastState.scoreAka);
    setScoreAo(lastState.scoreAo);
    setSenshuAka(lastState.senshuAka);
    setSenshuAo(lastState.senshuAo);
    setFirstScorer(lastState.firstScorer ?? null);
    setHasTimerRun(lastState.hasTimerRun ?? false);
    setC1Aka(lastState.c1Aka ?? 0);
    setC1Ao(lastState.c1Ao ?? 0);
    setPointsAka(lastState.pointsAka ?? []);
    setPointsAo(lastState.pointsAo ?? []);
    setEventsAka(lastState.eventsAka ?? []);
    setEventsAo(lastState.eventsAo ?? []);
    setStoppageScorers(lastState.stoppageScorers ?? []);
    setStoppageInitialSenshu(lastState.stoppageInitialSenshu ?? null);
    setWinnerSide(lastState.winnerSide ?? null);
    setWinMethod(lastState.winMethod ?? '');
    setShowFinishModal(false);
    setWinnerConfirmed(false);
    setResultConfirmed(false);
    setResultSaved(false);
    if (lastState.timeLeft !== undefined) {
      setTimeLeft(lastState.timeLeft);
    }
    setHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
    if (onLogEvent) onLogEvent('SYSTEM', 'Undo: Reverted to previous state');
  }, [history, onLogEvent]);

  // Adjust scores with Senshu Award Rules:
  // 1. Start: both OFF
  // 2. First scorer (opponent has 0 points) → award Senshu permanently
  // 3. If both have ever scored at any time → Senshu OFF (no first scorer advantage)
  // 4. If both score in same sequence → Senshu OFF
  // 5. Senshu awarded only when one fighter is first scorer while opponent score is 0
  // 6. Once awarded, Senshu remains with that fighter (cannot transfer)
  // 7. Senshu indicator visible until match ends
  // 8. At end, if tied, use Senshu as tie-break
  const handleAddScore = useCallback((side: 'aka' | 'ao', points: number) => {
    if (bout?.status === 'Completed') return;
    if (c1Aka >= 5 || c1Ao >= 5) return;
    pushHistory();
    let finalScoreAka = scoreAka;
    let finalScoreAo = scoreAo;
    let finalPointsAka = [...pointsAka];
    let finalPointsAo = [...pointsAo];

    if (points > 0) {
      if (onLogEvent) {
        const pointType = points === 3 ? 'IPPON' : points === 2 ? 'WAZA-ARI' : 'YUKO';
        onLogEvent('SCORE', `${side.toUpperCase()} scored ${pointType}`);
      }
    }

    const newEvent = {
        fighter: side === 'aka' ? competitorAka?.full_name || 'AKA' : competitorAo?.full_name || 'AO',
        points,
        technique: points === 3 ? 'Ippon' : points === 2 ? 'Waza-ari' : 'Yuko',
        timestamp: Date.now(),
        matchId: boutId || ''
    };

    if (side === 'aka') {
      const newScore = Math.max(0, scoreAka + points);
      setScoreAka(newScore);
      finalScoreAka = newScore;

      if (points > 0) {
        finalPointsAka.push(points);
        setPointsAka(finalPointsAka);
        setEventsAka(prev => [...prev, newEvent]);
      } else if (points < 0 && finalPointsAka.length > 0) {
        finalPointsAka.pop();
        setPointsAka(finalPointsAka);
        setEventsAka(prev => {
          const next = [...prev];
          let p = Math.abs(points);
          while (p > 0 && next.length > 0) {
            const last = { ...next[next.length - 1] };
            if (last.points <= p) {
              p -= last.points;
              next.pop();
            } else {
              last.points -= p;
              last.technique = last.points === 1 ? 'Yuko' : last.points === 2 ? 'Waza-ari' : last.points === 3 ? 'Ippon' : 'Point';
              next[next.length - 1] = last;
              p = 0;
            }
          }
          return next;
        });
      }
    } else {
      const newScore = Math.max(0, scoreAo + points);
      setScoreAo(newScore);
      finalScoreAo = newScore;

      if (points > 0) {
        finalPointsAo.push(points);
        setPointsAo(finalPointsAo);
        setEventsAo(prev => [...prev, newEvent]);
      } else if (points < 0 && finalPointsAo.length > 0) {
        finalPointsAo.pop();
        setPointsAo(finalPointsAo);
        setEventsAo(prev => {
          const next = [...prev];
          let p = Math.abs(points);
          while (p > 0 && next.length > 0) {
            const last = { ...next[next.length - 1] };
            if (last.points <= p) {
              p -= last.points;
              next.pop();
            } else {
              last.points -= p;
              last.technique = last.points === 1 ? 'Yuko' : last.points === 2 ? 'Waza-ari' : last.points === 3 ? 'Ippon' : 'Point';
              next[next.length - 1] = last;
              p = 0;
            }
          }
          return next;
        });
      }
    }

    // Determine Senshu state based on current scores and custom first-score rules
    if (points > 0) {
      if (!timerActive) {
        setStoppageScorers((prev) => {
          const next = prev.includes(side) ? prev : [...prev, side];
          
          let initialSenshu = stoppageInitialSenshu;
          if (prev.length === 0) {
            initialSenshu = firstScorer;
            setStoppageInitialSenshu(initialSenshu);
          }

          if (next.includes('aka') && next.includes('ao')) {
            // Simultaneous scoring!
            if (initialSenshu === null || initialSenshu === 'none') {
              // No one had Senshu before this stoppage -> neither gets it
              setFirstScorer('none');
            } else {
              // Restore Senshu to original owner (already locked in from previous exchanges)
              setFirstScorer(initialSenshu);
            }
          } else {
            // Only one scored so far in this stoppage sequence
            if (initialSenshu === null || initialSenshu === 'none') {
              // Award Senshu to the first scorer
              setFirstScorer(side);
            }
            // If initialSenshu is already set to 'aka' or 'ao', DO NOTHING.
            // Senshu is retained by the first owner permanently.
          }
          return next;
        });
      } else {
        // Active play: immediately award Senshu to the scorer if Senshu was OFF
        if (firstScorer === null || firstScorer === 'none') {
          setFirstScorer(side);
        }
        // If firstScorer is already set, DO NOTHING. It is locked in.
      }
    } else {
      // Points subtraction (undo/correction)
      if (finalScoreAka === 0 && finalScoreAo === 0) {
        setFirstScorer(null);
        setStoppageScorers([]);
        setStoppageInitialSenshu(null);
      } else if (finalScoreAka === 0) {
        setFirstScorer('ao');
        setStoppageScorers((prev) => prev.filter(s => s !== 'aka'));
      } else if (finalScoreAo === 0) {
        setFirstScorer('aka');
        setStoppageScorers((prev) => prev.filter(s => s !== 'ao'));
      }
    }

    // Check for 8-point gap differential rule
    if (Math.abs(finalScoreAka - finalScoreAo) >= 8) {
      setTimerActive(false);
      triggerBuzzer();
      const finalWinner = finalScoreAka > finalScoreAo ? 'aka' : 'ao';
      setWinnerSide(finalWinner);
      setWinMethod('Points');
    }
  }, [scoreAka, scoreAo, senshuAka, senshuAo, firstScorer, hasTimerRun, triggerBuzzer, pointsAka, pointsAo, eventsAka, eventsAo, c1Aka, c1Ao, bout, timerActive, competitorAka, competitorAo, boutId]);

  // Manage Penalties WKF System: C1, C2, C3, HC, H (level 1 to 5)
  const handleTogglePenalty = (side: 'aka' | 'ao', level: number) => {
    if (!bout || bout.status === 'Completed') return;
    pushHistory();

    const isAka = side === 'aka';
    let nextVal = 0;

    if (isAka) {
      nextVal = c1Aka === level ? Math.max(0, level - 1) : level;
      setC1Aka(nextVal);
    } else {
      nextVal = c1Ao === level ? Math.max(0, level - 1) : level;
      setC1Ao(nextVal);
    }

    if (onLogEvent) {
      const penaltyLevel = nextVal === 5 ? 'HANSOKU' : nextVal > 0 ? `C${nextVal}` : 'penalty cleared';
      onLogEvent('PENALTY', `${side.toUpperCase()} ${penaltyLevel}`);
    }

    // Hansoku (disqualification) at level 5
    if (nextVal === 5) {
      setTimerActive(false);
      playHansokuAlarm();
      const opponentSide = isAka ? 'ao' : 'aka';

      // Auto-clear active scoring data and force 8-0 result to the opponent on Hansoku.
      setScoreAka(isAka ? 0 : 8);
      setScoreAo(isAka ? 8 : 0);
      setPointsAka([]);
      setPointsAo([]);
      setEventsAka([]);
      setEventsAo([]);
      setSenshuAka(false);
      setSenshuAo(false);
      setFirstScorer(null);
      setStoppageScorers([]);
      setStoppageInitialSenshu(null);
      setHasTimerRun(false);
      setTimeLeft(matchDuration * 10);

      // Keep disqualification marker visible on the losing side.
      if (isAka) {
        setC1Aka(5);
        setC1Ao(0);
      } else {
        setC1Ao(5);
        setC1Aka(0);
      }

      setWinnerSide(opponentSide);
      setWinMethod('HANSOKU');
    } else if ((isAka && c1Aka >= 5) || (!isAka && c1Ao >= 5)) {
      // Operator reduced penalty back down below 5
      if (winMethod === 'HANSOKU') {
        setWinnerSide(null);
        setWinMethod('');
      }
    }
  };

  // Manage Senshu - manual toggle (referee override only)
  const toggleTimer = () => {
    if (!bout || bout.status === 'Completed' || winnerSide) return;
    setTimerActive(!timerActive);
    if (!hasTimerRun) setHasTimerRun(true);
    if (onLogEvent) {
      onLogEvent('TIMER', `Timer ${!timerActive ? 'started' : 'paused'}`);
    }
  };

  const handleToggleSenshu = (side: 'aka' | 'ao') => {
    if (!bout || bout.status === 'Completed') return;
    pushHistory();
    if (side === 'aka') {
      if (firstScorer === 'aka') {
        setFirstScorer(null);
      } else {
        setFirstScorer('aka');
      }
    } else {
      if (firstScorer === 'ao') {
        setFirstScorer(null);
      } else {
        setFirstScorer('ao');
      }
    }
  };

  const formatTimerDisplay = (deciseconds: number) => {
    const totalSecs = Math.max(0, Math.round(deciseconds / 10));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Timer controls
  const handleStartTimer = () => {
    if (timeLeft > 0) {
      setTimerActive(true);
      if (onLogEvent) onLogEvent('TIMER', `Timer started at ${formatTimerDisplay(timeLeft)}`);
    }
  };

  const handleStopTimer = () => {
    setTimerActive(false);
    if (onLogEvent) onLogEvent('TIMER', `Timer paused at ${formatTimerDisplay(timeLeft)}`);
  };

  const handleResetTimer = () => {
    pushHistory();
    setTimerActive(false);
    const initialT = matchDuration * 10;
    setTimeLeft(initialT);
    setHasTimerRun(false);
    if (boutId) {
      db.bouts.update(boutId, { timer_seconds: matchDuration, timer_active: false }).catch(() => {});
    }
    if (onLogEvent) {
      const mins = Math.floor(matchDuration / 60);
      const secs = matchDuration % 60;
      const formatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      onLogEvent('TIMER', `Timer reset to match start duration (${formatted})`);
    }
  };

  const handleAdjustTime = (seconds: number) => {
    pushHistory();
    const newT = Math.max(0, timeLeft + seconds * 10);
    setTimeLeft(newT);
    if (boutId) {
      db.bouts.update(boutId, { timer_seconds: Math.round(newT / 10) }).catch(() => {});
    }
    if (onLogEvent) {
      const sign = seconds > 0 ? `+${seconds}s` : `${seconds}s`;
      const formatted = formatTimerDisplay(newT);
      onLogEvent('TIMER', `Timer adjusted (${sign}) → ${formatted}`);
    }
  };

  const handleSetMatchDuration = (val: number) => {
    pushHistory();
    setMatchDuration(val);
    setTimeLeft(val * 10);
    if (boutId) {
      db.bouts.update(boutId, { timer_seconds: val, timer_active: false }).catch(() => {});
    }
    if (onLogEvent) {
      const mins = Math.floor(val / 60);
      const secs = val % 60;
      const formatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      onLogEvent('TIMER', `Match duration preset set to ${formatted}`);
    }
  };

  // Set hasTimerRun to true when timer is active and clear stoppageScorers when active
  useEffect(() => {
    if (timerActive) {
      setHasTimerRun(true);
      setStoppageScorers([]);
      setStoppageInitialSenshu(null);
    }
  }, [timerActive]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement?.tagName;
      if (activeEl === 'INPUT' || activeEl === 'TEXTAREA' || activeEl === 'SELECT') {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          setTimerActive(prev => !prev);
          break;
        case 'KeyR':
          handleAddScore('aka', 1);
          break;
        case 'KeyF':
          handleAddScore('aka', 2);
          break;
        case 'KeyV':
          handleAddScore('aka', 3);
          break;
        case 'KeyU':
          handleAddScore('ao', 1);
          break;
        case 'KeyJ':
          handleAddScore('ao', 2);
          break;
        case 'KeyM':
          handleAddScore('ao', 3);
          break;
        case 'Backspace':
          e.preventDefault();
          handleUndo();
          break;
        case 'Enter':
          e.preventDefault();
          setTimerActive(false);
          if (c1Aka < 5 && c1Ao < 5) {
            const autoWin = autoDetermineWinner();
            if (autoWin) {
              setWinnerSide(autoWin.side);
              setWinMethod(autoWin.method);
            } else {
              setWinnerSide(null);
              setWinMethod('Hantei');
            }
          }
          setShowFinishModal(true);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAddScore, handleUndo, autoDetermineWinner]);

  // Time formatters
  const formatMainTime = (tenths: number): string => {
    const totalSeconds = Math.floor(tenths / 10);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatDecsTime = (tenths: number): string => {
    return `.${tenths % 10}`;
  };

  const akaTechniqueCounts = {
    ippon: eventsAka.filter((event) => event.points === 3).length,
    wazaAri: eventsAka.filter((event) => event.points === 2).length,
    yuko: eventsAka.filter((event) => event.points === 1).length
  };

  const aoTechniqueCounts = {
    ippon: eventsAo.filter((event) => event.points === 3).length,
    wazaAri: eventsAo.filter((event) => event.points === 2).length,
    yuko: eventsAo.filter((event) => event.points === 1).length
  };

  const akaTwoDigitScore = scoreAka >= 10;
  const aoTwoDigitScore = scoreAo >= 10;

  const akaScoreShiftClass = '';
  const aoScoreShiftClass = '';

  const akaScoreSizeClass = 'text-[120px] lg:text-[160px] xl:text-[180px]';
  const aoScoreSizeClass = 'text-[120px] lg:text-[160px] xl:text-[180px]';

  const akaSummaryBoxClass = akaTwoDigitScore ? 'h-full px-2 py-2.5' : 'h-full px-2.5 py-2.5';
  const aoSummaryBoxClass = aoTwoDigitScore ? 'h-full px-2 py-2.5' : 'h-full px-2.5 py-2.5';

  const akaSummaryGridClass = akaTwoDigitScore ? 'gap-x-2 text-[14px] lg:text-[16px]' : 'gap-x-2 text-[15px] lg:text-[17px]';
  const aoSummaryGridClass = aoTwoDigitScore ? 'gap-x-2 text-[14px] lg:text-[16px]' : 'gap-x-2 text-[15px] lg:text-[17px]';

  const akaSummaryValueClass = akaTwoDigitScore ? 'px-1.5 min-w-7' : 'px-2 min-w-8';
  const aoSummaryValueClass = aoTwoDigitScore ? 'px-1.5 min-w-7' : 'px-2 min-w-8';

  const akaSummarySlotClass = akaTwoDigitScore
    ? 'w-[132px] lg:w-[148px] h-[78px] lg:h-[90px]'
    : 'w-[146px] lg:w-[162px] h-[84px] lg:h-[96px]';
  const aoSummarySlotClass = aoTwoDigitScore
    ? 'w-[132px] lg:w-[148px] h-[78px] lg:h-[90px]'
    : 'w-[146px] lg:w-[162px] h-[84px] lg:h-[96px]';

  // Finish Match saving result — requires result to be CONFIRMED first (new workflow)
  const handleSaveResult = async () => {
    if (!boutId || !bout) return;

    let winnerId: string | null = null;
    let side = winnerSide;
    let method = winMethod;

    if (!side) {
      const autoRes = autoDetermineWinner();
      if (autoRes) {
        side = autoRes.side;
        method = autoRes.method;
        setWinnerSide(side);
        setWinMethod(method);
      } else {
        // Tied score without senshu -> prompt manual finish decision
        setWinMethod('Hantei');
        setShowFinishModal(true);
        return;
      }
    }

    if (side === 'aka') {
      winnerId = bout.participant_a_id;
    } else if (side === 'ao') {
      winnerId = bout.participant_b_id;
    }

    if (!winnerId) {
      alert('Please select a winner before saving.');
      return;
    }

    setResultConfirmed(true);
    setWinnerConfirmed(true);
    resultConfirmedRef.current = true;

    // Capture for use inside the async try block
    const capturedWinnerId = winnerId;

    try {
      setSaving(true);

      await db.bouts.updateBoutState(boutId, {
        status: 'Completed',
        winner_id: capturedWinnerId,
        score_a: scoreAka,
        score_b: scoreAo,
        senshu_a: senshuAka,
        senshu_b: senshuAo,
        penalties_c1_a: String(c1Aka),
        penalties_c2_a: '0',
        penalties_c3_a: '0',
        penalties_c1_b: String(c1Ao),
        penalties_c2_b: '0',
        penalties_c3_b: '0',
        points_aka_history: JSON.stringify(eventsAka),
        points_ao_history: JSON.stringify(eventsAo),
        timer_seconds: Math.round(timeLeft / 10),
        victory_method: method || winMethod || 'Points'
      });

      // Broadcast full state to display screen hub so bracket updates instantly
      if (typeof window !== 'undefined' && (window as any)._broadcastFullState) {
        (window as any)._broadcastFullState();
      }

      setResultSaved(true);
      setBout(prev => prev ? { ...prev, status: 'Completed', winner_id: capturedWinnerId } : prev);
      setShowFinishModal(false);
      if (onLogEvent) onLogEvent('SYSTEM', `Match result saved — Winner: ${side.toUpperCase()} (${method || 'Points'})`);
    } catch (err) {
      console.error('Error saving bout result:', err);
      alert('Failed to save result. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Confirm Result: 1st click locks in the auto-determined winner and displays full-screen Winner Page on Referee View.
  // 2nd click reverses back and restores the live scoreboard.
  const handleConfirmResult = () => {
    if (resultConfirmed) {
      // 2nd CLICK: Reverse back action
      setResultConfirmed(false);
      resultConfirmedRef.current = false;
      setWinnerConfirmed(false);
      setWinnerSide(null);
      setWinMethod('');
      if (onLogEvent) onLogEvent('SYSTEM', 'Result confirmation reversed — Scoreboard restored on Referee View');
      return;
    }

    if (bout?.status === 'Completed') return;

    // 1st CLICK: Confirm winner & show full-screen Winner Page
    let side = winnerSide;
    let method = winMethod;
    if (!side) {
      const result = autoDetermineWinner();
      if (result) {
        side = result.side;
        method = result.method;
        setWinnerSide(result.side);
        setWinMethod(result.method);
      } else {
        // No automatic winner determined (tied score / 0-0 without Senshu)
        // Bring up manual decision modal for operator to select winner (Hantei / Kiken / Hansoku)
        setWinMethod('Hantei');
        setShowFinishModal(true);
        return;
      }
    }

    setTimerActive(false);
    setResultConfirmed(true);
    setWinnerConfirmed(true);
    resultConfirmedRef.current = true;

    // Broadcast confirmed result to Referee View so Winner Page displays only NOW
    if (typeof window !== 'undefined') {
      try {
        const channel = new BroadcastChannel('wkf-scoreboard-sync');
        channel.postMessage({
          type: 'SHOW_RESULT',
          resultConfirmed: true,
          winnerSide: side,
          winner: side,
          winMethod: method,
          akaName: competitorAka?.full_name || 'AKA Red',
          akaClub: getClubName(competitorAka),
          aoName: competitorAo?.full_name || 'AO Blue',
          aoClub: getClubName(competitorAo),
          scoreAka,
          scoreAo,
          boutId
        });
        channel.close();
      } catch (err) {}
    }

    if (onLogEvent) onLogEvent('SYSTEM', `Match Result Confirmed — Winner: ${side.toUpperCase()} (${method})`);
  };

  const handleToggleStandby = useCallback(() => {
    const nextStandby = !isStandbyActive;
    setIsStandbyActive(nextStandby);
    if (typeof window !== 'undefined') {
      try {
        const channel = new BroadcastChannel('wkf-scoreboard-sync');
        channel.postMessage({ type: 'SET_IDLE', isIdle: nextStandby });
        channel.close();
        if (!nextStandby) {
          // Returning from Standby: broadcast current live match state immediately
          broadcastState();
          if ((window as any)._broadcastFullState) {
            (window as any)._broadcastFullState();
          }
        }
      } catch (err) {}
    }
    if (onLogEvent) {
      onLogEvent(
        'SYSTEM',
        nextStandby
          ? 'Standby screen activated on spectator display'
          : 'Standby dismissed — returned to live match display'
      );
    }
  }, [isStandbyActive, broadcastState, onLogEvent]);

  // Next Match: resets local scoring/timer state and navigates to match selection.
  // Only call after Save Result (or when operator explicitly decides to move on).
  const handleNextMatch = () => {
    setScoreAka(0);
    setScoreAo(0);
    setC1Aka(0);
    setC1Ao(0);
    setSenshuAka(false);
    setSenshuAo(false);
    setFirstScorer(null);
    setPointsAka([]);
    setPointsAo([]);
    setEventsAka([]);
    setEventsAo([]);
    setWinnerSide(null);
    setWinMethod('');
    setResultConfirmed(false);
    setResultSaved(false);
    resultConfirmedRef.current = false;
    setWinnerConfirmed(false);
    setTimeLeft(matchDuration * 10);
    setTimerActive(false);
    setStoppageScorers([]);
    setStoppageInitialSenshu(null);
    setHasTimerRun(false);
    setShowFinishModal(false);
    setHistory([]);

    // Broadcast IDLE / Standby state to spectator screen
    if (typeof window !== 'undefined') {
      try {
        const channel = new BroadcastChannel('wkf-scoreboard-sync');
        channel.postMessage({ type: 'SET_IDLE', isIdle: true });
        channel.close();
      } catch (err) {}
    }

    if (onClose) {
      onClose();
    } else {
      router.push('/dashboard/scoreboard');
    }
  };

  const handleRematch = async () => {
    if (!boutId) return;

    const confirmRematch = window.confirm(
      'Are you sure you want to reset this match and start a rematch? This will clear all scores, penalties, and history, and remove the winner placement in the bracket.'
    );
    if (!confirmRematch) return;

    try {
      setSaving(true);

      // Reset the bout in database / mockStore
      const resetBout = await db.bouts.resetBoutResult(boutId, matchDuration);
      if (resetBout) {
        setBout(resetBout);
      }

      // Reset local state variables
      setScoreAka(0);
      setScoreAo(0);
      setC1Aka(0);
      setC1Ao(0);
      setSenshuAka(false);
      setSenshuAo(false);
      setFirstScorer(null);
      setPointsAka([]);
      setPointsAo([]);
      setEventsAka([]);
      setEventsAo([]);
      setWinnerSide(null);
      setWinMethod('');
      setWinnerConfirmed(false);
      setResultConfirmed(false);
      setResultSaved(false);
      resultConfirmedRef.current = false;
      setTimeLeft(matchDuration * 10);
      setTimerActive(false);
      setHistory([]);

      alert('Rematch initialized! Scoreboard and timer options are now unlocked to start a new match.');
    } catch (err) {
      console.error('Error during rematch reset:', err);
      alert('Failed to initialize rematch. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleClearAllResult = async () => {
    if (!boutId) return;

    const confirmClear = window.confirm(
      'Clear all current match results? This will reset scores, penalties, winner, and timer state for this bout.'
    );
    if (!confirmClear) return;

    try {
      setSaving(true);

      const resetBout = await db.bouts.resetBoutResult(boutId, matchDuration);
      if (resetBout) {
        setBout(resetBout);
      }

      setScoreAka(0);
      setScoreAo(0);
      setC1Aka(0);
      setC1Ao(0);
      setSenshuAka(false);
      setSenshuAo(false);
      setFirstScorer(null);
      setPointsAka([]);
      setPointsAo([]);
      setEventsAka([]);
      setEventsAo([]);
      setWinnerSide(null);
      setWinMethod('');
      setWinnerConfirmed(false);
      setResultConfirmed(false);
      setResultSaved(false);
      resultConfirmedRef.current = false;
      setTimeLeft(matchDuration * 10);
      setTimerActive(false);
      setStoppageScorers([]);
      setStoppageInitialSenshu(null);
      setHasTimerRun(false);
      setShowFinishModal(false);
      setHistory([]);

      alert('All match results cleared. Scoreboard is reset.');
    } catch (err) {
      console.error('Error clearing match results:', err);
      alert('Failed to clear match results. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSpectatorIndicatorClick = () => {
    setIsSpectatorModalOpen(true);
  };

  const handleSpectatorButtonClick = () => {
    setIsSpectatorModalOpen(true);
  };

  if (!mounted || loading) {
    return (
      <div className="min-h-screen bg-[#0b0b10] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-yellow-400" />
      </div>
    );
  }

  if (!bout) {
    return (
      <div className="min-h-screen bg-[#0b0b10] flex items-center justify-center text-white">
        <div className="text-center">
          <p className="text-lg font-bold mb-4">Bout not found</p>
          <Link href="/bouts" className="text-yellow-400 hover:text-yellow-300">
            Return to Bouts
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-[100dvh] w-full overflow-y-auto bg-[#0b0b10] text-white flex flex-col">
      {/* Header */}
      <header className="bg-[#0b0b10] border-b border-white/5 px-4 py-1.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          {onClose ? (
            <button onClick={onClose} className="p-1 hover:bg-white/5 rounded-lg transition cursor-pointer">
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : (
            <Link href="/dashboard/scoreboard" className="p-1 hover:bg-white/5 rounded-lg transition">
              <ChevronLeft className="h-4 w-4" />
            </Link>
          )}
          <div>
            <h1 className="text-xs font-black uppercase tracking-wider">Scoreboard Control</h1>
            <p className="text-[9px] text-gray-500">{tournamentName || 'Tournament'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Status Indicator */}
          <button
            onClick={handleSpectatorIndicatorClick}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold transition border cursor-pointer ${
              spectatorConnected 
                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20' 
                : 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/20'
            }`}
            title={spectatorConnected ? "Focus existing spectator view" : "Launch spectator view"}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${spectatorConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
            <span>{spectatorConnected ? 'Referee Screen Connected' : 'Referee Screen Closed'}</span>
          </button>

          {/* Spectator View button */}
          <button
            onClick={handleSpectatorButtonClick}
            className="flex items-center gap-1 px-2.5 py-1 bg-yellow-500 hover:bg-yellow-400 text-black rounded-lg text-[10px] font-bold transition cursor-pointer"
          >
            <Tv className="h-3 w-3" />
            <span>Referee Screen</span>
          </button>

          {/* Display Playlists button */}
          <button
            onClick={() => setIsPlaylistModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 bg-secondary hover:bg-secondary/80 border border-white/10 text-white rounded-lg text-[10px] font-bold transition cursor-pointer"
          >
            <List className="h-3 w-3 text-yellow-400" />
            <span>Display Playlists</span>
          </button>

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition cursor-pointer border ${
              isFullscreen
                ? 'bg-white/10 text-white border-white/20 hover:bg-white/20'
                : 'bg-white/5 text-white/80 border-white/10 hover:bg-white/10'
            }`}
          >
            {isFullscreen ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            <span className="hidden sm:inline">{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
          </button>

          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-1 hover:bg-white/5 rounded-lg transition"
          >
            {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={handleUndo}
            disabled={history.length <= 1}
            className="flex items-center gap-1 px-2 py-0.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded-lg text-[10px] font-bold transition"
          >
            <Undo className="h-3 w-3" /> Undo
          </button>
        </div>
      </header>
      {readinessCountdown !== null && (
        <div className="fixed bottom-5 right-5 z-50 rounded-lg border border-yellow-400/50 bg-black/90 px-4 py-2 text-right shadow-xl pointer-events-none" aria-live="polite">
          <span className="block text-[10px] font-black uppercase tracking-wider text-yellow-300">Loading Match</span>
          <span className="block font-mono text-3xl font-black text-white">{String(readinessCountdown).padStart(2, '0')}</span>
        </div>
      )}

      {/* Spectator View Management Modal */}
      {isSpectatorModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-[#0f172a] border border-cyan-500/30 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden relative">
            <button 
              onClick={() => setIsSpectatorModalOpen(false)}
              className="absolute top-4 right-4 p-2 bg-white/5 hover:bg-white/10 rounded-full text-slate-400 hover:text-white transition"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="p-6">
              <div className="flex items-center justify-center w-12 h-12 bg-cyan-500/10 rounded-xl mb-4 border border-cyan-500/20 mx-auto">
                <Tv className="h-6 w-6 text-cyan-400" />
              </div>
              <h2 className="text-xl font-black text-center text-white mb-2">Launch Referee Screen</h2>
              <p className="text-sm text-slate-400 text-center mb-6">
                Choose how you want to open the live referee screen for this tatami.
              </p>
              
              <div className="space-y-3">
                <button
                  onClick={() => {
                    openSpectatorWindow('new-tab');
                    setIsSpectatorModalOpen(false);
                  }}
                  className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-cyan-500/10 border border-white/5 hover:border-cyan-500/30 rounded-xl transition cursor-pointer group"
                >
                  <div className="flex items-center gap-3 text-left">
                    <ExternalLink className="h-5 w-5 text-slate-400 group-hover:text-cyan-400" />
                    <div>
                      <div className="font-bold text-sm text-white">Open in New Tab</div>
                      <div className="text-[10px] text-slate-400">Standard browser tab</div>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-cyan-400" />
                </button>

                <button
                  onClick={() => {
                    openSpectatorWindow('new-window');
                    setIsSpectatorModalOpen(false);
                  }}
                  className="w-full flex items-center justify-between p-4 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 hover:border-cyan-500/50 rounded-xl transition cursor-pointer group"
                >
                  <div className="flex items-center gap-3 text-left">
                    <LayoutDashboard className="h-5 w-5 text-cyan-400" />
                    <div>
                      <div className="font-bold text-sm text-cyan-100">Open in Clean Window (Recommended)</div>
                      <div className="text-[10px] text-cyan-400/80">Popup window without browser chrome, best for external screens</div>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-cyan-400" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Popup Blocked Warning */}
      {popupBlocked && (
        <div className="bg-amber-500 text-black px-3 py-1 flex items-center justify-between text-[11px] font-bold shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs">⚠️</span>
            <span>Please allow pop-ups to automatically open the Spectator View on this device.</span>
          </div>
          <button
            onClick={() => openSpectatorWindow('default')}
            className="px-2 py-0.5 bg-black text-white hover:bg-black/90 rounded text-[9px] uppercase tracking-wider font-black transition cursor-pointer"
          >
            Open Spectator View
          </button>
        </div>
      )}


      {/* Main Scoreboard - Single Viewport Layout (Scrollable on Mobile) */}
      <main className="flex-1 flex flex-col gap-1 p-2 min-h-0">
        {/* Hansoku Disqualification Blinking Banner */}
        {(c1Aka >= 5 || c1Ao >= 5) && !winnerSide && (
          <div className="bg-red-600 text-white font-black text-center py-0.5 text-xs lg:text-sm rounded-lg mb-0.5 animate-pulse tracking-widest uppercase border border-red-500 shadow-[0_0_20px_rgba(220,38,38,0.6)] z-20 shrink-0">
            🚨 HANSOKU DISQUALIFICATION – {c1Aka >= 5 ? 'AKA (RED)' : 'AO (BLUE)'} 🚨
          </div>
        )}

        {/* Dynamic Result Status Banners — 3 states: Pending / Confirmed / Saved */}
        {/* 1. Timer ended, result auto-determined, waiting for confirmation */}
        {winnerSide && timeLeft === 0 && !timerActive && !resultConfirmed && bout.status !== 'Completed' && (
          <div className="p-1 mb-0.5 shrink-0 rounded-lg flex items-center justify-center font-black text-xs lg:text-sm tracking-widest uppercase border shadow-lg animate-pulse z-20 bg-amber-950/90 text-amber-400 border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.4)]">
            ⏱ RESULT PENDING — {winnerSide === 'aka' ? (competitorAka?.full_name || 'AKA RED') : (competitorAo?.full_name || 'AO BLUE')} LEADS — CLICK CONFIRM RESULT
          </div>
        )}
        {/* 2. Result confirmed (Referee View now shows Winner Page), not yet saved to DB */}
        {winnerSide && resultConfirmed && !resultSaved && bout.status !== 'Completed' && (
          <div className={`p-1 mb-0.5 shrink-0 rounded-lg flex items-center justify-center font-black text-xs lg:text-sm tracking-widest uppercase border shadow-lg z-20 ${
            winnerSide === 'aka'
              ? 'bg-red-950/90 text-red-400 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.5)]'
              : 'bg-blue-950/90 text-blue-400 border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.5)]'
          }`}>
            ✓ CONFIRMED — WINNER: {winnerSide === 'aka' ? (competitorAka?.full_name || 'AKA RED') : (competitorAo?.full_name || 'AO BLUE')} — CLICK SAVE RESULT TO FINALISE
          </div>
        )}
        {/* 3. Result saved to DB — Bout completed */}
        {winnerSide && (resultSaved || bout.status === 'Completed') && (
          <div className={`p-1 mb-0.5 shrink-0 rounded-lg flex items-center justify-center font-black text-xs lg:text-sm tracking-widest uppercase border shadow-lg animate-pulse z-20 ${
            winnerSide === 'aka'
              ? 'bg-red-950/90 text-red-400 border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.5)]'
              : 'bg-blue-950/90 text-blue-400 border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.5)]'
          }`}>
            {winMethod === 'HANSOKU' ? '🚨' : <Trophy className="h-4 w-4 mx-1 lg:h-5 lg:w-5 inline-block" />} WINNER BY {
              winMethod === 'Points' ? 'POINTS ADVANTAGE' :
              winMethod === 'SENSHU' ? 'SENSHU ADVANTAGE' :
              winMethod === 'Superior Points' ? 'SUPERIOR POINTS' :
              winMethod === 'Hantei' ? 'HANTEI DECISION' :
              winMethod === 'HANSOKU' ? 'HANSOKU DISQUALIFICATION' :
              winMethod === 'Kiken' ? 'KIKEN (WITHDRAWAL)' :
              winMethod || 'POINTS ADVANTAGE'
            }: {winnerSide === 'aka' ? (competitorAka?.full_name || 'AKA RED') : (competitorAo?.full_name || 'AO BLUE')} ✓ SAVED {winMethod === 'HANSOKU' ? '🚨' : <Trophy className="h-4 w-4 mx-1 lg:h-5 lg:w-5 inline-block" />}
          </div>
        )}

        {/* ROW 1: Visual Displays & Controls (3-Column Layout: AKA | TIMER | AO) */}
        <div className="grid grid-cols-3 gap-1 lg:gap-2 flex-1 min-h-0">
          
          {/* AKA Display & Control Panel */}
          <section className={`col-span-1 order-1 border rounded-xl p-1.5 lg:p-3 flex flex-col justify-between items-center transition-all duration-500 overflow-hidden flex-1 min-h-0 ${
            winnerSide === 'aka'
              ? 'bg-red-950/80 border-red-500 shadow-[inset_0_0_80px_rgba(239,68,68,0.3),0_0_40px_rgba(239,68,68,0.6)]'
              : 'bg-gradient-to-b from-red-950/20 via-red-950/5 to-transparent border-red-900/30'
          }`}>
            {/* Header & Fighter Name */}
            <div className="w-full flex flex-col items-center shrink-0">
              <div className="flex items-center justify-between w-full mb-1">
                <span className="text-4xl lg:text-6xl font-black uppercase tracking-widest text-red-400">AKA</span>
                {senshuAka && (
                  <div className="flex items-center gap-1 bg-yellow-500 text-black text-xs font-black uppercase px-3 py-0.5 rounded-full border border-yellow-400 shadow-[0_0_12px_rgba(234,179,8,0.6)]">
                    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z"/></svg>
                    SENSHU
                  </div>
                )}
              </div>
              <div className="w-full text-center mt-0.5">
                <h2 className="font-competitor text-base md:text-lg lg:text-xl font-bold truncate max-w-full text-center uppercase leading-tight text-white tracking-tight" title={competitorAka?.full_name || 'TBD Red'}>
                  {competitorAka?.full_name || 'TBD Red'}
                </h2>
                <p className="text-xs md:text-sm font-semibold text-red-400/80 text-center truncate max-w-full mt-0.5">
                  {getClubName(competitorAka) || '—'}
                </p>
              </div>
            </div>

            {/* Score & Technique Summary */}
            <div className="flex-1 min-h-0 py-0.5 w-full flex items-center gap-2">
              <div className={`flex-1 min-h-0 flex items-center justify-center ${akaScoreShiftClass}`}>
                <span className={`font-din ${akaScoreSizeClass} font-black leading-none tracking-tight select-none transition-all duration-300 ${
                  winnerSide === 'aka'
                    ? 'text-red-500 animate-blink drop-shadow-[0_0_50px_rgba(239,68,68,0.95)] scale-105'
                    : scoreAka - scoreAo >= 8
                      ? 'text-red-500 animate-pulse scale-105 drop-shadow-[0_0_50px_rgba(239,68,68,0.85)]'
                      : 'text-red-500 drop-shadow-[0_0_40px_rgba(220,38,38,0.5)]'
                }`}>
                  {scoreAka}
                </span>
              </div>

              <div className={`${akaSummarySlotClass} shrink-0 self-center mr-1 lg:mr-2`}>
                  <div className={`w-full rounded-lg border border-red-400/60 bg-red-950/65 shadow-[0_0_12px_rgba(239,68,68,0.25)] ${akaSummaryBoxClass}`}>
                    <div className={`grid grid-cols-[auto_auto] justify-end gap-y-0.5 font-black uppercase tracking-wide text-red-100 ${akaSummaryGridClass}`}>
                      <span className="whitespace-nowrap">Ippon</span>
                      <span className={`rounded bg-red-500/20 border border-red-400/30 text-right ${akaSummaryValueClass}`}>{akaTechniqueCounts.ippon}</span>
                      <span className="whitespace-nowrap">Waza-Ari</span>
                      <span className={`rounded bg-red-500/20 border border-red-400/30 text-right ${akaSummaryValueClass}`}>{akaTechniqueCounts.wazaAri}</span>
                      <span className="whitespace-nowrap">Yuko</span>
                      <span className={`rounded bg-red-500/20 border border-red-400/30 text-right ${akaSummaryValueClass}`}>{akaTechniqueCounts.yuko}</span>
                    </div>
                  </div>
              </div>
            </div>

            {/* AKA Controls: Score Buttons + Penalties */}
            <div className="w-full flex flex-col gap-1.5 pt-1.5 border-t border-red-900/30 shrink-0 pb-1">
              {/* Score Buttons */}
              <div className="grid grid-cols-3 gap-1 w-full">
                <button
                  onClick={() => handleAddScore('aka', 1)}
                  disabled={bout.status === 'Completed'}
                  className="py-1.5 lg:py-2 bg-red-600/40 hover:bg-red-600/60 border border-red-500/30 rounded-lg flex flex-col items-center justify-center transition cursor-pointer active:scale-95 disabled:opacity-25 disabled:cursor-not-allowed"
                >
                  <span className="text-sm md:text-base lg:text-lg font-black uppercase tracking-wider leading-none">+1</span>
                  <span className="text-[9px] md:text-[10px] font-black uppercase tracking-wider leading-tight mt-0.5">Yuko</span>
                </button>
                <button
                  onClick={() => handleAddScore('aka', 2)}
                  disabled={bout.status === 'Completed'}
                  className="py-1.5 lg:py-2 bg-red-600/40 hover:bg-red-600/60 border border-red-500/30 rounded-lg flex flex-col items-center justify-center transition cursor-pointer active:scale-95 disabled:opacity-25 disabled:cursor-not-allowed"
                >
                  <span className="text-sm md:text-base lg:text-lg font-black uppercase tracking-wider leading-none">+2</span>
                  <span className="text-[9px] md:text-[10px] font-black uppercase tracking-wider leading-tight mt-0.5">Waza-ari</span>
                </button>
                <button
                  onClick={() => handleAddScore('aka', 3)}
                  disabled={bout.status === 'Completed'}
                  className="py-1.5 lg:py-2 bg-red-600/40 hover:bg-red-600/60 border border-red-500/30 rounded-lg flex flex-col items-center justify-center transition cursor-pointer active:scale-95 disabled:opacity-25 disabled:cursor-not-allowed"
                >
                  <span className="text-sm md:text-base lg:text-lg font-black uppercase tracking-wider leading-none">+3</span>
                  <span className="text-[9px] md:text-[10px] font-black uppercase tracking-wider leading-tight mt-0.5">Ippon</span>
                </button>
              </div>

              {/* Penalties Row */}
              <div className="w-full">
                <div className="flex items-center justify-end mb-0.5">
                  <button
                    onClick={() => handleToggleSenshu('aka')}
                    disabled={bout.status === 'Completed'}
                    className={`text-sm lg:text-lg font-black uppercase px-4 py-2 lg:py-3 rounded border transition cursor-pointer ${senshuAka
                        ? 'bg-yellow-500 text-black border-yellow-400 shadow-[0_0_8px_rgba(234,179,8,0.4)]'
                        : 'bg-transparent text-white/40 border-white/15 hover:bg-white/5'
                      } disabled:opacity-25 disabled:cursor-not-allowed`}
                  >
                    SENSHU {senshuAka ? 'ON' : 'OFF'}
                  </button>
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {[1, 2, 3, 4, 5].map((level) => {
                    const isActive = c1Aka >= level;
                    const labels = ['', 'C1', 'C2', 'C3', 'HC', 'H'];
                    return (
                      <button
                        key={level}
                        onClick={() => handleTogglePenalty('aka', level)}
                        disabled={bout.status === 'Completed'}
                        className={`flex items-center justify-center h-8 lg:h-12 rounded-lg font-din text-lg lg:text-2xl xl:text-3xl font-black transition-all border cursor-pointer active:scale-90 disabled:opacity-25 disabled:cursor-not-allowed ${isActive
                            ? 'bg-red-500 text-black border-red-400 shadow-[0_0_12px_rgba(239,68,68,0.5)]'
                            : 'bg-transparent text-white/30 border-white/15 hover:bg-white/5'
                          }`}
                      >
                        {labels[level]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* TIMER Display & Control Panel (Middle Column) */}
          <section className="col-span-1 order-2 bg-white/[0.02] border border-white/5 rounded-xl p-1.5 lg:p-3 flex flex-col justify-between items-center text-center overflow-hidden flex-1 min-h-0">
            <span className="text-sm md:text-base lg:text-2xl uppercase font-black text-white/90 tracking-[0.25em] shrink-0 mb-0.5 lg:mb-0">MATCH TIMER</span>
            
            {/* Giant Timer */}
            <div className="flex-1 flex flex-col items-center justify-center w-full min-h-0 py-0.5">
              <div className={`font-din text-[62px] lg:text-[92px] xl:text-[116px] font-black leading-none select-none flex items-baseline justify-center tracking-[-0.08em] ${
                timeLeft <= 150 && timeLeft > 0 ? 'text-red-500 animate-pulse drop-shadow-[0_0_35px_rgba(239,68,68,0.85)]' : 'text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.5)]'
              }`}>
                <span>{formatMainTime(timeLeft)}</span>
                <span className={`font-din text-[24px] lg:text-[38px] xl:text-[44px] font-black ml-1 ${
                  timeLeft <= 150 && timeLeft > 0 ? 'text-red-500/70' : 'text-white/75'
                }`}>{formatDecsTime(timeLeft)}</span>
              </div>
              <div className="flex items-center justify-center gap-2 mt-1">
                <span className={`w-3 h-3 rounded-full ${timerActive ? 'bg-green-500 animate-ping' : 'bg-red-500'}`} />
                <span className="text-xs md:text-sm font-black uppercase text-white/80 tracking-[0.2em]">
                  {timerActive ? 'ACTIVE RUNNING' : timeLeft === 0 ? 'IDLE' : 'PAUSED'}
                </span>
              </div>
              {/* Decision Display on Operator Console */}
              {timeLeft === 0 && !timerActive && (
                <div className="mt-2 w-full flex flex-col items-center gap-1 animate-in fade-in duration-300">
                  {winnerSide === 'aka' ? (
                    <div className="bg-red-600 text-white font-black text-xs md:text-sm px-3.5 py-1.5 rounded-xl uppercase border-2 border-red-400 shadow-[0_0_20px_rgba(239,68,68,0.5)] tracking-wider text-center flex items-center justify-center gap-1.5 w-full">
                      <span>🏆 DECISION: AKA</span>
                      <span className="text-yellow-300 font-extrabold text-[10px] md:text-xs">
                        ({winMethod === 'SENSHU' ? 'SENSHU ADVANTAGE' : winMethod === 'Superior Points' ? 'SUPERIOR POINTS' : winMethod === 'Points' ? 'POINTS ADVANTAGE' : winMethod || 'POINTS ADVANTAGE'})
                      </span>
                    </div>
                  ) : winnerSide === 'ao' ? (
                    <div className="bg-blue-600 text-white font-black text-xs md:text-sm px-3.5 py-1.5 rounded-xl uppercase border-2 border-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.5)] tracking-wider text-center flex items-center justify-center gap-1.5 w-full">
                      <span>🏆 DECISION: AO</span>
                      <span className="text-yellow-300 font-extrabold text-[10px] md:text-xs">
                        ({winMethod === 'SENSHU' ? 'SENSHU ADVANTAGE' : winMethod === 'Superior Points' ? 'SUPERIOR POINTS' : winMethod === 'Points' ? 'POINTS ADVANTAGE' : winMethod || 'POINTS ADVANTAGE'})
                      </span>
                    </div>
                  ) : (
                    <button
                      onClick={handleConfirmResult}
                      className="bg-yellow-500 hover:bg-yellow-400 text-black font-black text-xs md:text-sm px-3.5 py-1.5 rounded-xl uppercase border-2 border-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.5)] tracking-wider text-center flex items-center justify-center gap-1.5 w-full animate-pulse cursor-pointer transition active:scale-95"
                    >
                      <span>⚖️ DECISION: HANTEI (TIED) — CLICK TO CHOOSE WINNER</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Integrated Controls */}
            <div className="w-full flex flex-col gap-1 pt-1 border-t border-white/10 shrink-0 pb-0.5">
              {/* Primary Controls */}
              <div className="w-full flex flex-col gap-1">
                <div className="flex items-stretch justify-center gap-1.5 w-full">
                  <div className="flex-1 max-w-[240px]">
                    {timerActive ? (
                      <button
                        onClick={handleStopTimer}
                        disabled={bout.status === 'Completed'}
                        className="w-full h-full py-3.5 lg:py-5 bg-red-600 hover:bg-red-500 text-white disabled:opacity-40 rounded-xl font-black text-[15px] sm:text-[17px] lg:text-[22px] uppercase tracking-[0.14em] flex items-center justify-center gap-1.5 transition cursor-pointer shadow-lg shadow-red-950/40 border border-red-400/40"
                      >
                        <Square className="h-5 w-5 lg:h-6 lg:w-6 fill-white" /> Stop Timer
                      </button>
                    ) : (
                      <button
                        onClick={handleStartTimer}
                        disabled={timeLeft === 0 || bout.status === 'Completed'}
                        className="w-full h-full py-3.5 lg:py-5 bg-green-600 hover:bg-green-500 text-white disabled:opacity-40 rounded-xl font-black text-[15px] sm:text-[17px] lg:text-[22px] uppercase tracking-[0.14em] flex items-center justify-center gap-1.5 transition cursor-pointer shadow-lg shadow-green-950/40 border border-green-400/40"
                      >
                        <Play className="h-5 w-5 lg:h-6 lg:w-6 fill-white" /> Start Timer
                      </button>
                    )}
                  </div>

                  <div className="flex w-[100px] flex-col gap-1.5">
                    <button
                      onClick={() => handleAdjustTime(1)}
                      disabled={timerActive || bout.status === 'Completed'}
                      className="w-full h-full bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white rounded-xl font-black text-[13px] sm:text-[14px] lg:text-lg uppercase tracking-[0.12em] transition cursor-pointer border border-white/20 shadow-sm"
                    >
                      +1s
                    </button>
                    <button
                      onClick={() => handleAdjustTime(-1)}
                      disabled={timerActive || bout.status === 'Completed'}
                      className="w-full h-full bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white rounded-xl font-black text-[13px] sm:text-[14px] lg:text-lg uppercase tracking-[0.12em] transition cursor-pointer border border-white/20 shadow-sm"
                    >
                      -1s
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1 w-full">
                  <button
                    onClick={handleResetTimer}
                    disabled={timerActive || bout.status === 'Completed'}
                    className="w-full h-full py-2 lg:py-2.5 bg-white/5 hover:bg-white/10 text-white disabled:opacity-30 rounded-lg font-black text-[10px] lg:text-xs uppercase tracking-wider flex items-center justify-center gap-1 transition cursor-pointer border border-white/10"
                  >
                    <RotateCcw className="h-3.5 w-3.5 lg:h-4 lg:w-4" /> Reset
                  </button>

                  <button
                    onClick={handleUndo}
                    disabled={history.length <= 1}
                    className="w-full h-full py-2 lg:py-2.5 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 disabled:opacity-30 border border-yellow-500/20 rounded-lg font-black text-[10px] lg:text-xs uppercase transition cursor-pointer flex items-center justify-center gap-1"
                  >
                    <RotateCcw className="h-3.5 w-3.5 lg:h-4 lg:w-4" /> Undo Action
                  </button>
                </div>
              </div>

              {/* Secondary Match Actions */}
              <div className="w-full mt-0.5">
                <div className="flex flex-col h-full">
                  <label className="block text-[8px] lg:text-[9px] uppercase font-bold text-gray-400 mb-0.5 text-left">Match Duration</label>
                  <div className="grid grid-cols-4 gap-1.5 w-full h-full">
                    {[
                      { val: 60, label: '1:00' },
                      { val: 90, label: '1:30' },
                      { val: 120, label: '2:00' },
                      { val: 180, label: '3:00' }
                    ].map(opt => (
                      <button
                        key={opt.val}
                        onClick={() => handleSetMatchDuration(opt.val)}
                        disabled={timerActive || bout.status === 'Completed'}
                        className={`flex items-center justify-center rounded-lg border text-[12px] sm:text-[13px] lg:text-base font-black transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed min-h-[34px] ${
                          matchDuration === opt.val
                            ? 'bg-yellow-500 text-black border-yellow-400 shadow-[0_0_8px_rgba(234,179,8,0.4)]'
                            : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* AO Display & Control Panel */}
          <section className={`col-span-1 order-3 border rounded-xl p-1.5 lg:p-3 flex flex-col justify-between items-center transition-all duration-500 overflow-hidden flex-1 min-h-0 ${
            winnerSide === 'ao'
              ? 'bg-blue-950/80 border-blue-500 shadow-[inset_0_0_80px_rgba(59,130,246,0.3),0_0_40px_rgba(59,130,246,0.6)]'
              : 'bg-gradient-to-b from-blue-950/20 via-blue-950/5 to-transparent border-blue-900/30'
          }`}>
            {/* Header & Fighter Name */}
            <div className="w-full flex flex-col items-center shrink-0">
              <div className="flex items-center justify-between w-full mb-1">
                <span className="text-4xl lg:text-6xl font-black uppercase tracking-widest text-blue-400 ml-auto">AO</span>
              </div>

              <div className="w-full text-center mt-0.5">
                <h2 className="font-competitor text-base md:text-lg lg:text-xl font-bold truncate max-w-full text-center uppercase leading-tight text-white tracking-tight" title={competitorAo?.full_name || 'TBD Blue'}>
                  {competitorAo?.full_name || 'TBD Blue'}
                </h2>
                <p className="text-xs md:text-sm font-semibold text-blue-400/80 text-center truncate max-w-full mt-0.5">
                  {getClubName(competitorAo) || '—'}
                </p>
              </div>
            </div>

            {/* Score & Technique Summary */}
            <div className="flex-1 min-h-0 py-0.5 w-full flex items-center gap-2">
              <div className={`flex-1 min-h-0 flex items-center justify-center ${aoScoreShiftClass}`}>
                <span className={`font-din ${aoScoreSizeClass} font-black leading-none tracking-tight select-none transition-all duration-300 ${
                  winnerSide === 'ao'
                    ? 'text-blue-400 animate-blink drop-shadow-[0_0_50px_rgba(59,130,246,0.95)] scale-105'
                    : scoreAo - scoreAka >= 8
                      ? 'text-blue-400 animate-pulse scale-105 drop-shadow-[0_0_50px_rgba(59,130,246,0.85)]'
                      : 'text-blue-400 drop-shadow-[0_0_40px_rgba(59,130,246,0.5)]'
                }`}>
                  {scoreAo}
                </span>
              </div>

              <div className={`${aoSummarySlotClass} shrink-0 self-center mr-1 lg:mr-2`}>
                  <div className={`w-full rounded-lg border border-blue-400/60 bg-blue-950/65 shadow-[0_0_12px_rgba(59,130,246,0.25)] ${aoSummaryBoxClass}`}>
                    <div className={`grid grid-cols-[auto_auto] justify-end gap-y-0.5 font-black uppercase tracking-wide text-blue-100 ${aoSummaryGridClass}`}>
                      <span className="whitespace-nowrap">Ippon</span>
                      <span className={`rounded bg-blue-500/20 border border-blue-400/30 text-right ${aoSummaryValueClass}`}>{aoTechniqueCounts.ippon}</span>
                      <span className="whitespace-nowrap">Waza-Ari</span>
                      <span className={`rounded bg-blue-500/20 border border-blue-400/30 text-right ${aoSummaryValueClass}`}>{aoTechniqueCounts.wazaAri}</span>
                      <span className="whitespace-nowrap">Yuko</span>
                      <span className={`rounded bg-blue-500/20 border border-blue-400/30 text-right ${aoSummaryValueClass}`}>{aoTechniqueCounts.yuko}</span>
                    </div>
                  </div>
              </div>
            </div>

            {/* AO Controls: Score Buttons + Penalties */}
            <div className="w-full flex flex-col gap-1.5 pt-1.5 border-t border-blue-900/30 shrink-0 pb-1">
              {/* Score Buttons */}
              <div className="grid grid-cols-3 gap-1 w-full">
                <button
                  onClick={() => handleAddScore('ao', 1)}
                  disabled={bout.status === 'Completed'}
                  className="py-1.5 lg:py-2 bg-blue-600/40 hover:bg-blue-600/60 border border-blue-500/30 rounded-lg flex flex-col items-center justify-center transition cursor-pointer active:scale-95 disabled:opacity-25 disabled:cursor-not-allowed"
                >
                  <span className="text-sm md:text-base lg:text-lg font-black uppercase tracking-wider leading-none">+1</span>
                  <span className="text-[9px] md:text-[10px] font-black uppercase tracking-wider leading-tight mt-0.5">Yuko</span>
                </button>
                <button
                  onClick={() => handleAddScore('ao', 2)}
                  disabled={bout.status === 'Completed'}
                  className="py-1.5 lg:py-2 bg-blue-600/40 hover:bg-blue-600/60 border border-blue-500/30 rounded-lg flex flex-col items-center justify-center transition cursor-pointer active:scale-95 disabled:opacity-25 disabled:cursor-not-allowed"
                >
                  <span className="text-sm md:text-base lg:text-lg font-black uppercase tracking-wider leading-none">+2</span>
                  <span className="text-[9px] md:text-[10px] font-black uppercase tracking-wider leading-tight mt-0.5">Waza-ari</span>
                </button>
                <button
                  onClick={() => handleAddScore('ao', 3)}
                  disabled={bout.status === 'Completed'}
                  className="py-1.5 lg:py-2 bg-blue-600/40 hover:bg-blue-600/60 border border-blue-500/30 rounded-lg flex flex-col items-center justify-center transition cursor-pointer active:scale-95 disabled:opacity-25 disabled:cursor-not-allowed"
                >
                  <span className="text-sm md:text-base lg:text-lg font-black uppercase tracking-wider leading-none">+3</span>
                  <span className="text-[9px] md:text-[10px] font-black uppercase tracking-wider leading-tight mt-0.5">Ippon</span>
                </button>
              </div>

              {/* Penalties Row */}
              <div className="w-full">
                <div className="flex items-center justify-end mb-0.5">
                  <button
                    onClick={() => handleToggleSenshu('ao')}
                    disabled={bout.status === 'Completed'}
                    className={`text-sm lg:text-lg font-black uppercase px-4 py-2 lg:py-3 rounded border transition cursor-pointer ${senshuAo
                        ? 'bg-yellow-500 text-black border-yellow-400 shadow-[0_0_8px_rgba(234,179,8,0.4)]'
                        : 'bg-transparent text-white/40 border-white/15 hover:bg-white/5'
                      } disabled:opacity-25 disabled:cursor-not-allowed`}
                  >
                    SENSHU {senshuAo ? 'ON' : 'OFF'}
                  </button>
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {[1, 2, 3, 4, 5].map((level) => {
                    const isActive = c1Ao >= level;
                    const labels = ['', 'C1', 'C2', 'C3', 'HC', 'H'];
                    return (
                      <button
                        key={level}
                        onClick={() => handleTogglePenalty('ao', level)}
                        disabled={bout.status === 'Completed'}
                        className={`flex items-center justify-center h-8 lg:h-12 rounded-lg font-din text-lg lg:text-2xl xl:text-3xl font-black transition-all border cursor-pointer active:scale-90 disabled:opacity-25 disabled:cursor-not-allowed ${isActive
                            ? 'bg-blue-500 text-black border-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.5)]'
                            : 'bg-transparent text-white/30 border-white/15 hover:bg-white/5'
                          }`}
                      >
                        {labels[level]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

        </div>
      </main>

      {/* Keyboard guide footer / Function Dock */}
      <footer className="bg-[#0e0e14] border-t border-white/10 px-4 py-2 flex items-center justify-between text-[10px] text-gray-400 font-semibold shrink-0 flex-wrap gap-2 shadow-2xl z-20">
        <div className="flex gap-2.5 items-center">
          <span>Shortcuts:</span>
          <span><b className="text-gray-400">Space</b> Start/Stop</span>
          <span><b className="text-gray-400">R/U</b> AKA/AO +1</span>
          <span><b className="text-gray-400">F/J</b> AKA/AO +2</span>
          <span><b className="text-gray-400">V/M</b> AKA/AO +3</span>
          <span><b className="text-gray-400">Backspace</b> Undo</span>
          <span><b className="text-gray-400">Enter</b> Override</span>
        </div>

        <div className="flex gap-1.5 items-center ml-auto flex-wrap justify-end">
          {/* Standby / Idle Screen Toggle: 1st click = display Standby, 2nd click = back action */}
          <button
            onClick={handleToggleStandby}
            title={isStandbyActive ? 'Click to exit Standby and return to live match display' : 'Display Idle / Standby Screen on Spectator Display'}
            className={`flex items-center gap-1 px-2.5 py-1 font-black text-[10px] uppercase tracking-wider rounded-lg transition cursor-pointer active:scale-95 border ${
              isStandbyActive
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30 animate-pulse'
                : 'bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border-yellow-500/20'
            }`}
          >
            <Clock className="h-3 w-3" /> {isStandbyActive ? 'EXIT STANDBY' : 'STANDBY'}
          </button>

          {/* Clear All Result */}
          <button
            onClick={handleClearAllResult}
            disabled={saving}
            className="flex items-center gap-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 disabled:opacity-40 text-white font-black text-[10px] uppercase tracking-wider rounded-lg transition cursor-pointer active:scale-95 border border-white/15"
          >
            <RotateCcw className="h-3 w-3" /> Clear All Result
          </button>

          {/* CONFIRM RESULT / REVERSE RESULT — 1st click confirms & shows Winner Page, 2nd click reverses back */}
          <button
            onClick={handleConfirmResult}
            disabled={saving || (bout.status === 'Completed' && !resultConfirmed)}
            title={resultConfirmed ? 'Click to reverse back and restore live scoreboard' : !winnerSide ? 'No winner determined yet' : 'Confirm result and show Winner Page on Referee View'}
            className={`flex items-center gap-1 px-2.5 py-1 font-black text-[10px] uppercase tracking-wider rounded-lg transition cursor-pointer active:scale-95 border ${
              resultConfirmed
                ? 'bg-yellow-500 hover:bg-yellow-400 text-black border-yellow-400 shadow-md shadow-yellow-500/20'
                : winnerSide && timeLeft === 0
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-black border-emerald-400 shadow-md shadow-emerald-500/20 animate-pulse'
                  : 'bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border-emerald-600/30 disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            {resultConfirmed ? <RotateCcw className="h-3 w-3" /> : <Check className="h-3 w-3" />}
            {resultConfirmed ? '↩ Reverse Result' : 'Confirm Result'}
          </button>

          {/* Rematch (conditional) */}
          {(winnerSide || bout.status === 'Completed') && (
            <button
              onClick={handleRematch}
              disabled={saving}
              className="flex items-center gap-1 px-2.5 py-1 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-black text-[10px] uppercase tracking-wider rounded-lg transition cursor-pointer active:scale-95 shadow-md shadow-red-600/10"
            >
              <RotateCcw className="h-3 w-3" /> Rematch
            </button>
          )}

          {/* SAVE RESULT */}
          <button
            onClick={handleSaveResult}
            disabled={saving || !bout}
            title={resultSaved || bout.status === 'Completed' ? 'Result saved (click to update/re-save)' : 'Save result to database and mark bout Completed'}
            className={`flex items-center gap-1 px-2.5 py-1 font-black text-[10px] uppercase tracking-wider rounded-lg transition cursor-pointer active:scale-95 border ${
              saving
                ? 'bg-yellow-500/50 text-black border-yellow-400 cursor-wait'
                : resultSaved || bout.status === 'Completed'
                  ? 'bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-300 border-emerald-500/40 shadow-sm'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 shadow-md shadow-emerald-600/20'
            }`}
          >
            {saving ? (
              <><RefreshCw className="h-3 w-3 animate-spin" /> Saving...</>
            ) : resultSaved || bout.status === 'Completed' ? (
              <><Check className="h-3 w-3" /> Saved</>
            ) : (
              <><Save className="h-3 w-3" /> Save Result</>
            )}
          </button>

          {/* NEXT MATCH — Stage 3 of 3: appears after result is saved */}
          {(resultSaved || bout.status === 'Completed') && (
            <button
              onClick={handleNextMatch}
              className="flex items-center gap-1 px-2.5 py-1 bg-cyan-500 hover:bg-cyan-400 text-black font-black text-[10px] uppercase tracking-wider rounded-lg transition cursor-pointer active:scale-95 shadow-md shadow-cyan-500/20"
            >
              <ArrowRight className="h-3 w-3" /> Next Match
            </button>
          )}
        </div>
      </footer>

      {/* Save Result / Finish Match Modal */}
      {showFinishModal && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-4 md:p-6 animate-in fade-in duration-200">
          <div className={`bg-[#0d0d12] border w-[98vw] max-w-[1100px] rounded-[32px] p-8 md:p-10 shadow-2xl transition-all duration-300 ${
            winMethod === 'Superior Points'
              ? 'border-green-500 shadow-[0_0_55px_rgba(34,197,94,0.45)]'
              : winnerSide === 'aka'
              ? 'border-red-500/60 shadow-[0_0_55px_rgba(239,68,68,0.32)]'
              : winnerSide === 'ao'
              ? 'border-blue-500/60 shadow-[0_0_55px_rgba(59,130,246,0.32)]'
              : 'border-yellow-500/60 shadow-[0_0_55px_rgba(234,179,8,0.35)]'
          }`}>
            <div className="flex justify-between items-start mb-8">
              <div className="flex items-center gap-4">
                <MedalIcon className="h-9 w-9 text-yellow-400" />
                <div>
                  <h3 className="text-6xl md:text-7xl font-black tracking-tight text-white uppercase">Confirm Match Result</h3>
                  <p className="text-[14px] md:text-[15px] text-white/50 font-bold uppercase tracking-wider">WKF Official Kumite Decision</p>
                </div>
              </div>
              <button
                onClick={() => setShowFinishModal(false)}
                className="p-3 hover:bg-white/5 rounded-xl text-gray-400 hover:text-white cursor-pointer"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="space-y-7 md:space-y-8">
              {/* Decision Announcement Banner */}
              {winnerSide ? (
                <div className={`border rounded-2xl p-6 md:p-7 text-xs font-black text-center tracking-wider uppercase flex flex-col items-center gap-2 ${
                  winnerSide === 'aka'
                    ? 'bg-red-500/15 border-red-500/40 text-red-300'
                    : 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                }`}>
                  <span className="text-[13px] md:text-[14px] text-white/60 tracking-widest font-extrabold">PROJECTED WINNER</span>
                  <span className="text-4xl md:text-5xl font-black">
                    🏆 {winnerSide === 'aka' ? 'AKA' : 'AO'} — {winnerSide === 'aka' ? competitorAka?.full_name : competitorAo?.full_name}
                  </span>
                  <span className="text-[13px] md:text-[14px] px-4 py-2 rounded-full bg-white/10 text-yellow-400 font-extrabold mt-0.5">
                    DECISION: {winMethod === 'Points' ? 'POINTS ADVANTAGE' : winMethod === 'SENSHU' ? 'SENSHU ADVANTAGE (FIRST SCORE)' : winMethod === 'Superior Points' ? 'SUPERIOR POINTS' : winMethod === 'Hantei' ? 'HANTEI DECISION' : winMethod === 'HANSOKU' ? 'HANSOKU DISQUALIFICATION' : winMethod || 'POINTS ADVANTAGE'}
                  </span>
                </div>
              ) : (
                <div className="bg-yellow-500/15 border border-yellow-500/40 text-yellow-400 rounded-2xl p-6 md:p-7 text-3xl md:text-4xl font-black text-center tracking-wider uppercase animate-pulse">
                  ⚖️ TIED SCORE ({scoreAka} - {scoreAo}) — HANTEI (REFEREE VOTE) REQUIRED
                </div>
              )}

              <div>
                <label className="block text-[13px] md:text-[14px] uppercase font-bold text-gray-400 mb-3">Select / Confirm Winner</label>
                <div className="grid grid-cols-2 gap-5 md:gap-6">
                  <button
                    onClick={() => { setWinnerSide('aka'); setWinnerConfirmed(true); }}
                    className={`py-6 px-6 rounded-2xl border text-2xl md:text-3xl font-black transition cursor-pointer flex flex-col items-center justify-center ${
                      winnerSide === 'aka'
                        ? 'bg-red-600 text-white border-red-500 shadow-lg shadow-red-950/40'
                        : 'bg-transparent text-white/50 border-white/10 hover:border-white/20'
                    }`}
                  >
                    <span>AKA ({competitorAka?.full_name?.split(' ')[0] || 'Red'})</span>
                    <span className="text-[10px] md:text-[11px] font-bold text-red-300/80 mt-1 uppercase tracking-widest">{getClubName(competitorAka) || '—'}</span>
                  </button>
                  <button
                    onClick={() => { setWinnerSide('ao'); setWinnerConfirmed(true); }}
                    className={`py-6 px-6 rounded-2xl border text-2xl md:text-3xl font-black transition cursor-pointer flex flex-col items-center justify-center ${
                      winnerSide === 'ao'
                        ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-950/40'
                        : 'bg-transparent text-white/50 border-white/10 hover:border-white/20'
                    }`}
                  >
                    <span>AO ({competitorAo?.full_name?.split(' ')[0] || 'Blue'})</span>
                    <span className="text-[10px] md:text-[11px] font-bold text-blue-300/80 mt-1 uppercase tracking-widest">{getClubName(competitorAo) || '—'}</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[13px] md:text-[14px] uppercase font-bold text-gray-400 mb-3">Winning Decision Method</label>
                <select
                  value={winMethod}
                  onChange={e => setWinMethod(e.target.value)}
                  className="w-full bg-[#101015] border border-white/10 rounded-xl px-4 py-4 text-2xl md:text-3xl text-white focus:outline-none focus:border-yellow-400 transition cursor-pointer font-sans"
                >
                  <option value="Points">Points Advantage (Lead Differential)</option>
                  <option value="SENSHU">Senshu Advantage (First Uncontested Score)</option>
                  <option value="Superior Points">Superior Points (Highest Technique Ippon/Waza-ari)</option>
                  <option value="Hantei">Hantei (Referees Flag Vote)</option>
                  <option value="HANSOKU">Hansoku (Opponent Disqualification)</option>
                  <option value="Kiken">Kiken (Opponent Withdrawal / Injury)</option>
                </select>
              </div>

              <div className="bg-[#121218] rounded-xl p-5 md:p-6 border border-white/5 flex items-center justify-between text-2xl md:text-3xl font-bold">
                <span className="text-gray-400">Final Match Score</span>
                <span className="font-mono text-4xl md:text-5xl tracking-widest text-yellow-400">
                  {scoreAka} - {scoreAo}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 mt-6">
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={() => {
                    if (!winnerSide) return;
                    resultConfirmedRef.current = true;
                    setResultConfirmed(true);
                    setWinnerConfirmed(true);
                    setShowFinishModal(false);

                    // Broadcast confirmed result to Referee View so Winner Page displays only NOW
                    if (typeof window !== 'undefined') {
                      try {
                        const channel = new BroadcastChannel('wkf-scoreboard-sync');
                        channel.postMessage({
                          type: 'SHOW_RESULT',
                          resultConfirmed: true,
                          winnerSide: winnerSide,
                          winner: winnerSide,
                          winMethod: winMethod,
                          akaName: competitorAka?.full_name || 'AKA Red',
                          akaClub: getClubName(competitorAka),
                          aoName: competitorAo?.full_name || 'AO Blue',
                          aoClub: getClubName(competitorAo),
                          scoreAka,
                          scoreAo,
                          boutId
                        });
                        channel.close();
                      } catch (err) {}
                    }

                    if (onLogEvent) onLogEvent('SYSTEM', `Match Result Confirmed — Winner: ${winnerSide.toUpperCase()} (${winMethod})`);
                  }}
                  disabled={saving || !winnerSide}
                  className="py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black text-[14px] md:text-[16px] font-black uppercase tracking-wider rounded-xl transition cursor-pointer flex items-center justify-center gap-2 shadow-md shadow-emerald-500/20"
                >
                  <Trophy className="h-5 w-5" /> Confirm Result
                </button>
                <button
                  onClick={() => {
                    if (!winnerSide) return;
                    resultConfirmedRef.current = true;
                    setResultConfirmed(true);
                    setWinnerConfirmed(true);
                    handleSaveResult();
                  }}
                  disabled={saving || !winnerSide}
                  className="py-4 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 text-black text-[14px] md:text-[16px] font-black uppercase tracking-wider rounded-xl transition cursor-pointer flex items-center justify-center gap-2 shadow-md shadow-yellow-500/20"
                >
                  {saving ? (
                    <><RefreshCw className="h-5 w-5 animate-spin" /> Saving...</>
                  ) : (
                    <><Check className="h-5 w-5" /> Confirm & Save</>
                  )}
                </button>
              </div>
              <button
                onClick={() => setShowFinishModal(false)}
                className="w-full py-3 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/10 text-sm md:text-base font-black uppercase tracking-wider rounded-xl transition cursor-pointer"
              >
                Cancel / Adjust Scores
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Display Playlist Manager Modal */}
      <DisplayPlaylistModal
        isOpen={isPlaylistModalOpen}
        onClose={() => setIsPlaylistModalOpen(false)}
      />
    </div>
  );
});

export default function ScoreboardControlPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#07070a] flex items-center justify-center text-white/40 font-bold uppercase tracking-widest text-xs">Loading Kumite Control Panel...</div>}>
      <KumiteScoreboardControl />
    </Suspense>
  );
}
