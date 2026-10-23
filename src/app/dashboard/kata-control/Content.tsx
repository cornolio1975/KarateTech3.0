'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { db, basePath } from '@/db/dbClient';
import { Bout, Participant, Category, Club, isKataCategory } from '@/db/types';
import { Zap, Play, Check, ShieldAlert, Award, ArrowRight, RefreshCw, Calendar, MapPin, Tv, Trophy, Sparkles, CheckCircle2, ChevronRight, FileText, Flag, Save, RotateCcw, Square, Maximize2, Minimize2, Lock, BookOpen } from 'lucide-react';
import { useTournament } from '@/context/TournamentContext';
import KataResultBookModal from '@/components/KataResultBookModal';
import KataListModal from '@/components/KataListModal';

const OFFICIAL_WKF_KATAS = [
  'Anan', 'Anan Dai', 'Ananko', 'Aoyagi', 'Bassai', 'Bassai Dai', 'Bassai Sho', 'Chatanyara Kushanku',
  'Chibana No Kushanku', 'Chinte', 'Chinto', 'Enpi', 'Fukyugata Ichi', 'Fukyugata Ni', 'Gankaku', 'Garyu',
  'Gekisai (Geksai) 1', 'Gekisai (Geksai) 2', 'Gojushiho', 'Gojushiho Dai', 'Gojushiho Sho', 'Hakusho',
  'Hangetsu', 'Haufa (Haffa)', 'Heian Shodan', 'Heian Nidan', 'Heian Sandan', 'Heian Yondan', 'Heian Godan',
  'Heiku', 'Ishimine Bassai', 'Itosu Rohai Shodan', 'Itosu Rohai Nidan', 'Itosu Rohai Sandan', 'Jiin',
  'Jion', 'Jitte', 'Juroku', 'Kanchin', 'Kanku Dai', 'Kanku Sho', 'Kanshu', 'Kishimoto No Kushanku',
  'Kousoukun', 'Kousoukun Dai', 'Kousoukun Sho', 'Kururunfa', 'Kushanku', 'Kyan No Chinto', 'Kyan No Wanshu',
  'Matsukaze', 'Matsumura Bassai', 'Matsumura Rohai', 'Meikyo', 'Myojo', 'Naifanchin Shodan', 'Naifanchin Nidan',
  'Naifanchin Sandan', 'Naihanchi', 'Nijushiho', 'Nipaipo', 'Niseishi', 'Ohan', 'Ohan Dai', 'Oyadomari No Passai',
  'Pachu', 'Paiku', 'Papuren', 'Passai', 'Pinan Shodan', 'Pinan Nidan', 'Pinan Sandan', 'Pinan Yondan',
  'Pinan Godan', 'Rohai', 'Saifa', 'Sanchin', 'Sansai', 'Sanseiru', 'Sanseru', 'Seichin', 'Seienchin (Seiyunchin)',
  'Seipai', 'Seiryu', 'Seishan', 'Seisan (Sesan)', 'Shiho Kousoukun', 'Shinpa', 'Shinsei', 'Shisochin',
  'Sochin', 'Suparinpei', 'Tekki Shodan', 'Tekki Nidan', 'Tekki Sandan', 'Tensho', 'Tomari Bassai', 'Unshu',
  'Unsu', 'Usheishi', 'Wankan', 'Wanshu'
];

import { ScoreboardRef } from '../control/page';

export const KataControlPanelContent = React.forwardRef<ScoreboardRef, { boutId?: string, onClose?: () => void, onLogEvent?: (category: 'SCORE'|'PENALTY'|'TIMER'|'SYSTEM', msg: string) => void }>(({ boutId: propBoutId, onClose, onLogEvent }, ref) => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const boutId = propBoutId || searchParams.get('boutId');
  const catId = searchParams.get('catId');
  const { tournamentName, acquireLock, releaseLock, activeTournamentId, activeLocks, tatamiId, updateTatamiTelemetry, userEmail, takeoverTatami } = useTournament();
  
  const spectatorWindowRef = React.useRef<Window | null>(null);
  const broadcastChannelRef = React.useRef<BroadcastChannel | null>(null);
  const scoringConsoleRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);

  const handleRematchKata = async () => {
    if (!currentBout) return;
    const confirmRematch = window.confirm(`Reset and rematch Kata bout R${currentBout.round_no}B${currentBout.bout_no}?`);
    if (!confirmRematch) return;
    try {
      await db.bouts.updateBoutState(currentBout.id, {
        status: 'Running',
        score_a: 0,
        score_b: 0,
        total_score_a: 0,
        total_score_b: 0,
        judge_scores_a: [],
        judge_scores_b: [],
        winner_id: null,
        victory_method: ''
      });
      setJudgeScoresA(Array(panelSize).fill(scoringMethod === 'Flags' ? 0 : 8.0));
      setJudgeScoresB(Array(panelSize).fill(scoringMethod === 'Flags' ? 0 : 8.0));
      setSelectedWinnerId(null);
      setIsWinnerRevealed(false);
      setPenaltyH(null);
      if (onLogEvent) onLogEvent('SYSTEM', `Kata bout R${currentBout.round_no}B${currentBout.bout_no} reset for rematch`);
    } catch (e) {
      console.error('Error resetting Kata rematch:', e);
    }
  };

  React.useImperativeHandle(ref, () => ({
    undoLastAction: () => {}, // No-op for Kata
    confirmResult: () => handleSaveAndCompleteBout(),
    saveResult: () => handleSaveAndCompleteBout(),
    rematch: () => handleRematchKata()
  }));
  const [isLockedByOther, setIsLockedByOther] = useState<boolean>(false);
  const [bouts, setBouts] = useState<Bout[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);

  // Selection state
  const [selectedCatId, setSelectedCatId] = useState<string>('ALL');
  const [selectedBoutId, setSelectedBoutId] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [panelSize, setPanelSize] = useState<7 | 5>(5); // 5-judge panel standard

  // Current active bout state
  const [currentBout, setCurrentBout] = useState<Bout | null>(null);
  const [kataA, setKataA] = useState<string>('Suparinpei');
  const [kataB, setKataB] = useState<string>('Anan Dai');
  const [judgeScoresA, setJudgeScoresA] = useState<number[]>([1, 1, 1, 0, 0]);
  const [judgeScoresB, setJudgeScoresB] = useState<number[]>([0, 0, 0, 0, 0]);
  const [activeScoringTab, setActiveScoringTab] = useState<'AKA' | 'AO'>('AKA');
  const [scoringMethod, setScoringMethod] = useState<'Points' | 'Flags'>('Flags');
  const [selectedWinnerId, setSelectedWinnerId] = useState<string | null>(null);
  const [isKataListOpen, setIsKataListOpen] = useState<boolean>(false);
  const [isWinnerRevealed, setIsWinnerRevealed] = useState<boolean>(false);
  const [penaltyH, setPenaltyH] = useState<'AKA' | 'AO' | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // Timer state
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isTimerRunning && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            setIsTimerRunning(false);
            return 0;
          }
          return prev - 1;
        });
      }, 100);
    } else if (timeLeft <= 0) {
      setIsTimerRunning(false);
      if (timeLeft < 0) setTimeLeft(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isTimerRunning, timeLeft]);

  // Category Lock Management
  useEffect(() => {
    let isActive = true;
    
    if (catId && activeTournamentId) {
      acquireLock(catId).then(res => {
        if (isActive && !res.success) {
          setIsLockedByOther(true);
        }
      });
    }

    return () => {
      isActive = false;
      if (catId && activeTournamentId && !isLockedByOther) {
        releaseLock(catId);
      }
    };
  }, [catId, activeTournamentId, acquireLock, releaseLock, isLockedByOther]);

  const formatMainTime = (tenths: number) => {
    const mins = Math.floor(tenths / 600);
    const secs = Math.floor((tenths % 600) / 10);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDecsTime = (tenths: number) => {
    const decs = tenths % 10;
    return `.${decs}`;
  };

  const setTimerPreset = (secs: number) => {
    setTimeLeft(secs * 10);
    setIsTimerRunning(false);
  };

  const openSpectatorWindow = (targetBoutId?: string, targetMode: 'new-tab' | 'new-window' = 'new-tab') => {
    const bId = targetBoutId || selectedBoutId || currentBout?.id;
    if (!bId) return;
    const specUrl = `${window.location.origin}${basePath}/display?boutId=${bId}&mode=${scoringMethod}&panelSize=${panelSize}`;
    if (targetMode === 'new-window') {
      spectatorWindowRef.current = window.open(specUrl, 'SpectatorDisplay', 'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no');
    } else {
      spectatorWindowRef.current = window.open(specUrl, '_blank');
    }
  };

  // Modal state
  const [showSpectatorModal, setShowSpectatorModal] = useState(false);
  const [isResultBookOpen, setIsResultBookOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setMounted(true);
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [bList, pList, catList, clList] = await Promise.all([
        db.bouts.list(),
        db.participants.list(),
        db.categories.list(),
        db.clubs.list(),
      ]);
      
      // Filter kata-relevant categories if name contains Kata or default all
      setBouts(bList);
      setParticipants(pList);
      setCategories(catList);
      setClubs(clList);

      // Filter for Kata bouts only when auto-selecting default bout
      const kataOnlyBouts = bList.filter(b => {
        const cat = catList.find(c => c.id === b.category_id);
        if (!isKataCategory(cat)) return false;
        
        // Don't auto-load bouts that are locked by other tatamis
        const myTatami = `Tatami ${tatamiId || 1}`;
        const lock = activeLocks.find(l => l.category_id === b.category_id && l.is_active);
        if (lock && lock.tatami !== myTatami) return false;
        
        return true;
      });

      if (bList.length > 0) {
        const targetBout = boutId ? bList.find(b => b.id === boutId) : null;
        const activeBout = targetBout || kataOnlyBouts.find(b => b.status === 'Running') || kataOnlyBouts[0] || bList[0];
        if (activeBout) {
          selectBout(activeBout);
        }
      }
    } catch (err) {
      console.error('Error loading Kata control data:', err);
    } finally {
      setLoading(false);
    }
  };

  const [spectatorConnected, setSpectatorConnected] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      const channel = new BroadcastChannel('wkf-scoreboard-sync');
      broadcastChannelRef.current = channel;
      // Ping to check if already connected
      channel.postMessage({ type: 'PING' });
    }
    return () => {
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (boutId && bouts.length > 0) {
      const targetBout = bouts.find(b => b.id === boutId);
      if (targetBout && targetBout.id !== selectedBoutId) {
        selectBout(targetBout);
      }
    }
  }, [boutId, bouts, selectedBoutId]);

  const selectBout = async (bout: Bout) => {
    // --- ADMIN LOCK CHECK ---
    const myTatami = `Tatami ${tatamiId || 1}`;
    const lock = activeLocks.find(l => l.category_id === bout.category_id && l.is_active);
    if (lock && lock.tatami !== myTatami) {
      if (typeof window !== 'undefined') {
        alert(`CATEGORY ALREADY IN USE\nThis category is currently being managed by ${lock.tatami?.toUpperCase()}. Please select another category.`);
      }
      return;
    }

    const lockResult = await acquireLock(bout.category_id);
    if (!lockResult.success) {
      if (typeof window !== 'undefined') {
        alert(`CATEGORY ALREADY IN USE\nThis category is currently being managed by another Tatami. Please select another category.`);
      }
      return;
    }

    setCurrentBout(bout);
    setSelectedBoutId(bout.id);
    setSelectedCatId(bout.category_id);
    if (bout.winner_id) setIsWinnerRevealed(true);
    else setIsWinnerRevealed(false);
    setSelectedWinnerId(bout.winner_id || null);

    setKataA(bout.kata_a || 'Suparinpei');
    setKataB(bout.kata_b || 'Anan Dai');

    const defaultScoresA = bout.judge_scores_a && bout.judge_scores_a.length > 0 
      ? bout.judge_scores_a 
      : (scoringMethod === 'Flags' ? [0, 0, 0, 0, 0] : [8.2, 8.4, 8.1, 8.3, 8.5]);
    const defaultScoresB = bout.judge_scores_b && bout.judge_scores_b.length > 0 
      ? bout.judge_scores_b 
      : (scoringMethod === 'Flags' ? [0, 0, 0, 0, 0] : [8.0, 8.2, 8.3, 8.1, 8.4]);

    setJudgeScoresA(defaultScoresA.slice(0, panelSize));
    setJudgeScoresB(defaultScoresB.slice(0, panelSize));
    
    // Auto-detect if loaded bout was a Flags match
    if (bout.judge_scores_a && bout.judge_scores_a.length > 0) {
      const isFlagsMatch = bout.judge_scores_a.every(s => s === 0 || s === 1) && bout.judge_scores_b?.every(s => s === 0 || s === 1);
      if (isFlagsMatch) {
        setScoringMethod('Flags');
      } else {
        setScoringMethod('Points');
      }
    }
    setSelectedWinnerId(bout.winner_id || null);
    setIsWinnerRevealed(bout.status === 'Completed' || !!bout.winner_id);
    
    // Auto-detect H penalty if previously saved
    if (bout.victory_method && (bout.victory_method.includes('Supreme Judge H Decision') || bout.victory_method.includes('Chief Judge H Decision') || bout.victory_method.includes('Chief Judge Decision'))) {
      if (bout.victory_method.includes('AKA')) {
        setPenaltyH('AKA');
      } else if (bout.victory_method.includes('AO')) {
        setPenaltyH('AO');
      }
    } else {
      setPenaltyH(null);
    }
  };

  // Helper to trim High (MAX) and Low (MIN) scores and calculate Total Score
  const calculateTotalScore = (scores: number[], method: 'Points' | 'Flags' = scoringMethod) => {
    if (!scores || scores.length === 0) return 0;
    if (method === 'Flags') return scores.reduce((a, b) => a + b, 0);
    if (scores.length <= 2) return scores.reduce((a, b) => a + b, 0);

    const sorted = [...scores].sort((a, b) => a - b);
    const minVal = sorted[0];
    const maxVal = sorted[sorted.length - 1];

    let minRemoved = false;
    let maxRemoved = false;

    const trimmed = scores.filter(s => {
      if (s === minVal && !minRemoved) {
        minRemoved = true;
        return false;
      }
      if (s === maxVal && !maxRemoved) {
        maxRemoved = true;
        return false;
      }
      return true;
    });

    return trimmed.reduce((a, b) => a + b, 0);
  };

  const totalScoreA = calculateTotalScore(judgeScoresA, scoringMethod);
  const totalScoreB = calculateTotalScore(judgeScoresB, scoringMethod);

  // Participant & Category lookups
  const participantA = participants.find(p => p.id === currentBout?.participant_a_id);
  const participantB = participants.find(p => p.id === currentBout?.participant_b_id);
  const clubA = clubs.find(c => c.id === participantA?.club_id);
  const clubB = clubs.find(c => c.id === participantB?.club_id);
  const category = categories.find(c => c.id === currentBout?.category_id);

  // Broadcast state updates in real-time for spectator display
  const broadcastKataState = React.useCallback(() => {
    if (!broadcastChannelRef.current || !currentBout) return;
    const effectiveTatami = (takeoverTatami || tatamiId || (userEmail === 'tatami_2@spsportdatasolution.org' ? 2 : userEmail === 'tatami_1@spsportdatasolution.org' ? 1 : (currentBout?.tatami === 'Tatami 2' ? 2 : 1))) as 1 | 2;

    broadcastChannelRef.current.postMessage({
      type: 'SYNC_MATCH_STATE',
      boutId: currentBout.id,
      categoryId: currentBout.category_id,
      tatami: `Tatami ${effectiveTatami}`,
      roundNo: currentBout.round_no,
      boutNo: currentBout.bout_no,
      matchCode: `R${currentBout.round_no}B${currentBout.bout_no}`,
      isKata: true,
      akaName: participantA?.full_name || 'AKA',
      akaClub: clubA?.name || (participantA as any)?.dojo || (participantA as any)?.club || '',
      aoName: participantB?.full_name || 'AO',
      aoClub: clubB?.name || (participantB as any)?.dojo || (participantB as any)?.club || '',
      scoreAka: totalScoreA,
      scoreAo: totalScoreB,
      kataA,
      kataB,
      judgeScoresA,
      judgeScoresB,
      panelSize,
      scoringMethod,
      winner: isWinnerRevealed ? (selectedWinnerId === participantA?.id ? 'aka' : selectedWinnerId === participantB?.id ? 'ao' : null) : null,
      winMethod: isWinnerRevealed ? (selectedWinnerId === participantA?.id ? 'AKA WIN' : selectedWinnerId === participantB?.id ? 'AO WIN' : 'TIE') : '',
      penaltyH,
      timeLeft,
      timerActive: isTimerRunning,
      resultConfirmed: currentBout?.status === 'Completed'
    });
  }, [currentBout, participantA, participantB, clubA, clubB, totalScoreA, totalScoreB, kataA, kataB, judgeScoresA, judgeScoresB, scoringMethod, isWinnerRevealed, selectedWinnerId, penaltyH, timeLeft, isTimerRunning, takeoverTatami, tatamiId, userEmail]);

  useEffect(() => {
    if (mounted && currentBout) {
      broadcastKataState();

      const effectiveTatami = (takeoverTatami || tatamiId || (userEmail === 'tatami_2@spsportdatasolution.org' ? 2 : userEmail === 'tatami_1@spsportdatasolution.org' ? 1 : (currentBout?.tatami === 'Tatami 2' ? 2 : 1))) as 1 | 2;

      try {
        localStorage.setItem(`kt_active_bout_id_${effectiveTatami}`, currentBout.id);
        localStorage.setItem(`ts_active_bout_id_${effectiveTatami}`, currentBout.id);
        localStorage.setItem('kt_active_bout_id', currentBout.id);
        localStorage.setItem('ts_active_bout_id', currentBout.id);
      } catch (e) {}

      updateTatamiTelemetry({
        tatamiId: effectiveTatami,
        currentCategoryId: currentBout.category_id,
        currentMatchId: currentBout.id,
        currentMatchCode: `R${currentBout.round_no}B${currentBout.bout_no}`,
        currentBoutNo: currentBout.bout_no,
        currentScreenState: 'Kata Scoreboard (Live)',
        status: 'online'
      });
    }
  }, [mounted, currentBout, judgeScoresA, judgeScoresB, kataA, kataB, panelSize, scoringMethod, totalScoreA, totalScoreB, isWinnerRevealed, selectedWinnerId, timeLeft, isTimerRunning, broadcastKataState, takeoverTatami, tatamiId, userEmail, updateTatamiTelemetry]);

  useEffect(() => {
    const channel = broadcastChannelRef.current;
    if (!channel) return;
    
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'SPECTATOR_CONNECTED' || event.data.type === 'PONG') {
        setSpectatorConnected(true);
        if (event.data.type === 'SPECTATOR_CONNECTED') {
          // A new spectator joined, send the current state immediately
          broadcastKataState();
        }
      } else if (event.data.type === 'SPECTATOR_DISCONNECTED') {
        setSpectatorConnected(false);
      }
    };

    channel.addEventListener('message', handleMessage);
    return () => {
      channel.removeEventListener('message', handleMessage);
    };
  }, [broadcastKataState]);

  const updateJudgeScore = (athlete: 'AKA' | 'AO', idx: number, val: number) => {
    setIsWinnerRevealed(false);
    const clamped = Math.max(5.0, Math.min(10.0, Math.round(val * 10) / 10));
    if (athlete === 'AKA') {
      const copy = [...judgeScoresA];
      copy[idx] = clamped;
      setJudgeScoresA(copy);
      if (onLogEvent) onLogEvent('SCORE', `AKA Judge ${idx + 1} score set to ${clamped.toFixed(1)}`);
    } else {
      const copy = [...judgeScoresB];
      copy[idx] = clamped;
      setJudgeScoresB(copy);
      if (onLogEvent) onLogEvent('SCORE', `AO Judge ${idx + 1} score set to ${clamped.toFixed(1)}`);
    }
  };

  const setAllJudgeScores = (athlete: 'AKA' | 'AO', presetVal: number) => {
    setIsWinnerRevealed(false);
    const arr = Array(panelSize).fill(presetVal);
    if (athlete === 'AKA') setJudgeScoresA(arr);
    else setJudgeScoresB(arr);
    if (onLogEvent) onLogEvent('SCORE', `${athlete} all judges set to ${presetVal.toFixed(1)}`);
  };
  const handleClearFlags = () => {
    if (!window.confirm("Are you sure you want to clear all flags for this bout?")) return;
    
    setJudgeScoresA(Array(panelSize).fill(0));
    setJudgeScoresB(Array(panelSize).fill(0));
    setPenaltyH(null);
    if (onLogEvent) onLogEvent('SYSTEM', `All flags cleared`);

    // Broadcast update
    if (broadcastChannelRef.current) {
      const pA = participants.find(p => p.id === currentBout?.participant_a_id);
      const pB = participants.find(p => p.id === currentBout?.participant_b_id);
      const cA = clubs.find(c => c.id === pA?.club_id);
      const cB = clubs.find(c => c.id === pB?.club_id);

      broadcastChannelRef.current.postMessage({
        boutId: currentBout?.id,
        isKata: true,
        akaName: pA?.full_name || 'AKA',
        akaClub: cA?.name || 'Senshi Club',
        aoName: pB?.full_name || 'AO',
        aoClub: cB?.name || 'Goju-Ryu Club',
        scoreAka: 0,
        scoreAo: 0,
        kataA,
        kataB,
        judgeScoresA: Array(panelSize).fill(0),
        judgeScoresB: Array(panelSize).fill(0),
        panelSize,
        scoringMethod,
        winner: null,
        winMethod: '',
        penaltyH: null
      });
    }
  };

  const handleSaveResult = async () => {
    if (!currentBout) return;
    try {
      setIsSaving(true);
      let winnerId = selectedWinnerId;
      let winMtd = '';

      if (penaltyH) {
        winnerId = penaltyH === 'AKA' ? currentBout.participant_b_id : currentBout.participant_a_id;
        winMtd = `Chief Judge Decision (Penalty ${penaltyH})`;
      } else {
        if (totalScoreA > totalScoreB) {
          winnerId = currentBout.participant_a_id || null;
        } else if (totalScoreB > totalScoreA) {
          winnerId = currentBout.participant_b_id || null;
        }
      }

      setSelectedWinnerId(winnerId);
      setIsWinnerRevealed(true);

      const isFinished = Boolean(winnerId);
      const nextStatus = isFinished ? 'Completed' : (currentBout.status === 'Scheduled' ? 'Running' : currentBout.status);

      let finalTotalA = totalScoreA;
      let finalTotalB = totalScoreB;
      let finalJudgeScoresA = [...judgeScoresA];
      let finalJudgeScoresB = [...judgeScoresB];

      if (scoringMethod === 'Flags' && winnerId && totalScoreA === 0 && totalScoreB === 0) {
        if (winnerId === currentBout.participant_a_id) {
          finalTotalA = panelSize;
          finalTotalB = 0;
          finalJudgeScoresA = Array(panelSize).fill(1);
          finalJudgeScoresB = Array(panelSize).fill(0);
        } else if (winnerId === currentBout.participant_b_id) {
          finalTotalA = 0;
          finalTotalB = panelSize;
          finalJudgeScoresA = Array(panelSize).fill(0);
          finalJudgeScoresB = Array(panelSize).fill(1);
        }
      }

      const updated = await db.bouts.updateBoutState(currentBout.id, {
        kata_a: kataA,
        kata_b: kataB,
        judge_scores_a: finalJudgeScoresA,
        judge_scores_b: finalJudgeScoresB,
        total_score_a: finalTotalA,
        total_score_b: finalTotalB,
        score_a: Math.round(finalTotalA),
        score_b: Math.round(finalTotalB),
        winner_id: winnerId,
        victory_method: winMtd || (winnerId === currentBout.participant_a_id ? 'AKA WIN' : winnerId === currentBout.participant_b_id ? 'AO WIN' : undefined),
        status: nextStatus
      });

      if (updated) {
        setCurrentBout(updated);
        if (onLogEvent) onLogEvent('SYSTEM', isFinished ? `Kata Match R${currentBout.round_no}B${currentBout.bout_no} Saved & Completed (${finalTotalA} - ${finalTotalB})` : `Result saved`);
      }

      // Broadcast saved result & winner reveal immediately to spectator view and operator bracket
      if (broadcastChannelRef.current) {
        const participantA = participants.find(p => p.id === currentBout.participant_a_id);
        const participantB = participants.find(p => p.id === currentBout.participant_b_id);
        const clubA = clubs.find(c => c.id === participantA?.club_id);
        const clubB = clubs.find(c => c.id === participantB?.club_id);
        const winnerSide = winnerId === currentBout.participant_a_id ? 'aka' : winnerId === currentBout.participant_b_id ? 'ao' : null;

        broadcastChannelRef.current.postMessage({
          type: isFinished ? 'SHOW_RESULT' : 'BOUT_UPDATED',
          boutId: currentBout.id,
          isKata: true,
          isIdle: false,
          akaName: participantA?.full_name || 'AKA',
          akaClub: clubA?.name || 'Senshi Club',
          aoName: participantB?.full_name || 'AO',
          aoClub: clubB?.name || 'Goju-Ryu Club',
          scoreAka: finalTotalA,
          scoreAo: finalTotalB,
          kataA,
          kataB,
          judgeScoresA: finalJudgeScoresA,
          judgeScoresB: finalJudgeScoresB,
          panelSize,
          scoringMethod,
          winnerSide: winnerSide,
          winner: winnerSide,
          winMethod: winMtd || (winnerSide === 'aka' ? 'AKA WIN' : winnerSide === 'ao' ? 'AO WIN' : 'TIE'),
          penaltyH,
          resultConfirmed: isFinished
        });
      }

      // ── Auto-load next match in category after save ──
      if (isFinished) {
        const freshBouts = await db.bouts.list();
        const sameCatBouts = freshBouts
          .filter(b => b.category_id === currentBout.category_id && b.id !== currentBout.id)
          .sort((a, b) => (a.round_no ?? 0) - (b.round_no ?? 0) || (a.bout_no ?? 0) - (b.bout_no ?? 0));
        const nextPending = sameCatBouts.find(b => b.status !== 'Completed' && b.status !== 'Walkover');

        if (nextPending) {
          // Reload full data then auto-select next bout
          const [bList, pList, catList, clList] = await Promise.all([
            db.bouts.list(), db.participants.list(), db.categories.list(), db.clubs.list()
          ]);
          setBouts(bList);
          setParticipants(pList);
          setCategories(catList);
          setClubs(clList);
          const nextBout = bList.find(b => b.id === nextPending.id);
          if (nextBout) {
            setCurrentBout(nextBout);
            setSelectedBoutId(nextBout.id);
            setSelectedCatId(nextBout.category_id);
            setIsWinnerRevealed(!!nextBout.winner_id);
            setSelectedWinnerId(nextBout.winner_id || null);
            setKataA(nextBout.kata_a || 'Suparinpei');
            setKataB(nextBout.kata_b || 'Anan Dai');
            const defA = nextBout.judge_scores_a?.length ? nextBout.judge_scores_a : Array(panelSize).fill(8.0);
            const defB = nextBout.judge_scores_b?.length ? nextBout.judge_scores_b : Array(panelSize).fill(8.0);
            setJudgeScoresA(defA);
            setJudgeScoresB(defB);
            setPenaltyH(null);
            // Broadcast next match to display
            const pA = pList.find(p => p.id === nextBout.participant_a_id);
            const pB = pList.find(p => p.id === nextBout.participant_b_id);
            const cA = clList.find(c => c.id === pA?.club_id);
            const cB = clList.find(c => c.id === pB?.club_id);
            if (broadcastChannelRef.current) {
              broadcastChannelRef.current.postMessage({
                type: 'SYNC_MATCH_STATE',
                boutId: nextBout.id,
                isKata: true,
                isIdle: false,
                akaName: pA?.full_name || 'AKA',
                akaClub: cA?.name || '',
                aoName: pB?.full_name || 'AO',
                aoClub: cB?.name || '',
                scoreAka: nextBout.total_score_a ?? 0,
                scoreAo: nextBout.total_score_b ?? 0,
                kataA: nextBout.kata_a || '',
                kataB: nextBout.kata_b || '',
                judgeScoresA: defA,
                judgeScoresB: defB,
                panelSize,
                scoringMethod,
                resultConfirmed: false
              });
            }
            if (onLogEvent) onLogEvent('SYSTEM', `Auto-loaded next Kata match R${nextBout.round_no}B${nextBout.bout_no}`);
          }
        } else {
          // No remaining bouts in category → broadcast Arena Standby
          await loadData();
          if (broadcastChannelRef.current) {
            broadcastChannelRef.current.postMessage({ type: 'SET_IDLE', isIdle: true });
          }
          if (onLogEvent) onLogEvent('SYSTEM', 'All Kata bouts in category completed — display set to Arena Standby');
        }
      } else {
        await loadData();
      }
    } catch (err) {
      console.error('Error saving result:', err);
      alert('Failed to save result.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAndCompleteBout = async () => {
    if (!currentBout) return;
    try {
      setIsSaving(true);
      let winner = selectedWinnerId || (totalScoreA >= totalScoreB ? currentBout.participant_a_id : currentBout.participant_b_id);
      let winMtd = '';

      if (penaltyH) {
        winner = penaltyH === 'AKA' ? currentBout.participant_b_id : currentBout.participant_a_id;
        winMtd = `Chief Judge Decision (Penalty ${penaltyH})`;
      }

      let finalTotalA = totalScoreA;
      let finalTotalB = totalScoreB;
      let finalJudgeScoresA = [...judgeScoresA];
      let finalJudgeScoresB = [...judgeScoresB];

      if (scoringMethod === 'Flags' && winner && totalScoreA === 0 && totalScoreB === 0) {
        if (winner === currentBout.participant_a_id) {
          finalTotalA = panelSize;
          finalTotalB = 0;
          finalJudgeScoresA = Array(panelSize).fill(1);
          finalJudgeScoresB = Array(panelSize).fill(0);
        } else if (winner === currentBout.participant_b_id) {
          finalTotalA = 0;
          finalTotalB = panelSize;
          finalJudgeScoresA = Array(panelSize).fill(0);
          finalJudgeScoresB = Array(panelSize).fill(1);
        }
      }
      
      const updates: Partial<Bout> = {
        kata_a: kataA,
        kata_b: kataB,
        judge_scores_a: finalJudgeScoresA,
        judge_scores_b: finalJudgeScoresB,
        total_score_a: finalTotalA,
        total_score_b: finalTotalB,
        score_a: Math.round(finalTotalA),
        score_b: Math.round(finalTotalB),
        winner_id: winner,
        victory_method: winMtd || (winner === currentBout.participant_a_id ? 'AKA WIN' : winner === currentBout.participant_b_id ? 'AO WIN' : undefined),
        status: 'Completed',
      };

      const updatedBout = await db.bouts.updateBoutState(currentBout.id, updates);
      setCurrentBout(updatedBout);
      
      if (onLogEvent) onLogEvent('SYSTEM', `Match completed and bracket advanced (${finalTotalA} - ${finalTotalB})`);

      // Broadcast completion & winner reveal to spectator view and operator bracket
      if (broadcastChannelRef.current) {
        const participantA = participants.find(p => p.id === currentBout.participant_a_id);
        const participantB = participants.find(p => p.id === currentBout.participant_b_id);
        const clubA = clubs.find(c => c.id === participantA?.club_id);
        const clubB = clubs.find(c => c.id === participantB?.club_id);
        const winnerSide = winner === currentBout.participant_a_id ? 'aka' : winner === currentBout.participant_b_id ? 'ao' : null;

        broadcastChannelRef.current.postMessage({
          type: 'SHOW_RESULT',
          boutId: currentBout.id,
          isKata: true,
          isIdle: false,
          akaName: participantA?.full_name || 'AKA',
          akaClub: clubA?.name || 'Senshi Club',
          aoName: participantB?.full_name || 'AO',
          aoClub: clubB?.name || 'Goju-Ryu Club',
          scoreAka: finalTotalA,
          scoreAo: finalTotalB,
          kataA,
          kataB,
          judgeScoresA: finalJudgeScoresA,
          judgeScoresB: finalJudgeScoresB,
          panelSize,
          scoringMethod,
          winnerSide: winnerSide,
          winner: winnerSide,
          winMethod: winMtd || (winnerSide === 'aka' ? 'AKA WIN' : winnerSide === 'ao' ? 'AO WIN' : 'TIE'),
          penaltyH,
          resultConfirmed: true
        });
      }

      // ── Auto-load next match in category ──
      const freshBouts = await db.bouts.list();
      const sameCatBouts = freshBouts
        .filter(b => b.category_id === currentBout.category_id && b.id !== currentBout.id)
        .sort((a, b) => (a.round_no ?? 0) - (b.round_no ?? 0) || (a.bout_no ?? 0) - (b.bout_no ?? 0));
      const nextPending = sameCatBouts.find(b => b.status !== 'Completed' && b.status !== 'Walkover');

      if (nextPending) {
        const [bList, pList, catList, clList] = await Promise.all([
          db.bouts.list(), db.participants.list(), db.categories.list(), db.clubs.list()
        ]);
        setBouts(bList);
        setParticipants(pList);
        setCategories(catList);
        setClubs(clList);
        const nextBout = bList.find(b => b.id === nextPending.id);
        if (nextBout) {
          setCurrentBout(nextBout);
          setSelectedBoutId(nextBout.id);
          setSelectedCatId(nextBout.category_id);
          setIsWinnerRevealed(!!nextBout.winner_id);
          setSelectedWinnerId(nextBout.winner_id || null);
          setKataA(nextBout.kata_a || 'Suparinpei');
          setKataB(nextBout.kata_b || 'Anan Dai');
          const defA = nextBout.judge_scores_a?.length ? nextBout.judge_scores_a : Array(panelSize).fill(8.0);
          const defB = nextBout.judge_scores_b?.length ? nextBout.judge_scores_b : Array(panelSize).fill(8.0);
          setJudgeScoresA(defA);
          setJudgeScoresB(defB);
          setPenaltyH(null);
          // Broadcast next match to display
          const pA = pList.find(p => p.id === nextBout.participant_a_id);
          const pB = pList.find(p => p.id === nextBout.participant_b_id);
          const cA = clList.find(c => c.id === pA?.club_id);
          const cB = clList.find(c => c.id === pB?.club_id);
          if (broadcastChannelRef.current) {
            broadcastChannelRef.current.postMessage({
              type: 'SYNC_MATCH_STATE',
              boutId: nextBout.id,
              isKata: true,
              isIdle: false,
              akaName: pA?.full_name || 'AKA',
              akaClub: cA?.name || '',
              aoName: pB?.full_name || 'AO',
              aoClub: cB?.name || '',
              scoreAka: nextBout.total_score_a ?? 0,
              scoreAo: nextBout.total_score_b ?? 0,
              kataA: nextBout.kata_a || '',
              kataB: nextBout.kata_b || '',
              judgeScoresA: defA,
              judgeScoresB: defB,
              panelSize,
              scoringMethod,
              resultConfirmed: false
            });
          }
          if (onLogEvent) onLogEvent('SYSTEM', `Auto-loaded next Kata match R${nextBout.round_no}B${nextBout.bout_no}`);
        }
      } else {
        // All bouts in category complete → Arena Standby
        await loadData();
        if (broadcastChannelRef.current) {
          broadcastChannelRef.current.postMessage({ type: 'SET_IDLE', isIdle: true });
        }
        if (onLogEvent) onLogEvent('SYSTEM', 'All Kata bouts completed — display set to Arena Standby');
        // Stay on console — no nav away; operator can manually start new category
      }
    } catch (err) {
      console.error('Error completing Kata bout:', err);
      alert('Failed to save bout results.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRematch = async () => {
    if (!currentBout) return;
    if (!window.confirm("Are you sure you want to reset this match? All saved scores and the winner decision will be permanently deleted from the database.")) return;

    try {
      setIsSaving(true);
      const updates: Partial<Bout> = {
        kata_a: undefined,
        kata_b: undefined,
        judge_scores_a: [],
        judge_scores_b: [],
        total_score_a: 0,
        total_score_b: 0,
        score_a: 0,
        score_b: 0,
        winner_id: null as any,
        status: 'Running',
      };

      const updatedBout = await db.bouts.updateBoutState(currentBout.id, updates);
      
      // Update local state directly so we don't need a full reload
      setKataA('Suparinpei');
      setKataB('Anan Dai');
      const resetScoresA = scoringMethod === 'Flags' ? Array(panelSize).fill(1).map((_, i) => i < Math.ceil(panelSize/2) ? 1 : 0) : Array(panelSize).fill(8.0);
      const resetScoresB = scoringMethod === 'Flags' ? Array(panelSize).fill(0) : Array(panelSize).fill(8.0);
      setJudgeScoresA(resetScoresA);
      setJudgeScoresB(resetScoresB);
      setSelectedWinnerId(null);
      setIsWinnerRevealed(false);
      setPenaltyH(null);
      setCurrentBout(updatedBout);
      
      // Refresh list
      await loadData();

      // Immediately broadcast match reset to Spectator Display
      if (broadcastChannelRef.current) {
        const participantA = participants.find(p => p.id === updatedBout.participant_a_id);
        const participantB = participants.find(p => p.id === updatedBout.participant_b_id);
        const clubA = clubs.find(c => c.id === participantA?.club_id);
        const clubB = clubs.find(c => c.id === participantB?.club_id);

        broadcastChannelRef.current.postMessage({
          boutId: updatedBout.id,
          isKata: true,
          akaName: participantA?.full_name || 'AKA',
          akaClub: clubA?.name || 'Senshi Club',
          aoName: participantB?.full_name || 'AO',
          aoClub: clubB?.name || 'Goju-Ryu Club',
          scoreAka: 0,
          scoreAo: 0,
          kataA: 'Suparinpei',
          kataB: 'Anan Dai',
          judgeScoresA: resetScoresA,
          judgeScoresB: resetScoresB,
          panelSize,
          scoringMethod,
          winner: null,
          winMethod: '',
          penaltyH: null
        });
      }
    } catch (err) {
      console.error('Error resetting bout:', err);
      alert('Failed to reset match.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!mounted) return null;

  if (isLockedByOther) {
    return (
      <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center">
        <div className="max-w-md w-full bg-card border shadow-xl rounded-2xl p-8 text-center space-y-6">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-full flex items-center justify-center mx-auto">
            <ShieldAlert size={32} strokeWidth={3} />
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-2">Category Locked</h2>
            <p className="text-muted-foreground">
              Another Tatami PC currently controls this category. You cannot score this bout while they hold the lock.
            </p>
          </div>
          <Link href="/categories" className="block w-full py-3 bg-primary text-primary-foreground rounded-xl font-bold hover:brightness-110 transition-all">
            Return to Categories
          </Link>
        </div>
      </div>
    );
  }

  // Kata-only categories
  const kataCategories = categories.filter(isKataCategory);
  const kataCatIds = new Set(kataCategories.map(c => c.id));

  // Helper for max/min score indices
  const getScoreStatusIndex = (scores: number[], index: number) => {
    if (!scores || scores.length < 3) return 'active';
    const sorted = [...scores].sort((a, b) => a - b);
    const minVal = sorted[0];
    const maxVal = sorted[sorted.length - 1];

    const val = scores[index];
    if (val === minVal && scores.indexOf(val) === index) return 'min';
    if (val === maxVal && scores.lastIndexOf(val) === index) return 'max';
    return 'active';
  };

  const filteredBouts = bouts.filter(b => {
    const cat = categories.find(c => c.id === b.category_id);
    const isKata = kataCatIds.has(b.category_id) || isKataCategory(cat);
    if (!isKata) return false;
    const matchesCat = selectedCatId === 'ALL' || b.category_id === selectedCatId;
    const matchesStatus = selectedStatus === 'ALL' || b.status === selectedStatus;
    return matchesCat && matchesStatus;
  });

  return (
    <div className={`text-white ${onClose ? 'h-[100dvh] w-full flex flex-col p-3 bg-[#0a0c10] overflow-hidden relative justify-between' : 'min-h-screen bg-[#07070a] p-4 lg:p-6 pb-6 flex flex-col justify-between relative'}`}>
      
      {/* Top Banner */}
      {!onClose && (
        <div className="max-w-[1800px] w-full mx-auto mb-4 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            {onClose ? (
              <button onClick={onClose} className="text-xs text-yellow-400 hover:text-yellow-300 font-bold mb-1 flex items-center gap-1 cursor-pointer">
                 <ArrowRight className="h-3 w-3 rotate-180" /> Back to Hub
              </button>
            ) : (
              <Link href="/dashboard/kata-scoreboard" className="text-xs text-yellow-400 hover:text-yellow-300 font-bold mb-1 flex items-center gap-1">
                 <ArrowRight className="h-3 w-3 rotate-180" /> Back to Hub
              </Link>
            )}
            <div className="flex items-center gap-2 mb-1 mt-1">
              <Zap className="h-4 w-4 text-yellow-400 animate-pulse" />
              <span className="text-xs font-black uppercase tracking-widest text-yellow-400">
                KATA SCORING CONSOLE
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent flex flex-wrap items-center gap-3">
              Match Console (Kata)
              {spectatorConnected ? (
                <span className="flex items-center gap-1.5 px-3 py-0.5 bg-green-500/20 text-green-400 border border-green-500/30 rounded-full text-xs font-black tracking-widest uppercase shadow-[0_0_15px_rgba(34,197,94,0.3)]">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  Display Connected
                </span>
              ) : (
                <span className="flex items-center gap-1.5 px-3 py-0.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-full text-xs font-black tracking-widest uppercase">
                  <span className="w-2 h-2 bg-red-500/50 rounded-full" />
                  Display Disconnected
                </span>
              )}
            </h1>
            <p className="text-gray-400 text-xs mt-0.5">{tournamentName || 'Kelab Karate Do Senshi Goju-Ryu Championship'}</p>
          </div>
          
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={loadData}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-white/5 hover:bg-white/10 text-white border border-white/10 hover:border-white/20 rounded-xl text-xs font-bold transition cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Sync Matches
            </button>

            <button
              onClick={toggleFullscreen}
              className={`flex items-center gap-2 px-3.5 py-1.5 border rounded-xl text-xs font-bold transition cursor-pointer ${
                isFullscreen
                  ? 'bg-white/10 text-white border-white/20 hover:bg-white/20'
                  : 'bg-white/5 text-white/80 border-white/10 hover:bg-white/10'
              }`}
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              <span>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
            </button>

            <button
              onClick={() => setShowSpectatorModal(true)}
              disabled={!currentBout}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-500/30 hover:border-purple-500/50 rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-50"
            >
              <Tv className="h-3.5 w-3.5" />
              Open Spectator View
            </button>
            
            <button
              onClick={() => setIsKataListOpen(true)}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 hover:border-sky-500/50 rounded-xl text-xs font-bold transition cursor-pointer"
            >
              <BookOpen className="h-3.5 w-3.5" />
              Kata List
            </button>

            <button
              onClick={() => setIsResultBookOpen(true)}
              disabled={!currentBout}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-yellow-400/10 hover:bg-yellow-400/20 text-yellow-400 border border-yellow-400/30 hover:border-yellow-400/50 rounded-xl text-xs font-bold transition cursor-pointer disabled:opacity-50"
            >
              <FileText className="h-3.5 w-3.5" />
              Official Result Book
            </button>
          </div>
        </div>
        </div>
      )}

      {/* Control Grid (Auto-Adjust Height) */}
      <div className={`max-w-[1800px] w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4 flex-1 min-h-0`}>
        
        {/* Left Panel: Auto-adjusting Fighter Panes & Match Info */}
        <div className="lg:col-span-6 flex flex-col gap-2.5 h-full justify-between min-h-0 overflow-y-auto">
          
          {/* Top Match Info & Digital Timer Bar (Reduced Height) */}
          <div className={`bg-[#0d0f16] border border-white/10 rounded-2xl flex items-center justify-between shadow-lg shrink-0 ${onClose ? 'p-2' : 'p-2.5 sm:p-3'}`}>
            <div className="min-w-0">
              <span className="text-sm font-black uppercase tracking-widest text-yellow-400 block truncate">
                {category?.name || 'Kata Division'}
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-lg font-black text-white">Bout #{currentBout?.bout_no || 1}</span>
                <span className="text-white/30">•</span>
                <span className="text-base px-3 py-0.2 bg-yellow-400/10 text-yellow-400 border border-yellow-400/30 rounded-full font-black">
                  Round {currentBout?.round_no || 1}
                </span>
                <span className="text-white/30">•</span>
                <span className="text-base font-bold text-white/90">{currentBout?.tatami || 'Tatami 1'}</span>
              </div>
            </div>

            {/* Digital Countdown Timer & Controls */}
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end">
                <div className={`flex items-baseline justify-end font-mono text-6xl sm:text-7xl lg:text-[90px] font-black leading-none select-none tracking-tight ${
                  timeLeft <= 150 && timeLeft > 0 ? 'text-red-500 animate-pulse drop-shadow-[0_0_25px_rgba(239,68,68,0.95)]' : 'text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.5)]'
                }`}>
                  <span>{formatMainTime(timeLeft)}</span>
                  <span className={`text-4xl sm:text-5xl ml-1 ${timeLeft <= 150 && timeLeft > 0 ? 'text-red-500/70' : 'text-white/60'}`}>
                    {formatDecsTime(timeLeft)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${isTimerRunning ? 'bg-green-500 animate-ping' : 'bg-red-500'}`} />
                  <span className="text-xs font-black uppercase text-white/80 tracking-wider">
                    {isTimerRunning ? 'RUNNING' : 'PAUSED'}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2 pl-3 border-l border-white/10">
                <div className="flex items-center gap-2">
                  {isTimerRunning ? (
                    <button
                      onClick={() => { setIsTimerRunning(false); if (onLogEvent) onLogEvent('TIMER', 'Match Timer Stopped'); }}
                      className="p-2.5 sm:p-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-black transition shadow-md shadow-red-950/40 cursor-pointer"
                      title="Stop Timer"
                    >
                      <Square className="h-5 w-5 fill-white" />
                    </button>
                  ) : (
                    <button
                      onClick={() => { setIsTimerRunning(true); if (onLogEvent) onLogEvent('TIMER', 'Match Timer Started'); }}
                      disabled={timeLeft === 0}
                      className="p-2.5 sm:p-3 bg-green-600 hover:bg-green-500 text-white disabled:opacity-40 rounded-xl font-black transition shadow-md shadow-green-950/40 cursor-pointer"
                      title="Start Timer"
                    >
                      <Play className="h-5 w-5 fill-white" />
                    </button>
                  )}
                  <button
                    onClick={() => { setTimeLeft(0); if (onLogEvent) onLogEvent('TIMER', 'Match Timer Reset'); }}
                    disabled={isTimerRunning}
                    className="p-2.5 sm:p-3 bg-white/5 hover:bg-white/10 text-white disabled:opacity-30 rounded-xl font-black transition border border-white/10 cursor-pointer"
                    title="Reset Timer"
                  >
                    <RotateCcw className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <button onClick={() => setTimerPreset(180)} className="px-1.5 py-0.5 bg-white/10 hover:bg-white/20 rounded-md text-[10px] font-black text-white transition cursor-pointer shadow-sm">3m</button>
                  <button onClick={() => setTimerPreset(120)} className="px-1.5 py-0.5 bg-white/10 hover:bg-white/20 rounded-md text-[10px] font-black text-white transition cursor-pointer shadow-sm">2m</button>
                  <button onClick={() => setTimerPreset(60)} className="px-1.5 py-0.5 bg-white/10 hover:bg-white/20 rounded-md text-[10px] font-black text-white transition cursor-pointer shadow-sm">1m</button>
                  <button onClick={() => setTimerPreset(30)} className="px-1.5 py-0.5 bg-white/10 hover:bg-white/20 rounded-md text-[10px] font-black text-white transition cursor-pointer shadow-sm">30s</button>
                  <button onClick={() => setTimerPreset(15)} className="px-1.5 py-0.5 bg-white/10 hover:bg-white/20 rounded-md text-[10px] font-black text-white transition cursor-pointer shadow-sm">15s</button>
                </div>
              </div>
            </div>
          </div>

          {/* VERTICAL VIEW: 2 SIDE-BY-SIDE FIGHTER PILLARS (Auto-Adjusting) */}
          <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
            
            {/* VERTICAL PANE 1: AKA ATHLETE (RED) */}
            <div className={`bg-gradient-to-b from-red-950/80 via-red-900/30 to-[#0d0d14] border-2 border-red-500/40 rounded-2xl flex flex-col justify-between overflow-hidden shadow-2xl shadow-red-950/50 ${onClose ? 'p-2.5' : 'p-3.5'}`}>
              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <span className="px-3.5 py-1 bg-red-600 text-white font-black text-base sm:text-lg rounded-xl uppercase tracking-wider shadow-lg shadow-red-950/60">
                    AKA (RED)
                  </span>
                  <span className="text-xs sm:text-sm font-black text-red-300 uppercase tracking-widest bg-red-950/80 px-2.5 py-0.5 rounded-lg border border-red-800/40">
                    CORNER 1
                  </span>
                </div>

                <h3 className="text-4xl sm:text-5xl lg:text-[54px] font-black text-white tracking-tight leading-none mb-1 truncate" title={participantA?.full_name || 'AKA Athlete'}>
                  {participantA?.full_name || 'AKA Athlete'}
                </h3>
                <p className="text-lg sm:text-xl font-bold text-red-200 mb-2.5 truncate" title={clubA?.name || 'Independent Dojo'}>
                  {clubA?.name || 'Independent Dojo'}
                </p>

                {/* Declared Kata Selector */}
                <div className="mb-2">
                  <label className="block text-xs font-black uppercase tracking-wider text-red-300 mb-1">Declared Kata</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="1"
                      max={OFFICIAL_WKF_KATAS.length}
                      placeholder="#"
                      value={kataA ? (OFFICIAL_WKF_KATAS.indexOf(kataA) !== -1 ? OFFICIAL_WKF_KATAS.indexOf(kataA) + 1 : '') : ''}
                      onChange={(e) => {
                        if (e.target.value === '') {
                          setKataA('');
                          return;
                        }
                        const no = parseInt(e.target.value);
                        if (!isNaN(no) && no >= 1 && no <= OFFICIAL_WKF_KATAS.length) {
                          setKataA(OFFICIAL_WKF_KATAS[no - 1]);
                        }
                      }}
                      className="w-20 sm:w-24 lg:w-28 bg-[#181015] border-2 border-red-500/40 rounded-xl px-2 py-3 sm:py-4 text-xl sm:text-2xl lg:text-3xl font-black text-white text-center focus:outline-none focus:border-red-400 transition"
                    />
                    <select
                      value={kataA}
                      onChange={e => setKataA(e.target.value)}
                      className="flex-1 min-w-0 bg-[#181015] border-2 border-red-500/40 rounded-xl px-3.5 py-3 sm:py-4 text-xl sm:text-2xl lg:text-3xl font-black text-white focus:outline-none focus:border-red-400 transition cursor-pointer shadow-inner"
                    >
                      <option value="">Select Kata...</option>
                      {OFFICIAL_WKF_KATAS.map((k, i) => (
                        <option key={k} value={k}>{i + 1}. {k}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Vertical Score Bottom Readout */}
              <div className="pt-2 border-t-2 border-red-500/30 flex flex-col items-center justify-center bg-red-950/40 rounded-xl p-2.5">
                <span className="text-xs uppercase font-black tracking-widest text-red-300 mb-0.5">TOTAL SCORE</span>
                <div className="text-8xl sm:text-9xl lg:text-[120px] font-mono font-black text-red-400 tabular-nums leading-none drop-shadow-[0_0_30px_rgba(239,68,68,0.95)]">
                  {scoringMethod === 'Flags' ? (
                    <div className="flex items-center gap-2 flex-wrap justify-center py-1">
                      {Array.from({ length: totalScoreA }).map((_, i) => (
                        <Flag key={`v-card-aka-${i}`} className="h-10 w-10 fill-red-500 text-red-500" />
                      ))}
                      {totalScoreA === 0 && <span className="text-3xl text-white/40 font-sans font-black">0 FLAGS</span>}
                    </div>
                  ) : (
                    totalScoreA.toFixed(2)
                  )}
                </div>
              </div>
            </div>

            {/* VERTICAL PANE 2: AO ATHLETE (BLUE) */}
            <div className={`bg-gradient-to-b from-blue-950/80 via-blue-900/30 to-[#0d0d14] border-2 border-blue-500/40 rounded-2xl flex flex-col justify-between overflow-hidden shadow-2xl shadow-blue-950/50 ${onClose ? 'p-2.5' : 'p-3.5'}`}>
              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <span className="px-3.5 py-1 bg-blue-600 text-white font-black text-base sm:text-lg rounded-xl uppercase tracking-wider shadow-lg shadow-blue-950/60">
                    AO (BLUE)
                  </span>
                  <span className="text-xs sm:text-sm font-black text-blue-300 uppercase tracking-widest bg-blue-950/80 px-2.5 py-0.5 rounded-lg border border-blue-800/40">
                    CORNER 2
                  </span>
                </div>

                <h3 className="text-4xl sm:text-5xl lg:text-[54px] font-black text-white tracking-tight leading-none mb-1 truncate" title={participantB?.full_name || 'AO Athlete'}>
                  {participantB?.full_name || 'AO Athlete'}
                </h3>
                <p className="text-lg sm:text-xl font-bold text-blue-200 mb-2.5 truncate" title={clubB?.name || 'Independent Dojo'}>
                  {clubB?.name || 'Independent Dojo'}
                </p>

                {/* Declared Kata Selector */}
                <div className="mb-2">
                  <label className="block text-xs font-black uppercase tracking-wider text-blue-300 mb-1">Declared Kata</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="1"
                      max={OFFICIAL_WKF_KATAS.length}
                      placeholder="#"
                      value={kataB ? (OFFICIAL_WKF_KATAS.indexOf(kataB) !== -1 ? OFFICIAL_WKF_KATAS.indexOf(kataB) + 1 : '') : ''}
                      onChange={(e) => {
                        if (e.target.value === '') {
                          setKataB('');
                          return;
                        }
                        const no = parseInt(e.target.value);
                        if (!isNaN(no) && no >= 1 && no <= OFFICIAL_WKF_KATAS.length) {
                          setKataB(OFFICIAL_WKF_KATAS[no - 1]);
                        }
                      }}
                      className="w-20 sm:w-24 lg:w-28 bg-[#101420] border-2 border-blue-500/40 rounded-xl px-2 py-3 sm:py-4 text-xl sm:text-2xl lg:text-3xl font-black text-white text-center focus:outline-none focus:border-blue-400 transition"
                    />
                    <select
                      value={kataB}
                      onChange={e => setKataB(e.target.value)}
                      className="flex-1 min-w-0 bg-[#101420] border-2 border-blue-500/40 rounded-xl px-3.5 py-3 sm:py-4 text-xl sm:text-2xl lg:text-3xl font-black text-white focus:outline-none focus:border-blue-400 transition cursor-pointer shadow-inner"
                    >
                      <option value="">Select Kata...</option>
                      {OFFICIAL_WKF_KATAS.map((k, i) => (
                        <option key={k} value={k}>{i + 1}. {k}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Vertical Score Bottom Readout */}
              <div className="pt-2 border-t-2 border-blue-500/30 flex flex-col items-center justify-center bg-blue-950/40 rounded-xl p-2.5">
                <span className="text-xs uppercase font-black tracking-widest text-blue-300 mb-0.5">TOTAL SCORE</span>
                <div className="text-8xl sm:text-9xl lg:text-[120px] font-mono font-black text-blue-400 tabular-nums leading-none drop-shadow-[0_0_30px_rgba(59,130,246,0.95)]">
                  {scoringMethod === 'Flags' ? (
                    <div className="flex items-center gap-2 flex-wrap justify-center py-1">
                      {Array.from({ length: totalScoreB }).map((_, i) => (
                        <Flag key={`v-card-ao-${i}`} className="h-10 w-10 fill-blue-500 text-blue-500" />
                      ))}
                      {totalScoreB === 0 && <span className="text-3xl text-white/40 font-sans font-black">0 FLAGS</span>}
                    </div>
                  ) : (
                    totalScoreB.toFixed(2)
                  )}
                </div>
              </div>
            </div>

          </div>

        </div>

        {/* Right Panel: Auto-adjusting Judge Matrix & Live Result */}
        <div className="lg:col-span-6 flex flex-col gap-2.5 h-full justify-between min-h-0">

          {/* Interactive Judge Scoring Matrix */}
          <div className={`flex-1 bg-[#0d0f16] border border-white/10 rounded-2xl flex flex-col ${onClose ? 'p-2 space-y-2' : 'p-3 space-y-2.5 overflow-y-auto shadow-2xl'}`}>
            
            {/* Header & Tabs */}
            <div className={`flex flex-col sm:flex-row items-center justify-between gap-1.5 border-b border-white/10 ${onClose ? 'pb-1' : 'pb-2'}`}>
              <div>
                <h3 className={`${onClose ? 'text-base' : 'text-lg'} font-black tracking-tight text-white flex items-center gap-2`}>
                  Judge Score Matrix
                  <span className="text-xs font-black text-yellow-400 bg-yellow-400/10 px-2.5 py-0.5 rounded-full border border-yellow-400/30">{panelSize} Judges</span>
                </h3>
              </div>

              {/* AKA vs AO Tab Toggle */}
              {scoringMethod === 'Points' && (
                <div className="flex items-center gap-2 p-1 bg-[#101015] border border-white/10 rounded-xl">
                  <button
                    onClick={() => setActiveScoringTab('AKA')}
                    className={`px-4 py-1.5 text-sm font-black rounded-lg transition ${activeScoringTab === 'AKA' ? 'bg-red-600 text-white shadow-lg shadow-red-600/30' : 'text-gray-400 hover:text-white'}`}
                  >AKA</button>
                  <button
                    onClick={() => setActiveScoringTab('AO')}
                    className={`px-4 py-1.5 text-sm font-black rounded-lg transition ${activeScoringTab === 'AO' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'text-gray-400 hover:text-white'}`}
                  >AO</button>
                </div>
              )}
            </div>

            {/* LIVE RESULT PANE (Directly unified on top of Judge Matrix) */}
            <div className="bg-gradient-to-r from-red-950/90 via-[#0a0c10] to-blue-950/90 border-2 border-yellow-400/60 rounded-2xl p-2.5 sm:p-3 flex items-center justify-between shadow-2xl gap-3">
              {/* AKA Live Total */}
              <div className="flex items-center gap-3 min-w-0">
                <span className="px-3.5 py-1.5 bg-red-600 text-white font-black text-base sm:text-lg rounded-xl uppercase tracking-wider shadow-lg shadow-red-950/60">AKA</span>
                <div className="min-w-0">
                  <div className="text-lg sm:text-xl font-black text-white truncate max-w-[150px] leading-tight">{participantA?.full_name || 'AKA'}</div>
                  <div className="text-xs text-red-300 font-black uppercase tracking-wider mt-0.5">LIVE RESULT</div>
                </div>
                <div className="text-5xl sm:text-6xl lg:text-7xl font-mono font-black text-red-400 tabular-nums ml-2 leading-none drop-shadow-[0_0_25px_rgba(239,68,68,0.9)]">
                  {scoringMethod === 'Flags' ? (
                    <div className="flex items-center gap-1.5">
                      {Array.from({ length: totalScoreA }).map((_, i) => (
                        <Flag key={`res-aka-${i}`} className="h-8 w-8 fill-red-500 text-red-500" />
                      ))}
                      {totalScoreA === 0 && <span className="text-4xl text-white/30 font-black">0</span>}
                    </div>
                  ) : (
                    totalScoreA.toFixed(2)
                  )}
                </div>
              </div>

              {/* Center Match Decision Status */}
              <div className="flex flex-col items-center justify-center px-3 py-1.5 bg-black/90 rounded-xl border-2 border-yellow-400/40 shrink-0 shadow-inner">
                <span className="text-sm sm:text-base font-black uppercase tracking-widest text-yellow-400">
                  {penaltyH ? `PENALTY (${penaltyH})` : totalScoreA > totalScoreB ? '★ AKA LEADS' : totalScoreB > totalScoreA ? '★ AO LEADS' : 'TIED'}
                </span>
                <span className="text-xs text-white/70 font-mono mt-0.5 font-black">MATCH RESULT</span>
              </div>

              {/* AO Live Total */}
              <div className="flex items-center gap-3 min-w-0 justify-end text-right">
                <div className="text-5xl sm:text-6xl lg:text-7xl font-mono font-black text-blue-400 tabular-nums mr-2 leading-none drop-shadow-[0_0_25px_rgba(59,130,246,0.9)]">
                  {scoringMethod === 'Flags' ? (
                    <div className="flex items-center gap-1.5">
                      {Array.from({ length: totalScoreB }).map((_, i) => (
                        <Flag key={`res-ao-${i}`} className="h-8 w-8 fill-blue-500 text-blue-500" />
                      ))}
                      {totalScoreB === 0 && <span className="text-4xl text-white/30 font-black">0</span>}
                    </div>
                  ) : (
                    totalScoreB.toFixed(2)
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-lg sm:text-xl font-black text-white truncate max-w-[150px] leading-tight">{participantB?.full_name || 'AO'}</div>
                  <div className="text-xs text-blue-300 font-black uppercase tracking-wider mt-0.5">LIVE RESULT</div>
                </div>
                <span className="px-3.5 py-1.5 bg-blue-600 text-white font-black text-base sm:text-lg rounded-xl uppercase tracking-wider shadow-lg shadow-blue-950/60">AO</span>
              </div>
            </div>

            {/* Quick Presets Bar */}
            <div className={`flex flex-wrap items-center justify-between gap-2 ${onClose ? 'p-1' : 'p-2'} bg-white/5 rounded-xl`}>
              <span className="text-[10px] font-bold text-gray-300">Quick Presets:</span>
              <div className="flex flex-wrap gap-1.5">
                {scoringMethod === 'Points' ? (
                  [8.0, 8.2, 8.4, 8.5, 8.8, 9.0].map(val => (
                    <button
                      key={val}
                      onClick={() => setAllJudgeScores(activeScoringTab, val)}
                      className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white text-xs font-bold font-mono rounded-lg transition cursor-pointer"
                    >
                      {val.toFixed(1)}
                    </button>
                  ))
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setJudgeScoresA(Array(panelSize).fill(1));
                        setJudgeScoresB(Array(panelSize).fill(0));
                      }}
                      className="flex items-center gap-1.5 px-3 py-1 bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-500/40 text-xs font-black rounded-lg transition cursor-pointer shadow"
                    >
                      All Flags AKA <Flag className="h-3.5 w-3.5 fill-current" />
                    </button>
                    <button
                      onClick={() => {
                        setJudgeScoresA(Array(panelSize).fill(0));
                        setJudgeScoresB(Array(panelSize).fill(1));
                      }}
                      className="flex items-center gap-1.5 px-3 py-1 bg-blue-950/60 hover:bg-blue-900/80 text-blue-300 border border-blue-500/40 text-xs font-black rounded-lg transition cursor-pointer shadow"
                    >
                      All Flags AO <Flag className="h-3.5 w-3.5 fill-current" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Judge Score Cards Input Grid */}
            <div className={`grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 ${onClose ? 'gap-1.5' : 'gap-2.5'}`}>
              {Array.from({ length: panelSize }).map((_, idx) => {
                if (scoringMethod === 'Flags') {
                  const isAka = judgeScoresA[idx] === 1;
                  const isAo = judgeScoresB[idx] === 1;
                  return (
                    <div key={idx} className={`${onClose ? 'p-1.5' : 'p-2.5'} rounded-2xl border-2 bg-white/[0.02] border-white/10 flex flex-col items-center transition min-w-0 shadow-lg`}>
                      <span className={`text-[11px] font-black uppercase text-gray-300 ${onClose ? 'mb-1' : 'mb-2'} text-center leading-tight flex flex-col items-center gap-0.5`}>
                        {idx === 0 ? (
                          <><span>Judge 1</span><span className="text-[8px] text-yellow-400 normal-case font-bold">(Chief)</span></>
                        ) : (
                          `Judge ${idx + 1}`
                        )}
                      </span>
                      <div className="flex flex-col gap-2 w-full h-full">
                        <button
                          onClick={() => {
                            if (penaltyH) return; // Prevent flag toggling if penalty is active
                            const newA = [...judgeScoresA];
                            const newB = [...judgeScoresB];
                            newA[idx] = 1;
                            newB[idx] = 0;
                            setJudgeScoresA(newA);
                            setJudgeScoresB(newB);
                            if (onLogEvent) onLogEvent('SCORE', `Judge ${idx + 1} Flag assigned to AKA`);
                          }}
                          disabled={!!penaltyH}
                          className={`flex-1 ${onClose ? 'py-2' : 'py-4'} text-red-500 rounded-xl border-2 transition flex items-center justify-center cursor-pointer ${isAka && !penaltyH ? 'bg-red-600 border-red-400 shadow-xl shadow-red-600/50 grayscale-0 text-white scale-[1.02]' : 'bg-red-950/20 border-red-900/30 grayscale opacity-40 hover:opacity-100 hover:grayscale-0'} ${penaltyH ? 'cursor-not-allowed opacity-20' : ''}`}
                        >
                          <Flag className={`${onClose ? 'h-5 w-5' : 'h-7 w-7'} fill-current`} />
                        </button>
                        <button
                          onClick={() => {
                            if (penaltyH) return; // Prevent flag toggling if penalty is active
                            const newA = [...judgeScoresA];
                            const newB = [...judgeScoresB];
                            newA[idx] = 0;
                            newB[idx] = 1;
                            setJudgeScoresA(newA);
                            setJudgeScoresB(newB);
                            if (onLogEvent) onLogEvent('SCORE', `Judge ${idx + 1} Flag assigned to AO`);
                          }}
                          disabled={!!penaltyH}
                          className={`flex-1 ${onClose ? 'py-2' : 'py-4'} text-blue-500 rounded-xl border-2 transition flex items-center justify-center cursor-pointer ${isAo && !penaltyH ? 'bg-blue-600 border-blue-400 shadow-xl shadow-blue-600/50 grayscale-0 text-white scale-[1.02]' : 'bg-blue-950/20 border-blue-900/30 grayscale opacity-40 hover:opacity-100 hover:grayscale-0'} ${penaltyH ? 'cursor-not-allowed opacity-20' : ''}`}
                        >
                          <Flag className={`${onClose ? 'h-5 w-5' : 'h-7 w-7'} fill-current`} />
                        </button>

                        {/* Chief Judge Penalty Box */}
                        {idx === 0 && (
                          <div className={`${onClose ? 'mt-1 pt-1' : 'mt-3 pt-3'} border-t border-white/10 w-full flex flex-col gap-1`}>
                            <span className="text-[9px] font-black uppercase text-center text-yellow-400">Penalty</span>
                            <div className="flex gap-1.5 w-full">
                              <button
                                onClick={() => {
                                  if (penaltyH === 'AKA') {
                                    setPenaltyH(null);
                                    if (onLogEvent) onLogEvent('PENALTY', 'Removed Chief Judge Penalty from AKA');
                                  } else {
                                    if (window.confirm("Assign Chief Judge Penalty to AKA? This will declare AO as the winner.")) {
                                      setPenaltyH('AKA');
                                      setJudgeScoresA(Array(panelSize).fill(0));
                                      setJudgeScoresB(Array(panelSize).fill(0));
                                      if (onLogEvent) onLogEvent('PENALTY', 'Chief Judge Penalty (H) assigned to AKA');
                                    }
                                  }
                                }}
                                className={`flex-1 py-1.5 text-xs font-black rounded border transition ${penaltyH === 'AKA' ? 'bg-red-600 border-red-400 text-white shadow-lg' : 'bg-red-950/20 border-red-900/30 text-red-500 hover:bg-red-950/50'}`}
                              >
                                <div className="flex flex-col items-center gap-0.5 leading-none py-0.5">
                                  <span>(H)</span>
                                  <span className="text-[8.5px] opacity-90">AKA</span>
                                </div>
                              </button>
                              <button
                                onClick={() => {
                                  if (penaltyH === 'AO') {
                                    setPenaltyH(null);
                                    if (onLogEvent) onLogEvent('PENALTY', 'Removed Chief Judge Penalty from AO');
                                  } else {
                                    if (window.confirm("Assign Chief Judge Penalty to AO? This will declare AKA as the winner.")) {
                                      setPenaltyH('AO');
                                      setJudgeScoresA(Array(panelSize).fill(0));
                                      setJudgeScoresB(Array(panelSize).fill(0));
                                      if (onLogEvent) onLogEvent('PENALTY', 'Chief Judge Penalty (H) assigned to AO');
                                    }
                                  }
                                }}
                                className={`flex-1 py-1.5 text-xs font-black rounded border transition ${penaltyH === 'AO' ? 'bg-blue-600 border-blue-400 text-white shadow-lg' : 'bg-blue-950/20 border-blue-900/30 text-blue-500 hover:bg-blue-950/50'}`}
                              >
                                <div className="flex flex-col items-center gap-0.5 leading-none py-0.5">
                                  <span>(H)</span>
                                  <span className="text-[8.5px] opacity-90">AO</span>
                                </div>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                const activeScores = activeScoringTab === 'AKA' ? judgeScoresA : judgeScoresB;
                const isDiscarded = getScoreStatusIndex(activeScores, idx) !== 'active';
                const score = activeScores[idx] !== undefined ? activeScores[idx] : 8.0;

                return (
                  <div
                    key={idx}
                    className={`${onClose ? 'p-1.5' : 'p-3'} rounded-xl border flex flex-col items-center transition relative ${
                      isDiscarded
                        ? 'bg-red-950/20 border-red-500/40 opacity-70'
                        : activeScoringTab === 'AKA'
                        ? 'bg-red-950/10 border-red-500/30'
                        : 'bg-blue-950/10 border-blue-500/30'
                    }`}
                  >
                    <span className="text-[10px] font-bold uppercase text-gray-400 mb-1">
                      Judge {idx + 1}
                    </span>

                    {/* Discard Tag */}
                    {isDiscarded && (
                      <span className="text-[8px] font-black uppercase text-red-400 bg-red-950/60 px-1 py-0.5 rounded border border-red-500/30 mb-1">
                        {getScoreStatusIndex(activeScores, idx) === 'max' ? 'MAX' : 'MIN'}
                      </span>
                    )}

                    <div className={`text-2xl font-black font-mono my-1 ${isDiscarded ? 'line-through text-red-400 opacity-60' : 'text-white'}`}>
                      {score.toFixed(1)}
                    </div>

                    {/* Stepper Buttons */}
                    <div className={`flex gap-1 ${onClose ? 'mt-1' : 'mt-2'} w-full`}>
                      <button
                        onClick={() => updateJudgeScore(activeScoringTab, idx, score - 0.1)}
                        className={`flex-1 ${onClose ? 'py-0.5' : 'py-1'} bg-white/5 hover:bg-white/10 text-white font-bold text-xs rounded transition`}
                      >
                        -
                      </button>
                      <button
                        onClick={() => updateJudgeScore(activeScoringTab, idx, score + 0.1)}
                        className={`flex-1 ${onClose ? 'py-0.5' : 'py-1'} bg-white/5 hover:bg-white/10 text-white font-bold text-xs rounded transition`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

          </div>

          {/* Winner Declaration & Action Toolbar (Reduced Height, Big Fonts) */}
          <div className={`${onClose ? 'p-2.5 gap-2.5' : 'p-3 sm:p-3.5 gap-3.5'} bg-gradient-to-r from-yellow-950/30 via-[#12131c] to-yellow-950/30 border-2 border-yellow-500/40 rounded-2xl flex flex-col md:flex-row items-center justify-between shadow-2xl shrink-0`}>
            
            {/* Winner Announcement */}
            <div className="flex items-center gap-3">
              <div className={`${onClose ? 'p-1.5 rounded-xl' : 'p-2.5 rounded-2xl'} bg-yellow-400/20 text-yellow-400 border-2 border-yellow-400/40 shadow-lg shadow-yellow-950/50`}>
                <Trophy className={`${onClose ? 'h-6 w-6' : 'h-8 w-8'} animate-bounce`} />
              </div>
              <div>
                <span className="text-xs font-black uppercase tracking-widest text-yellow-400">
                  DECISION / WINNER DETERMINATION
                </span>
                <h3 className="text-2xl sm:text-3xl lg:text-4xl font-black text-white leading-tight flex flex-col">
                  {isWinnerRevealed || currentBout?.status === 'Completed' ? (
                    selectedWinnerId === participantA?.id ? (
                      <>
                        <span className="text-red-400 drop-shadow-[0_0_15px_rgba(239,68,68,0.6)]">{participantA?.full_name} (AKA WINNER)</span>
                        <span className="text-sm text-red-300/80 font-bold uppercase tracking-widest">{clubA?.name || ''}</span>
                      </>
                    ) : selectedWinnerId === participantB?.id ? (
                      <>
                        <span className="text-blue-400 drop-shadow-[0_0_15px_rgba(59,130,246,0.6)]">{participantB?.full_name} (AO WINNER)</span>
                        <span className="text-sm text-blue-300/80 font-bold uppercase tracking-widest">{clubB?.name || ''}</span>
                      </>
                    ) : (
                      'Tied Score'
                    )
                  ) : (
                    <span className="text-gray-400 font-bold text-sm sm:text-base italic">Press "Save Result" to calculate & reveal winner</span>
                  )}
                </h3>
              </div>
            </div>

            {/* Primary Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5">

              <button
                onClick={handleRematch}
                disabled={isSaving || !currentBout}
                className={`flex items-center gap-2 px-3.5 ${onClose ? 'py-2' : 'py-2.5'} bg-red-500/10 hover:bg-red-500/20 text-red-500 border-2 border-red-500/30 font-black text-sm sm:text-base rounded-xl transition cursor-pointer disabled:opacity-50`}
              >
                <RefreshCw className="h-4 w-4" />
                Reset Match
              </button>
              <button
                onClick={handleClearFlags}
                disabled={isSaving || !currentBout || scoringMethod === 'Points'}
                className={`flex items-center gap-2 px-3.5 ${onClose ? 'py-2' : 'py-2.5'} bg-gray-500/10 hover:bg-gray-500/20 text-gray-300 border-2 border-gray-500/30 font-black text-sm sm:text-base rounded-xl transition cursor-pointer disabled:opacity-50`}
              >
                <Flag className="h-4 w-4" />
                Clear Flags
              </button>
              <button
                onClick={handleSaveResult}
                disabled={isSaving || !currentBout}
                className={`flex items-center gap-2 px-5 ${onClose ? 'py-2' : 'py-2.5'} bg-blue-600 hover:bg-blue-500 text-white font-black text-sm sm:text-base rounded-xl transition cursor-pointer shadow-xl shadow-blue-600/30 disabled:opacity-50`}
              >
                <Save className="h-4 w-4" />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleSaveAndCompleteBout}
                disabled={isSaving || !currentBout}
                className={`flex items-center gap-2 px-5 ${onClose ? 'py-2' : 'py-3'} bg-yellow-400 hover:bg-yellow-300 text-black font-black text-sm rounded-xl transition cursor-pointer shadow-lg shadow-yellow-400/20 disabled:opacity-50`}
              >
                <CheckCircle2 className="h-4 w-4" />
                {isSaving ? 'Completing...' : 'Complete & Advance'}
              </button>
            </div>

          </div>

        </div>

      </div>

      {/* Result Book Modal */}
      <KataResultBookModal
        isOpen={isResultBookOpen}
        onClose={() => setIsResultBookOpen(false)}
        bout={currentBout}
        category={category}
        participantA={participantA}
        participantB={participantB}
        clubA={clubA}
        clubB={clubB}
        judgeScoresA={judgeScoresA}
        judgeScoresB={judgeScoresB}
        totalScoreA={totalScoreA}
        totalScoreB={totalScoreB}
        kataA={kataA}
        kataB={kataB}
        winnerId={selectedWinnerId}
        clubsList={clubs}
      />

      {showSpectatorModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-[#101015] border border-white/10 rounded-2xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-black text-white mb-2">Open Spectator Display</h3>
            <p className="text-gray-400 text-sm mb-6">How would you like to open the spectator view?</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => {
                  openSpectatorWindow(currentBout?.id, 'new-tab');
                  setShowSpectatorModal(false);
                }}
                className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition cursor-pointer"
              >
                Open in New Tab
              </button>
              <button
                onClick={() => {
                  openSpectatorWindow(currentBout?.id, 'new-window');
                  setShowSpectatorModal(false);
                }}
                className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition cursor-pointer"
              >
                Open in New Window
              </button>
              <button
                onClick={() => {
                  if (spectatorWindowRef.current) {
                    spectatorWindowRef.current.close();
                    spectatorWindowRef.current = null;
                  }
                  if (broadcastChannelRef.current) {
                    broadcastChannelRef.current.postMessage({ type: 'CLOSE_DISPLAY' });
                  }
                  setShowSpectatorModal(false);
                }}
                className="w-full py-3 bg-red-600/20 hover:bg-red-600/40 text-red-400 font-bold rounded-xl border border-red-500/30 transition cursor-pointer"
              >
                Close Existing Display
              </button>
              <button
                onClick={() => setShowSpectatorModal(false)}
                className="w-full py-3 bg-white/5 hover:bg-white/10 text-gray-300 font-bold rounded-xl transition mt-2 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OFFICIAL WKF KATA LIST MODAL */}
      <KataListModal
        isOpen={isKataListOpen}
        onClose={() => setIsKataListOpen(false)}
      />

    </div>
  );
});

export default function KataControlPanelPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#07070a] flex items-center justify-center text-white/40 font-bold uppercase tracking-widest text-xs">
        Loading Kata Control Panel...
      </div>
    }>
      <KataControlPanelContent />
    </Suspense>
  );
}
