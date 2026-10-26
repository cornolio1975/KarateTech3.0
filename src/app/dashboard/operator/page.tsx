'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { db, basePath } from '@/db/dbClient';
import { Bout, Participant, Category, Club, Coach, Official, isKumiteCategory, isKataCategory } from '@/db/types';
import { useTournament } from '@/context/TournamentContext';
import {
  DEFAULT_VR_SETTINGS,
  buildVrPath,
  buildVideoConstraints,
  getMatchCode,
  getResolutionDimensions,
  resolveCameraSelection,
  sanitizeFileSystemName,
  type VrRecordingSettings,
} from '@/lib/vr';
import {
  Trophy, List, Users, UserSquare2, Timer, Clock, FileText,
  ChevronRight, FolderOpen, ClipboardList, Users2, ShieldCheck, Shield, Phone, Mail,
  Flag, Undo2, LockOpen, CheckCircle2, Save, Printer,
  Monitor, Radio, Lock, Cpu, Settings, MoreHorizontal,
  Search, Download, X, Play, Pause, RotateCcw,
  Maximize2, SlidersHorizontal, Trash2, Filter,
  Zap, RefreshCw, Wifi, WifiOff, ArrowRight, ArrowLeft, BarChart3, ExternalLink,
  ChevronUp, ChevronDown, ChevronLeft, ZoomIn, ZoomOut, Tv, GripHorizontal, BookOpen,
  Palette, Camera, ChevronDown as ChevronDownIcon
} from 'lucide-react';
import { KumiteScoreboardControl, ScoreboardRef } from '@/components/KumiteControlWorkspace';
import { KataControlPanelContent } from '@/components/KataControlWorkspace';
import { SportdataBracket } from '@/components/SportdataBracket';
import KataListModal from '@/components/KataListModal';
import EditParticipantDrawer from '@/components/EditParticipantDrawer';
import PlayerPhotoModal from '@/components/PlayerPhotoModal';

interface KeyLogEntry {
  id: string;
  time: string;
  category: 'SYSTEM' | 'REFEREE' | 'SCORE' | 'PENALTY' | 'TIMER' | 'RESULT';
  message: string;
}

function nowTime() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatTimer(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function calculateAge(dobString?: string) {
  if (!dobString) return null;
  const birthDate = new Date(dobString);
  const today = new Date();
  const age = today.getFullYear() - birthDate.getFullYear();
  return isNaN(age) ? null : age;
}

const LiveSystemStatus = ({ effectiveTatami, userEmail, isOnline, dbStatus }: { effectiveTatami: number, userEmail: string, isOnline: boolean, dbStatus: 'CONNECTED' | 'LOCAL' | 'OFFLINE' }) => {
  const [time, setTime] = useState(new Date());
  
  // A true "Cloud Online" state requires BOTH the browser to be online AND the database to be CONNECTED.
  const isCloudOnline = isOnline && dbStatus === 'CONNECTED';
  
  const [cloudRestored, setCloudRestored] = useState(false);
  const [prevCloud, setPrevCloud] = useState(isCloudOnline);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!prevCloud && isCloudOnline) {
      setCloudRestored(true);
      const to = setTimeout(() => setCloudRestored(false), 5000);
      return () => clearTimeout(to);
    }
    setPrevCloud(isCloudOnline);
  }, [isCloudOnline, prevCloud]);

  if (cloudRestored) {
    return (
      <div className="w-[145px] shrink-0 px-3 py-2 flex flex-col justify-center h-full bg-[#0a0c10]">
        <div className="text-[7px] font-black uppercase tracking-widest text-white/30 mb-2">SYSTEM STATUS</div>
        <div className="text-[7px] font-bold text-green-400 mb-1 leading-tight">CLOUD CONNECTION RESTORED</div>
        <div className="text-[7px] font-bold text-green-400 animate-pulse">SYNCING...</div>
      </div>
    );
  }

  let statusHeader = '';
  let statusColor = '';
  let dotColor = '';

  if (isCloudOnline) {
    statusHeader = 'CLOUD ONLINE';
    statusColor = 'text-green-400';
    dotColor = 'bg-green-400';
  } else if (dbStatus === 'LOCAL') {
    statusHeader = 'LOCAL SERVER';
    statusColor = 'text-orange-400';
    dotColor = 'bg-orange-400';
  } else {
    statusHeader = 'DISCONNECTED';
    statusColor = 'text-red-400';
    dotColor = 'bg-red-400';
  }

  const timeStr = time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="w-[145px] shrink-0 px-2 py-1.5 flex flex-col justify-center gap-0.5 h-full bg-[#0a0c10]">
      <div className="text-[7px] font-black uppercase tracking-widest text-white/30 mb-0.5">SYSTEM STATUS</div>
      <div className={`flex items-center gap-1.5 text-[8px] font-bold ${statusColor} mb-1`}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor} ${isCloudOnline ? 'animate-pulse' : ''}`} />
        {statusHeader}
      </div>
      
      <div className="flex flex-col gap-[3px] text-[6.5px] leading-tight w-full">
        <div className="flex items-center justify-between w-full">
          <span className="text-white/30 shrink-0">Console:</span>
          <span className="text-white/70 font-mono truncate">TATAMI {effectiveTatami}</span>
        </div>
        
        {isCloudOnline || dbStatus === 'LOCAL' ? (
          <>
            <div className="flex items-center justify-between w-full">
              <span className="text-white/30 shrink-0">User:</span>
              <span className="text-white/70 font-mono truncate max-w-[80px]" title={userEmail || 'unknown'}>
                {userEmail || 'unknown'}
              </span>
            </div>
            <div className="flex items-center justify-between w-full">
              <span className="text-white/30 shrink-0">Connection:</span>
              <span className={`font-bold truncate ${isCloudOnline ? 'text-green-400' : 'text-orange-400'}`}>{isCloudOnline ? 'Cloud' : 'Local Server'}</span>
            </div>
            {(!isCloudOnline && dbStatus === 'LOCAL') && (
              <div className="flex items-center justify-between w-full">
                <span className="text-white/30 shrink-0">Cloud:</span>
                <span className="font-bold text-red-400">OFFLINE</span>
              </div>
            )}
            <div className="flex items-center justify-between w-full">
              <span className="text-white/30 shrink-0">Sync:</span>
              <span className={`font-bold ${isCloudOnline ? 'text-green-400' : 'text-orange-400'}`}>{isCloudOnline ? 'LIVE' : 'LOCAL'}</span>
            </div>
            <div className="flex items-center justify-between w-full mt-0.5 pt-0.5 border-t border-white/5">
              <span className="text-white/30 shrink-0">Heartbeat:</span>
              <span className="text-white font-mono shrink-0">{timeStr}</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between w-full">
              <span className="text-white/30 shrink-0">Cloud:</span>
              <span className="font-bold text-red-400">OFFLINE</span>
            </div>
            <div className="flex items-center justify-between w-full">
              <span className="text-white/30 shrink-0">Local:</span>
              <span className="font-bold text-red-400">OFFLINE</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default function OperatorConsolePage() {
  const router = useRouter();
  const { 
    tournamentName, 
    activeTournamentId, 
    tatamiId, 
    takeoverTatami, 
    userRole, 
    userEmail,
    updateTatamiTelemetry,
    consoleTheme,
    setConsoleTheme
  } = useTournament();

  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [localTatamiParam, setLocalTatamiParam] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const tParam = urlParams.get('tatami') || urlParams.get('tatamiId');
      if (tParam) {
        const parsed = parseInt(tParam.replace(/\D/g, ''), 10);
        if (parsed === 1 || parsed === 2) {
          setLocalTatamiParam(parsed);
        }
      }
    }
  }, []);

  const isLockedOutByAdmin = userRole !== 'Admin' && takeoverTatami === tatamiId;

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isStandby, setIsStandby] = useState(false);
  const [bouts, setBouts] = useState<Bout[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [officials, setOfficials] = useState<Official[]>([]);
  const [isOfficialsModalOpen, setIsOfficialsModalOpen] = useState(false);
  const [selectedProfileModal, setSelectedProfileModal] = useState<{ participant: Participant; corner: 'AKA' | 'AO' } | null>(null);
  const [editParticipantId, setEditParticipantId] = useState<string | null>(null);
  const [photoModalParticipant, setPhotoModalParticipant] = useState<Participant | null>(null);

  const [activeBout, setActiveBout] = useState<Bout | null>(null);
  const [activeCat, setActiveCat] = useState<Category | null>(null);
  const [akaFighter, setAkaFighter] = useState<Participant | null>(null);
  const [aoFighter, setAoFighter] = useState<Participant | null>(null);
  
  const effectiveTatami = (takeoverTatami || tatamiId || localTatamiParam || activeBout?.tatami || 1) as 1 | 2;

  const [liveScoreAka, setLiveScoreAka] = useState(0);
  const [liveScoreAo, setLiveScoreAo] = useState(0);
  const [senshuAka, setSenshuAka] = useState(false);
  const [senshuAo, setSenshuAo] = useState(false);

  const [timerSeconds, setTimerSeconds] = useState(180);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [extraTimerOpen, setExtraTimerOpen] = useState(false);
  const [extraTimerBroadcast, setExtraTimerBroadcast] = useState(false);
  const extraTimerBroadcastRef = useRef(false);
  useEffect(() => { extraTimerBroadcastRef.current = extraTimerBroadcast; }, [extraTimerBroadcast]);

  const [extraTime, setExtraTime] = useState(300);
  const [extraRunning, setExtraRunning] = useState(false);
  const extraTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const broadcastExtraTimer = (time: number, running: boolean, show: boolean) => {
    if (typeof window !== 'undefined') {
      const channel = new BroadcastChannel('wkf-scoreboard-sync');
      channel.postMessage({ type: 'EXTRA_TIMER_TICK', extraTime: time, extraRunning: running, show });
      channel.close();
    }
  };

  const [playerDetailsOpen, setPlayerDetailsOpen] = useState(true);

  const [keyLog, setKeyLog] = useState<KeyLogEntry[]>([
    { id: '1', time: nowTime(), category: 'SYSTEM', message: 'OPERATOR CONSOLE READY' },
  ]);
  const [keyLogTab, setKeyLogTab] = useState<'ALL' | 'SCORE' | 'PENALTY' | 'TIMER' | 'SYSTEM'>('ALL');
  const [keyLogSearch, setKeyLogSearch] = useState('');

  const [bracketTab, setBracketTab] = useState<'BRACKET CONSOLE' | 'CHART' | 'MATCH LIST' | 'QUEUE'>('BRACKET CONSOLE');
  const [disciplineFilter, setDisciplineFilter] = useState<'ALL' | 'KUMITE' | 'KATA'>('ALL');
  const [selectedCatId, setSelectedCatId] = useState<string>('ALL');

  const [expandModal, setExpandModal] = useState<{ open: boolean; terminal: string; targetUrl: string } | null>(null);
  const [isControlPanelOpen, setIsControlPanelOpen] = useState(false);
  const scoreboardRef = useRef<ScoreboardRef>(null);

  const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);
  const [notesText, setNotesText] = useState('');

  const [isLoadMatchModalOpen, setIsLoadMatchModalOpen] = useState(false);
  const [loadMatchSearch, setLoadMatchSearch] = useState('');
  const [expandedCatId, setExpandedCatId] = useState<string | null>(null);
  const [isPlayerDetailsDisplayShowing, setIsPlayerDetailsDisplayShowing] = useState(false);

  const [isBracketModalOpen, setIsBracketModalOpen] = useState(false);
  const [bracketModalCatId, setBracketModalCatId] = useState<string>('ALL');
  const [isKataListModalOpen, setIsKataListModalOpen] = useState(false);

  const [dockOrder, setDockOrder] = useState<string[]>([]);
  const [draggedDockId, setDraggedDockId] = useState<string | null>(null);
  const [dragOverDockId, setDragOverDockId] = useState<string | null>(null);

  const [vrSettings, setVrSettings] = useState<VrRecordingSettings>(DEFAULT_VR_SETTINGS);
  const [vrDevices, setVrDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [vrRecordingActive, setVrRecordingActive] = useState(false);
  const [vrRecordingSeconds, setVrRecordingSeconds] = useState(0);
  const [vrPreviewOpen, setVrPreviewOpen] = useState(false);
  const [vrError, setVrError] = useState<string | null>(null);
  const [vrCameraLabel, setVrCameraLabel] = useState('Webcam');
  const [vrResultPath, setVrResultPath] = useState<string | null>(null);
  const [vrPreviewPosition, setVrPreviewPosition] = useState({ x: 32, y: 32 });
  const [vrPlaybackOpen, setVrPlaybackOpen] = useState(false);
  const [vrPlaybackSearch, setVrPlaybackSearch] = useState('');
  const [vrPlaybackCategory, setVrPlaybackCategory] = useState('ALL');
  const [vrPlaybackSelectedId, setVrPlaybackSelectedId] = useState<string | null>(null);
  const vrStreamRef = useRef<MediaStream | null>(null);
  const vrRecorderRef = useRef<MediaRecorder | null>(null);
  const vrVideoRef = useRef<HTMLVideoElement | null>(null);
  const vrPlaybackVideoRef = useRef<HTMLVideoElement | null>(null);
  const vrChunksRef = useRef<BlobPart[]>([]);
  const vrDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const vrRecordingActiveRef = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('kt_operator_dock_order');
      if (saved) setDockOrder(JSON.parse(saved));
      const savedVrSettings = localStorage.getItem('kt_vr_settings');
      if (savedVrSettings) {
        const parsed = JSON.parse(savedVrSettings) as Partial<VrRecordingSettings>;
        setVrSettings({ ...DEFAULT_VR_SETTINGS, ...parsed });
      }
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('kt_vr_settings', JSON.stringify(vrSettings));
    }
  }, [vrSettings]);

  const formatRecordingDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const vrPlaybackEntries = useMemo(() => {
    return bouts
      .filter((bout) => !!bout.vr_file_url)
      .map((bout) => {
        const category = categories.find((cat) => cat.id === bout.category_id);
        const aka = participants.find((participant) => participant.id === bout.participant_a_id);
        const ao = participants.find((participant) => participant.id === bout.participant_b_id);
        const matchCode = getMatchCode(bout.round_no, bout.bout_no);
        return {
          id: bout.id,
          categoryId: bout.category_id,
          categoryName: category?.name || 'General',
          matchCode,
          label: `R${bout.round_no}B${bout.bout_no}`,
          recordedAt: bout.vr_recorded_at || bout.created_at || new Date().toISOString(),
          duration: bout.vr_duration_seconds || 0,
          cameraLabel: bout.vr_camera_label || 'Webcam',
          url: bout.vr_file_url || '',
          akaName: aka?.full_name || 'AKA Red',
          aoName: ao?.full_name || 'AO Blue',
        };
      })
      .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
  }, [bouts, categories, participants]);

  const filteredVrPlaybackEntries = useMemo(() => {
    const term = vrPlaybackSearch.trim().toLowerCase();
    return vrPlaybackEntries.filter((entry) => {
      const matchesCategory = vrPlaybackCategory === 'ALL' || entry.categoryId === vrPlaybackCategory;
      const matchesSearch = !term || [
        entry.categoryName,
        entry.matchCode,
        entry.label,
        entry.akaName,
        entry.aoName,
      ].some((value) => value.toLowerCase().includes(term));
      return matchesCategory && matchesSearch;
    });
  }, [vrPlaybackCategory, vrPlaybackEntries, vrPlaybackSearch]);

  const selectedVrPlaybackEntry = useMemo(() => {
    if (!filteredVrPlaybackEntries.length) return null;
    if (vrPlaybackSelectedId) {
      const match = filteredVrPlaybackEntries.find((entry) => entry.id === vrPlaybackSelectedId);
      if (match) return match;
    }
    const currentMatch = activeBout && activeBout.vr_file_url
      ? filteredVrPlaybackEntries.find((entry) => entry.id === activeBout.id)
      : null;
    if (currentMatch) return currentMatch;
    return filteredVrPlaybackEntries[0];
  }, [activeBout, filteredVrPlaybackEntries, vrPlaybackSelectedId]);

  const openVrPlayback = useCallback(() => {
    setVrPlaybackOpen(true);
    const preferred = activeBout?.vr_file_url ? activeBout.id : null;
    if (preferred && !vrPlaybackSelectedId) {
      setVrPlaybackSelectedId(preferred);
    }
  }, [activeBout?.id, activeBout?.vr_file_url, vrPlaybackSelectedId]);

  const addLog = useCallback((category: KeyLogEntry['category'], message: string) => {
    setKeyLog(prev => [{
      id: crypto.randomUUID(),
      time: nowTime(),
      category,
      message
    }, ...prev].slice(0, 200));
  }, []);

  const refreshVrDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [] as Array<{ deviceId: string; label: string }>;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(device => device.kind === 'videoinput').map(device => ({
        deviceId: device.deviceId || `camera-${Math.random().toString(16).slice(2)}`,
        label: device.label || 'Camera'
      }));
      setVrDevices(cams);
      return cams;
    } catch (err) {
      setVrError('Unable to read connected webcam devices.');
      return [] as Array<{ deviceId: string; label: string }>;
    }
  }, []);

  useEffect(() => {
    void refreshVrDevices();
  }, [refreshVrDevices]);

  useEffect(() => {
    vrRecordingActiveRef.current = vrRecordingActive;
  }, [vrRecordingActive]);

  useEffect(() => {
    if (!vrRecordingActive) return;
    const intervalId = window.setInterval(() => {
      setVrRecordingSeconds(current => current + 1);
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [vrRecordingActive]);

  const releaseVrStream = useCallback(() => {
    if (vrStreamRef.current) {
      vrStreamRef.current.getTracks().forEach(track => track.stop());
      vrStreamRef.current = null;
    }
    if (vrVideoRef.current) {
      vrVideoRef.current.srcObject = null;
    }
    vrRecorderRef.current = null;
    vrChunksRef.current = [];
  }, []);

  useEffect(() => {
    if (!vrPreviewOpen || !vrVideoRef.current || !vrStreamRef.current) return;
    vrVideoRef.current.srcObject = vrStreamRef.current;
    void vrVideoRef.current.play().catch(() => undefined);
  }, [vrPreviewOpen]);

  const handleVrRecordingFailure = useCallback((message: string) => {
    setVrError(message);
    setVrRecordingActive(false);
    setVrPreviewOpen(false);
    setVrRecordingSeconds(0);
    setVrCameraLabel('Webcam');
    releaseVrStream();
    addLog('SYSTEM', `VR Recording Error: ${message}`);
  }, [addLog, releaseVrStream]);

  const stopVrRecording = useCallback(async () => {
    const recorder = vrRecorderRef.current;
    if (!recorder) {
      releaseVrStream();
      setVrRecordingActive(false);
      setVrPreviewOpen(false);
      setVrRecordingSeconds(0);
      setVrCameraLabel('Webcam');
      return;
    }

    if (recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch (err) {
        handleVrRecordingFailure('Unable to stop the webcam recording.');
      }
      return;
    }

    releaseVrStream();
    setVrRecordingActive(false);
    setVrPreviewOpen(false);
    setVrRecordingSeconds(0);
    setVrCameraLabel('Webcam');
  }, [handleVrRecordingFailure, releaseVrStream]);

  const finishVrRecording = useCallback(async (blob: Blob, cameraLabel: string) => {
    if (!activeBout) {
      handleVrRecordingFailure('No active match is loaded for VR recording.');
      return;
    }

    const categoryName = activeCat?.name || 'General';
    const matchCode = getMatchCode(activeBout.round_no, activeBout.bout_no);
    const fileName = `${matchCode}_${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_')}.webm`;
    const folderPath = buildVrPath(categoryName, matchCode);
    const form = new FormData();
    form.append('file', blob, fileName);
    form.append('fileName', fileName);
    form.append('folderPath', folderPath);
    form.append('metadata', JSON.stringify({
      recordingId: `vr_${Date.now()}`,
      tournamentId: activeTournamentId || 'local',
      category: categoryName,
      categoryId: activeBout.category_id,
      round: activeBout.round_no,
      bout: activeBout.bout_no,
      matchId: activeBout.id,
      matchKey: matchCode,
      akaName: akaFighter?.full_name || 'AKA Red',
      aoName: aoFighter?.full_name || 'AO Blue',
      cameraDevice: cameraLabel,
      resolution: vrSettings.resolution,
      fileName,
      filePath: `${folderPath}/${fileName}`,
      startedAt: new Date(Date.now() - vrRecordingSeconds * 1000).toISOString(),
      endedAt: new Date().toISOString(),
      duration: vrRecordingSeconds,
      status: 'completed',
    }));

    try {
      const response = await fetch('/api/vr/upload', {
        method: 'POST',
        body: form,
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'VR upload failed.');
      }

      const updatedVrUrl = payload.publicUrl || payload.filePath || `${folderPath}/${fileName}`;
      const updatedMetadata = {
        ...(payload.metadata || {}),
        filePath: payload.filePath || `${folderPath}/${fileName}`,
        publicUrl: updatedVrUrl,
        cameraDevice: cameraLabel,
        duration: payload.duration || vrRecordingSeconds,
      };

      const savedBout = await db.bouts.update(activeBout.id, {
        vr_file_url: updatedVrUrl,
        vr_metadata: updatedMetadata,
        vr_recorded_at: new Date().toISOString(),
        vr_duration_seconds: payload.duration || vrRecordingSeconds,
        vr_camera_label: cameraLabel,
      });

      setActiveBout(prev => prev ? { ...prev, ...savedBout } : prev);
      setBouts(prev => prev.map(b => b.id === activeBout.id ? { ...b, ...savedBout } : b));
      setVrResultPath(updatedVrUrl);
      setVrPreviewOpen(false);
      setVrRecordingActive(false);
      setVrRecordingSeconds(0);
      setVrCameraLabel('Webcam');
      addLog('SYSTEM', `VR Recording: Available`);
      addLog('SYSTEM', `Camera: ${cameraLabel}`);
      addLog('SYSTEM', `Duration: ${formatRecordingDuration(payload.duration || vrRecordingSeconds)}`);
      addLog('SYSTEM', `View Recording: ${updatedVrUrl}`);
      releaseVrStream();
    } catch (error: any) {
      handleVrRecordingFailure(error.message || 'VR upload failed.');
    }
  }, [activeBout, activeCat, activeTournamentId, addLog, akaFighter, aoFighter, handleVrRecordingFailure, releaseVrStream, vrRecordingSeconds, vrSettings.resolution]);

  const startVrRecording = useCallback(async () => {
    if (!activeBout) {
      alert('Load a match before starting VR recording.');
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      handleVrRecordingFailure('This browser does not support webcam recording.');
      return;
    }

    try {
      const cameras = await refreshVrDevices();
      if (!cameras.length) {
        alert('No webcam detected. Please connect a webcam before starting VR.');
        return;
      }

      const selectedCamera = resolveCameraSelection(vrSettings.cameraDeviceId, cameras) || cameras[0];
      const videoConstraints = buildVideoConstraints({
        deviceId: selectedCamera?.deviceId,
        resolution: vrSettings.resolution,
        frameRate: vrSettings.frameRate,
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });

      const cameraLabel = selectedCamera.label || 'Webcam';
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
          ? 'video/webm;codecs=vp8'
          : 'video/webm';

      vrStreamRef.current = stream;
      if (vrVideoRef.current) {
        vrVideoRef.current.srcObject = stream;
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      vrChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          vrChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = async () => {
        const blob = new Blob(vrChunksRef.current, { type: mimeType || 'video/webm' });
        if (blob.size === 0) {
          handleVrRecordingFailure('The webcam recording was empty and could not be saved.');
          return;
        }
        await finishVrRecording(blob, cameraLabel);
        releaseVrStream();
      };
      recorder.onerror = () => {
        handleVrRecordingFailure('Webcam recording failed while capturing video.');
      };

      vrRecorderRef.current = recorder;
      setVrCameraLabel(cameraLabel);
      setVrError(null);
      setVrPreviewOpen(true);
      setVrRecordingSeconds(0);
      setVrRecordingActive(true);
      recorder.start(250);
      addLog('SYSTEM', `VR Recording: Available`);
      addLog('SYSTEM', `Camera: ${cameraLabel}`);
    } catch (error: any) {
      const message = error?.message || 'Unable to access the webcam.';
      if (message.includes('Permission')) {
        alert('Camera access was denied. Please allow webcam permission to start VR recording.');
      }
      handleVrRecordingFailure(message.includes('Permission') ? 'Webcam permission was denied.' : 'Unable to start webcam recording.');
    }
  }, [activeBout, addLog, finishVrRecording, handleVrRecordingFailure, refreshVrDevices, releaseVrStream, vrSettings.cameraDeviceId, vrSettings.frameRate, vrSettings.resolution]);

  const handleVrToggle = useCallback(async () => {
    if (vrRecordingActive) {
      await stopVrRecording();
      return;
    }
    await startVrRecording();
  }, [startVrRecording, stopVrRecording, vrRecordingActive]);

  const autoStopVrRecording = useCallback(async (reason?: string) => {
    if (!vrRecordingActive) return;
    await stopVrRecording();
    if (reason) {
      addLog('SYSTEM', reason);
    }
  }, [addLog, stopVrRecording, vrRecordingActive]);

  useEffect(() => {
    return () => {
      if (vrRecordingActiveRef.current) {
        try {
          vrRecorderRef.current?.stop();
        } catch (err) {}
      }
      releaseVrStream();
    };
  }, [releaseVrStream]);

  const guardVrMatchTransition = useCallback((reason: string) => {
    if (!vrRecordingActive) return true;
    void autoStopVrRecording(reason);
    return true;
  }, [autoStopVrRecording, vrRecordingActive]);

  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = 0;
    }
  }, [keyLog]);

  const chartScrollRef = useRef<HTMLDivElement>(null);
  const [chartZoom, setChartZoom] = useState<number>(0.6);

  const scrollChart = (dx: number, dy: number) => {
    if (chartScrollRef.current) {
      chartScrollRef.current.scrollBy({ left: dx, top: dy, behavior: 'smooth' });
    }
  };

  const handleChartClick = () => {
    if (activeBout?.category_id) {
      setSelectedCatId(activeBout.category_id);
    }
    setBracketTab('CHART');
  };

  const [isOnline, setIsOnline] = useState(true);
  const [dbStatus, setDbStatus] = useState<'CONNECTED' | 'LOCAL' | 'OFFLINE'>('CONNECTED');

  const updateBout = useCallback(async (updates: Partial<Bout>) => {
    if (!activeBout) return;
    try {
      await db.bouts.update(activeBout.id, updates);
      setActiveBout(prev => prev ? { ...prev, ...updates } : null);
      setBouts(prev => prev.map(b => b.id === activeBout.id ? { ...b, ...updates } : b));
      if (typeof window !== 'undefined' && (window as any)._broadcastFullState) {
        (window as any)._broadcastFullState();
      }
    } catch (err) {
      console.error('Error updating bout:', err);
    }
  }, [activeBout, setBouts, setActiveBout]);

  const loadBout = useCallback(async (bout: Bout, pList?: Participant[], catList?: Category[], shouldBroadcastDisplay: boolean = true) => {
    if (vrRecordingActive) {
      await autoStopVrRecording(`VR recording auto-stopped before loading match R${bout.round_no}B${bout.bout_no}.`);
    }

    const cArr = catList || categories;
    const pArr = pList || participants;
    const boutCat = cArr.find(c => c.id === bout.category_id);
    const configuredTimerSeconds = boutCat?.category_timer_seconds;
    // Only preserve the existing bout timer when the clock is ACTIVELY TICKING mid-match.
    // A paused or freshly loaded match (timer_active=false, even if status='Running') must
    // always receive the admin-configured category timer.
    const isTimerActivelyRunning = bout.status === 'Running' && bout.timer_active === true;
    const resolvedTimerSeconds = (configuredTimerSeconds !== undefined && !isTimerActivelyRunning)
      ? configuredTimerSeconds
      : (bout.timer_seconds || configuredTimerSeconds || 180);
    const loadedBout = resolvedTimerSeconds === bout.timer_seconds ? bout : { ...bout, timer_seconds: resolvedTimerSeconds };
    if (loadedBout !== bout) {
      await db.bouts.update(bout.id, { timer_seconds: resolvedTimerSeconds, timer_active: false });
      setBouts(previous => previous.map(item => item.id === bout.id ? loadedBout : item));
    }
    setActiveBout(loadedBout);
    setLiveScoreAka(bout.score_a);
    setLiveScoreAo(bout.score_b);
    setSenshuAka(bout.senshu_a || false);
    setSenshuAo(bout.senshu_b || false);
    setTimerSeconds(resolvedTimerSeconds);
    setAkaFighter(pArr.find(p => p.id === bout.participant_a_id) || null);
    setAoFighter(pArr.find(p => p.id === bout.participant_b_id) || null);
    setActiveCat(cArr.find(c => c.id === bout.category_id) || null);

    // Resolve which tatami this bout belongs to
    let catTatami: string | null = null;
    if (typeof window !== 'undefined') {
      try {
        const rawMap = localStorage.getItem('ts_cat_tatami_map');
        if (rawMap) {
          const parsedMap = JSON.parse(rawMap);
          catTatami = parsedMap[String(bout.category_id)];
        }
      } catch (e) {}
    }
    const assignedTatami = bout.tatami || (boutCat as any)?.assigned_tatami || catTatami;
    const boutTatamiNum = (assignedTatami === 'Tatami 2' || assignedTatami === '2') ? 2 : (assignedTatami === 'Tatami 1' || assignedTatami === '1') ? 1 : null;
    const effectiveTatami = (takeoverTatami || tatamiId || localTatamiParam || boutTatamiNum || 1) as 1 | 2;

    try {
      localStorage.setItem('kt_active_bout_id', bout.id);
      localStorage.setItem('ts_active_bout_id', bout.id);
      localStorage.setItem(`kt_active_bout_id_${effectiveTatami}`, bout.id);
      localStorage.setItem(`ts_active_bout_id_${effectiveTatami}`, bout.id);
    } catch (e) {}

    if (shouldBroadcastDisplay && typeof window !== 'undefined') {
      try {
        const channel = new BroadcastChannel('wkf-scoreboard-sync');
        const aka = pArr.find(p => p.id === bout.participant_a_id);
        const ao = pArr.find(p => p.id === bout.participant_b_id);
        channel.postMessage({
          type: 'SYNC_MATCH_STATE',
          boutId: bout.id,
          categoryId: bout.category_id,
          akaName: aka?.full_name || 'AKA Red',
          aoName: ao?.full_name || 'AO Blue',
          scoreAka: bout.score_a || 0,
          scoreAo: bout.score_b || 0,
          senshuAka: bout.senshu_a || false,
          senshuAo: bout.senshu_b || false,
          c1Aka: parseInt(bout.penalties_c1_a || '0') || 0,
          c1Ao: parseInt(bout.penalties_c1_b || '0') || 0,
          timeLeft: resolvedTimerSeconds * 10,
          timerActive: false,
          winner: null,
          winMethod: '',
          resultConfirmed: bout.status === 'Completed'
        });
        channel.close();
      } catch (e) {}
    }
 
    updateTatamiTelemetry({
      tatamiId: effectiveTatami,
      currentCategoryId: bout.category_id,
      currentCategoryName: cArr.find(c => c.id === bout.category_id)?.name || null,
      currentMatchId: bout.id,
      currentMatchCode: `R${bout.round_no}B${bout.bout_no}`,
      currentBoutNo: bout.bout_no,
      currentScreenState: shouldBroadcastDisplay ? (isKumiteCategory(boutCat) ? 'Kumite Scoreboard' : 'Kata Scoreboard') : 'Operator Console 2.0',
      isAdminControlled: takeoverTatami === effectiveTatami
    });

    addLog('SYSTEM', `Match R${bout.round_no}B${bout.bout_no} loaded to Current Match (Tatami ${effectiveTatami})`);
  }, [categories, guardVrMatchTransition, participants, takeoverTatami, tatamiId, localTatamiParam, updateTatamiTelemetry, vrRecordingActive, addLog]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [bList, pList, catList, clList, coList, oList] = await Promise.all([
        db.bouts.list(),
        db.participants.list(),
        db.categories.list(),
        db.clubs.list(),
        db.coaches.list(),
        db.officials.list(),
      ]);
      setBouts(bList);
      setParticipants(pList);
      setCategories(catList);
      setClubs(clList);
      setCoaches(coList);
      setOfficials(oList);
      
      const currentTatamiNum = takeoverTatami || tatamiId || localTatamiParam || 1;
      const myTatami = `Tatami ${currentTatamiNum}`;
      const running = bList.find(b => {
        if (b.status !== 'Running') return false;
        return b.tatami === myTatami;
      });
      if (running) {
        loadBout(running, pList, catList, false);
      } else if (typeof window !== 'undefined') {
        const storedBoutId = localStorage.getItem(`kt_active_bout_id_${currentTatamiNum}`) || (currentTatamiNum === 1 ? localStorage.getItem('kt_active_bout_id') : null);
        if (storedBoutId) {
          const savedBout = bList.find(b => b.id === storedBoutId);
          if (savedBout) loadBout(savedBout, pList, catList, false);
        }
      }
      addLog('SYSTEM', 'Data refreshed');
    } catch {
      setDbStatus('LOCAL');
      addLog('SYSTEM', 'Running in local mode');
    } finally {
      setLoading(false);
    }
  }, [loadBout, addLog, takeoverTatami, tatamiId, localTatamiParam]);

  useEffect(() => {
    const onOnline = () => { setIsOnline(true); setDbStatus('CONNECTED'); addLog('SYSTEM', 'Cloud connected'); };
    const onOffline = () => { setIsOnline(false); setDbStatus('LOCAL'); addLog('SYSTEM', 'Cloud offline — running locally'); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    setIsOnline(navigator.onLine);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [addLog]);

  const loadBoutRef = useRef(loadBout);
  useEffect(() => { loadBoutRef.current = loadBout; }, [loadBout]);

  const loadDataRef = useRef(loadData);
  useEffect(() => { loadDataRef.current = loadData; }, [loadData]);

  const boutsRef = useRef(bouts);
  useEffect(() => { boutsRef.current = bouts; }, [bouts]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const channel = new BroadcastChannel('wkf-scoreboard-sync');
    channel.onmessage = (event) => {
      const data = event.data;
      if (data?.type === 'LOAD_BOUT' && data.boutId) {
        const found = boutsRef.current.find(b => b.id === data.boutId);
        if (found) {
          loadBoutRef.current(found, undefined, undefined, false);
          if (data.categoryId) setSelectedCatId(data.categoryId);
          addLogRef.current('SYSTEM', `Loaded match R${found.round_no}B${found.bout_no} from Live Bracket`);
        } else {
          db.bouts.list().then(bList => {
            setBouts(bList);
            const b = bList.find(item => item.id === data.boutId);
            if (b) {
              loadBoutRef.current(b, undefined, undefined, false);
              if (data.categoryId) setSelectedCatId(data.categoryId);
            }
          });
        }
      } else if (
        data?.type === 'MATCH_FINISHED' ||
        data?.type === 'BOUT_UPDATED' ||
        data?.type === 'SHOW_RESULT' ||
        data?.type === 'SYNC_MATCH_STATE' ||
        data?.type === 'SYNC_FULL_STATE' ||
        data?.type === 'REFRESH_DATA' ||
        data?.type === 'REFRESH_DISPLAY'
      ) {
        loadDataRef.current();
      }
    };
    return () => channel.close();
  }, []);

  const boutIsKata = activeCat ? isKataCategory(activeCat) : false;

  const broadcastOperatorTimer = useCallback((secs: number, running: boolean) => {
    if (!activeBout || typeof window === 'undefined') return;
    try {
      const channel = new BroadcastChannel('wkf-scoreboard-sync');
      channel.postMessage({
        type: 'SYNC_MATCH_STATE',
        boutId: activeBout.id,
        categoryId: activeBout.category_id,
        akaName: akaFighter?.full_name || 'AKA Red',
        aoName: aoFighter?.full_name || 'AO Blue',
        scoreAka: boutIsKata ? Number(activeBout.total_score_a || activeBout.score_a || 0) : liveScoreAka,
        scoreAo: boutIsKata ? Number(activeBout.total_score_b || activeBout.score_b || 0) : liveScoreAo,
        senshuAka,
        senshuAo,
        c1Aka: parseInt(activeBout.penalties_c1_a || '0') || 0,
        c1Ao: parseInt(activeBout.penalties_c1_b || '0') || 0,
        timeLeft: secs * 10,
        timerActive: running,
        winner: null,
        winMethod: '',
        resultConfirmed: activeBout.status === 'Completed'
      });
      channel.close();
    } catch (e) {}
  }, [activeBout, akaFighter, aoFighter, boutIsKata, liveScoreAka, liveScoreAo, senshuAka, senshuAo]);

  const handleTimerToggle = () => {
    if (!activeBout) return;
    setTimerRunning(prev => {
      const isNowRunning = !prev;
      addLog('TIMER', isNowRunning ? 'Timer started' : 'Timer paused');
      broadcastOperatorTimer(timerSeconds, isNowRunning);
      if (!isNowRunning) {
        updateBout({ timer_seconds: timerSeconds, timer_active: false });
      } else if (activeBout.status !== 'Running') {
        updateBout({ status: 'Running', timer_active: true });
      } else {
        updateBout({ timer_active: true });
      }
      return isNowRunning;
    });
  };

  const handleTimerReset = () => {
    if (!activeBout) return;
    const defaultTime = (activeCat as any)?.time_duration || activeBout.timer_seconds || 180;
    setTimerSeconds(defaultTime);
    setTimerRunning(false);
    broadcastOperatorTimer(defaultTime, false);
    updateBout({ timer_seconds: defaultTime, timer_active: false });
    addLog('TIMER', 'Timer reset');
  };

  const addLogRef = useRef(addLog);
  useEffect(() => {
    addLogRef.current = addLog;
  }, [addLog]);

  const broadcastOperatorTimerRef = useRef(broadcastOperatorTimer);
  useEffect(() => {
    broadcastOperatorTimerRef.current = broadcastOperatorTimer;
  }, [broadcastOperatorTimer]);

  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => {
        setTimerSeconds(prev => {
          if (prev <= 0) { 
            setTimerRunning(false); 
            broadcastOperatorTimerRef.current(0, false);
            addLogRef.current('TIMER', 'Match time expired'); 
            return 0; 
          }
          const next = prev - 1;
          broadcastOperatorTimerRef.current(next, true);
          return next;
        });
      }, 1000);
    } else if (timerRef.current) clearInterval(timerRef.current);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  useEffect(() => {
    if (extraRunning) {
      extraTimerRef.current = setInterval(() => {
        setExtraTime(prev => { 
          if (prev <= 1) {
            setExtraRunning(false);
            if (extraTimerBroadcastRef.current) {
              broadcastExtraTimer(0, false, true);
            }
            addLogRef.current('TIMER', 'Extra Timer: Time expired (00:00)');
            return 0;
          }
          const next = prev - 1;
          if (extraTimerBroadcastRef.current) {
            broadcastExtraTimer(next, true, true);
          }
          return next; 
        });
      }, 1000);
    } else {
      if (extraTimerRef.current) {
        clearInterval(extraTimerRef.current);
        extraTimerRef.current = null;
      }
    }
    return () => {
      if (extraTimerRef.current) {
        clearInterval(extraTimerRef.current);
        extraTimerRef.current = null;
      }
    };
  }, [extraRunning]);

  useEffect(() => { setMounted(true); loadData(); }, []);

  // Discipline & Category Filtering (Sort: Age low->high, Male->Female)
  const getGenderRank = (g?: string) => (g === 'Male' ? 1 : g === 'Female' ? 2 : 3);
  const filteredCategories = categories
    .filter(c => {
      if (disciplineFilter === 'KUMITE') return isKumiteCategory(c);
      if (disciplineFilter === 'KATA') return isKataCategory(c);
      return true;
    })
    .sort((a, b) => 
      (a.min_age ?? 0) - (b.min_age ?? 0) || 
      getGenderRank(a.gender) - getGenderRank(b.gender) || 
      a.name.localeCompare(b.name)
    );

  const allBoutsFiltered = bouts.filter(b => {
    if (b.status === 'Walkover') return false;
    const cat = categories.find(c => c.id === b.category_id);
    if (disciplineFilter === 'KUMITE' && !isKumiteCategory(cat)) return false;
    if (disciplineFilter === 'KATA' && !isKataCategory(cat)) return false;
    return true;
  }).sort((a, b) => a.round_no - b.round_no || a.bout_no - b.bout_no);

  const catBouts = selectedCatId === 'ALL'
    ? allBoutsFiltered
    : allBoutsFiltered.filter(b => b.category_id === selectedCatId);

  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const toggleCategoryCollapse = (catId: string) => {
    setCollapsedCategories(prev => ({ ...prev, [catId]: !prev[catId] }));
  };

  // Group bouts by category for convenient hierarchical browsing in Bracket Console
  const groupedCategorySections = useMemo(() => {
    const targetCategories = selectedCatId === 'ALL'
      ? filteredCategories
      : filteredCategories.filter(c => c.id === selectedCatId);

    return targetCategories.map(cat => {
      const bList = allBoutsFiltered.filter(b => b.category_id === cat.id);
      const completedCount = bList.filter(b => b.status === 'Completed').length;
      const runningCount = bList.filter(b => b.status === 'Running').length;
      return {
        category: cat,
        bouts: bList,
        completedCount,
        runningCount,
        totalCount: bList.length
      };
    }).filter(group => selectedCatId !== 'ALL' || group.totalCount > 0);
  }, [filteredCategories, allBoutsFiltered, selectedCatId]);

  const chartCategoryId = selectedCatId !== 'ALL' ? selectedCatId : (activeBout?.category_id || categories[0]?.id || '');

  const filteredLog = keyLog.filter(e => (keyLogTab === 'ALL' || e.category === keyLogTab) && (!keyLogSearch || e.message.toLowerCase().includes(keyLogSearch.toLowerCase())));

  const controlPath = activeBout ? (boutIsKata ? `/dashboard/kata-control?boutId=${activeBout.id}` : `/dashboard/control?boutId=${activeBout.id}`) : '/dashboard/scoreboard';
  const activeIdx = activeBout ? allBoutsFiltered.findIndex(b => b.id === activeBout.id) : -1;
  const prevBout = activeIdx > 0 ? allBoutsFiltered[activeIdx - 1] : null;
  const nextBout = activeIdx >= 0 && activeIdx < allBoutsFiltered.length - 1 ? allBoutsFiltered[activeIdx + 1] : null;

  const c1A = parseInt(activeBout?.penalties_c1_a || '0') || 0;
  const c2A = parseInt(activeBout?.penalties_c2_a || '0') || 0;
  const hcA = activeBout?.penalties_a?.includes('HC') ? 1 : 0;
  const hA  = (activeBout?.penalties_a?.includes('H') && !activeBout?.penalties_a?.includes('HC')) ? 1 : 0;
  const c1B = parseInt(activeBout?.penalties_c1_b || '0') || 0;
  const c2B = parseInt(activeBout?.penalties_c2_b || '0') || 0;
  const hcB = activeBout?.penalties_b?.includes('HC') ? 1 : 0;
  const hB  = (activeBout?.penalties_b?.includes('H') && !activeBout?.penalties_b?.includes('HC')) ? 1 : 0;

  const boutLabel  = activeBout ? `R${activeBout.round_no}B${activeBout.bout_no}` : '—';
  const statusColor = activeBout?.status === 'Running' ? 'text-green-400 bg-green-900/40 border-green-600/50' : activeBout?.status === 'Completed' ? 'text-gray-400 bg-gray-900/40 border-gray-600/40' : 'text-gray-500 bg-gray-900/20 border-gray-700/30';

  const dockColorMap: Record<string, string> = {
    yellow: 'bg-yellow-500/15 border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/25',
    green:  'bg-green-600/15 border-green-600/40 text-green-400 hover:bg-green-600/25',
    red:    'bg-red-600/15 border-red-600/40 text-red-400 hover:bg-red-600/25',
    orange: 'bg-orange-500/15 border-orange-500/40 text-orange-400 hover:bg-orange-500/25',
    blue:   'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10',
  };

  const logColorMap: Record<string, string> = {
    SYSTEM: 'text-blue-400 bg-blue-500/10', REFEREE: 'text-yellow-400 bg-yellow-500/10',
    SCORE: 'text-green-400 bg-green-500/10', PENALTY: 'text-red-400 bg-red-500/10',
    TIMER: 'text-orange-400 bg-orange-500/10', RESULT: 'text-purple-400 bg-purple-500/10',
  };

  const handleExportKeyLog = () => {
    if (keyLog.length === 0) {
      alert('No log entries to export.');
      return;
    }
    const matchInfo = activeBout ? `R${activeBout.round_no}B${activeBout.bout_no}` : 'General';
    const csvRows = [
      ['Timestamp', 'Category', 'Message', 'Match'],
      ...filteredLog.map(entry => [
        `"${entry.time}"`,
        `"${entry.category}"`,
        `"${entry.message.replace(/"/g, '""')}"`,
        `"${matchInfo}"`
      ])
    ];
    const csvContent = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvRows.map(e => e.join(',')).join('\n'));
    const link = document.createElement('a');
    link.setAttribute('href', csvContent);
    const fileName = `key_log_${matchInfo}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    addLog('SYSTEM', `Key log exported (${filteredLog.length} entries to ${fileName})`);
  };

  const handlePrintKeyLog = () => {
    if (keyLog.length === 0) {
      alert('No log entries to print.');
      return;
    }
    const matchCode = activeBout ? `R${activeBout.round_no}B${activeBout.bout_no}` : 'N/A';
    const catName = activeCat?.name || 'All Categories';
    const tatamiLabel = `Tatami ${takeoverTatami || tatamiId || localTatamiParam || 1}`;
    const printWindow = window.open('', '_blank', 'width=800,height=900');
    if (!printWindow) {
      alert('Please allow popups to print the Key Log audit sheet.');
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Key Log Audit Report - ${matchCode}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; color: #1e293b; }
            .header { border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end; }
            .title { font-size: 20px; font-weight: 900; text-transform: uppercase; margin: 0; }
            .subtitle { font-size: 11px; color: #64748b; margin-top: 4px; }
            .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; margin-bottom: 16px; font-size: 11px; }
            .meta-item strong { display: block; color: #475569; font-size: 9px; text-transform: uppercase; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th { background: #0f172a; color: #fff; text-align: left; padding: 8px 10px; font-size: 10px; text-transform: uppercase; }
            td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
            tr:nth-child(even) td { background: #f8fafc; }
            .cat-badge { font-weight: bold; font-size: 9px; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; }
            .cat-SCORE { background: #dcfce7; color: #166534; }
            .cat-PENALTY { background: #fee2e2; color: #991b1b; }
            .cat-TIMER { background: #ffedd5; color: #9a3412; }
            .cat-SYSTEM { background: #e0f2fe; color: #075985; }
            .cat-REFEREE { background: #fef9c3; color: #854d0e; }
            .cat-RESULT { background: #f3e8ff; color: #6b21a8; }
            .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; }
            @media print {
              body { padding: 0; }
              @page { margin: 1.5cm; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <h1 class="title">Official Key Log Audit Sheet</h1>
              <div class="subtitle">KarateTech Tournament Management System • ${tournamentName || 'Karate Championship'}</div>
            </div>
            <div style="text-align: right; font-size: 10px; color: #64748b;">
              Generated: ${new Date().toLocaleString()}
            </div>
          </div>

          <div class="meta-grid">
            <div class="meta-item"><strong>Match / Bout</strong>${matchCode}</div>
            <div class="meta-item"><strong>Category</strong>${catName}</div>
            <div class="meta-item"><strong>Tatami</strong>${tatamiLabel}</div>
            <div class="meta-item"><strong>Fighters</strong>AKA: ${akaFighter?.full_name || '—'} vs AO: ${aoFighter?.full_name || '—'}</div>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width: 80px;">Time</th>
                <th style="width: 90px;">Category</th>
                <th>Action / Event Description</th>
              </tr>
            </thead>
            <tbody>
              ${filteredLog.map(entry => `
                <tr>
                  <td style="font-family: monospace; font-weight: bold;">${entry.time}</td>
                  <td><span class="cat-badge cat-${entry.category}">${entry.category}</span></td>
                  <td>${entry.message}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="footer">
            <div>Total Events Logged: ${filteredLog.length}</div>
            <div>Chief Referee Signature: _______________________</div>
            <div>Tatami Manager Signature: _______________________</div>
          </div>

          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    addLog('SYSTEM', `Key log sent to printer (${filteredLog.length} entries)`);
  };

  type DockBtn = { id: string; icon: React.ElementType; label: string; color: string; action: () => void };
  const handleOperatorRematch = async () => {
    if (!activeBout) {
      alert('Please load or select a match first.');
      return;
    }

    const confirmRematch = window.confirm(
      `Are you sure you want to reset and start a rematch for Match R${activeBout.round_no}B${activeBout.bout_no}? This will clear all scores, fouls, and winner status.`
    );
    if (!confirmRematch) return;

    try {
      const matchDuration = (activeCat as any)?.time_duration || 180;
      
      // 1. Reset bout in database / mockStore
      await db.bouts.resetBoutResult(activeBout.id, matchDuration);

      // 2. Reset operator local timer
      setTimerSeconds(matchDuration);
      setTimerRunning(false);

      // 3. Reset scoreboard component if open
      if (scoreboardRef.current?.rematch) {
        scoreboardRef.current.rematch();
      }

      // 4. Reload active datasets
      await loadData();

      // 5. Broadcast reset directly to referee display & spectator screens
      if (typeof window !== 'undefined') {
        const channel = new BroadcastChannel('wkf-scoreboard-sync');
        channel.postMessage({
          boutId: activeBout.id,
          scoreAka: 0,
          scoreAo: 0,
          senshuAka: false,
          senshuAo: false,
          penaltiesAka: [],
          penaltiesAo: [],
          c1Aka: 0,
          c1Ao: 0,
          eventsAka: [],
          eventsAo: [],
          timeLeft: matchDuration * 10,
          timerActive: false,
          winner: null,
          winMethod: '',
          resultConfirmed: false,
          penaltyH: null
        });
        channel.close();
      }

      addLog('SYSTEM', `Rematch initiated for Match R${activeBout.round_no}B${activeBout.bout_no}: Scores, penalties, and winners reset`);
    } catch (err) {
      console.error('Error initiating rematch:', err);
      addLog('SYSTEM', 'Failed to execute rematch');
    }
  };

  const [isResultConfirmedOnReferee, setIsResultConfirmedOnReferee] = useState<boolean>(false);

  const handleToggleResultOnRefereeView = () => {
    if (!activeBout) {
      alert('Please load or select a match first.');
      return;
    }

    const nextConfirmed = !isResultConfirmedOnReferee;
    setIsResultConfirmedOnReferee(nextConfirmed);

    // 1. If scoreboard component has confirm/reveal function, trigger it
    if (scoreboardRef.current?.confirmResult) {
      scoreboardRef.current.confirmResult();
    }

    if (!nextConfirmed) {
      // 2nd CLICK: REVERSE BACK ACTION — Restore live scoreboard on Referee View
      if (typeof window !== 'undefined') {
        try {
          const channel = new BroadcastChannel('wkf-scoreboard-sync');
          channel.postMessage({
            type: 'SYNC_MATCH_STATE',
            boutId: activeBout.id,
            categoryId: activeBout.category_id,
            akaName: akaFighter?.full_name || 'AKA Red',
            aoName: aoFighter?.full_name || 'AO Blue',
            akaClub: akaFighter ? (clubs.find(c => c.id === akaFighter.club_id)?.name || '') : '',
            aoClub: aoFighter ? (clubs.find(c => c.id === aoFighter.club_id)?.name || '') : '',
            scoreAka: boutIsKata ? Number(activeBout.total_score_a || activeBout.score_a || 0) : liveScoreAka,
            scoreAo: boutIsKata ? Number(activeBout.total_score_b || activeBout.score_b || 0) : liveScoreAo,
            senshuAka,
            senshuAo,
            c1Aka: parseInt(activeBout.penalties_c1_a || '0') || 0,
            c1Ao: parseInt(activeBout.penalties_c1_b || '0') || 0,
            timeLeft: timerSeconds * 10,
            timerActive: false,
            winner: null,
            winnerSide: null,
            winMethod: '',
            resultConfirmed: false
          });
          channel.close();
        } catch (e) {
          console.error('Error broadcasting result reversal to referee screen:', e);
        }
      }

      addLog('RESULT', `Match Result for R${activeBout.round_no}B${activeBout.bout_no} reversed — Scoreboard restored on Referee View`);
      return;
    }

    // 1st CLICK: CONFIRM RESULT — Display full-screen Winner Page on Referee View
    let winner: 'aka' | 'ao' | 'draw' | null = null;
    let scoreA = liveScoreAka;
    let scoreB = liveScoreAo;

    if (boutIsKata) {
      scoreA = Number(activeBout.total_score_a || activeBout.score_a || 0);
      scoreB = Number(activeBout.total_score_b || activeBout.score_b || 0);
      if (scoreA > scoreB) winner = 'aka';
      else if (scoreB > scoreA) winner = 'ao';
      else winner = 'draw';
    } else {
      if (liveScoreAka > liveScoreAo) winner = 'aka';
      else if (liveScoreAo > liveScoreAka) winner = 'ao';
      else if (senshuAka) winner = 'aka';
      else if (senshuAo) winner = 'ao';
      else winner = 'draw';
    }

    if (typeof window !== 'undefined') {
      try {
        const channel = new BroadcastChannel('wkf-scoreboard-sync');
        channel.postMessage({
          type: 'SYNC_MATCH_STATE',
          boutId: activeBout.id,
          categoryId: activeBout.category_id,
          akaName: akaFighter?.full_name || 'AKA Red',
          aoName: aoFighter?.full_name || 'AO Blue',
          akaClub: akaFighter ? (clubs.find(c => c.id === akaFighter.club_id)?.name || '') : '',
          aoClub: aoFighter ? (clubs.find(c => c.id === aoFighter.club_id)?.name || '') : '',
          scoreAka: scoreA,
          scoreAo: scoreB,
          senshuAka,
          senshuAo,
          c1Aka: parseInt(activeBout.penalties_c1_a || '0') || 0,
          c1Ao: parseInt(activeBout.penalties_c1_b || '0') || 0,
          timeLeft: 0,
          timerActive: false,
          winner,
          winnerSide: winner,
          winMethod: 'Decision / Score',
          resultConfirmed: true
        });

        if (winner && winner !== 'draw') {
          channel.postMessage({
            type: 'MATCH_FINISHED',
            winnerSide: winner
          });
        }
        channel.close();
      } catch (e) {
        console.error('Error broadcasting result to referee screen:', e);
      }
    }

    addLog('RESULT', `Match Result for R${activeBout.round_no}B${activeBout.bout_no} sent to Referee View: ${winner ? `${winner.toUpperCase()} Winner (Full-Screen Winner Page)` : 'Draw'}`);
  };

  const handleSaveResultAndLoadNextMatch = async () => {
    if (!activeBout) {
      alert('Please load or select a match first.');
      return;
    }

    if (vrRecordingActive) {
      await autoStopVrRecording(`VR recording auto-stopped before saving result for R${activeBout.round_no}B${activeBout.bout_no}.`);
    }

    try {
      // 1. If scoreboard component has custom saveResult implementation, call it
      if (scoreboardRef.current?.saveResult) {
        await scoreboardRef.current.saveResult();
      } else {
        // Calculate winner and update database directly
        let winnerId: string | null = null;
        let victoryMethod = 'Decision / Score';
        if (boutIsKata) {
          const scoreA = Number(activeBout.total_score_a || activeBout.score_a || 0);
          const scoreB = Number(activeBout.total_score_b || activeBout.score_b || 0);
          if (scoreA > scoreB) winnerId = activeBout.participant_a_id;
          else if (scoreB > scoreA) winnerId = activeBout.participant_b_id;
        } else {
          if (liveScoreAka > liveScoreAo) winnerId = activeBout.participant_a_id;
          else if (liveScoreAo > liveScoreAka) winnerId = activeBout.participant_b_id;
          else if (senshuAka) winnerId = activeBout.participant_a_id;
          else if (senshuAo) winnerId = activeBout.participant_b_id;
        }

        await db.bouts.updateBoutState(activeBout.id, {
          status: 'Completed',
          winner_id: winnerId,
          score_a: boutIsKata ? (activeBout.score_a || 0) : liveScoreAka,
          score_b: boutIsKata ? (activeBout.score_b || 0) : liveScoreAo,
          senshu_a: senshuAka,
          senshu_b: senshuAo,
          timer_seconds: timerSeconds,
          victory_method: victoryMethod
        });
      }

      addLog('SYSTEM', `Match R${activeBout.round_no}B${activeBout.bout_no} saved to database as Completed`);

      // 2. Fetch fresh bouts list
      const freshBouts = await db.bouts.list();
      setBouts(freshBouts);

      // 3. Auto load next match in queue
      const catBouts = freshBouts.filter(b => b.category_id === activeBout.category_id);
      const nextInCat = catBouts.find(b => b.id !== activeBout.id && b.status !== 'Completed' && (b.round_no > activeBout.round_no || (b.round_no === activeBout.round_no && b.bout_no > activeBout.bout_no)));
      const nextPendingAny = freshBouts.find(b => b.id !== activeBout.id && b.status !== 'Completed');

      const targetNextBout = nextInCat || nextPendingAny;

      if (targetNextBout) {
        loadBout(targetNextBout, participants, categories, true);
        setIsResultConfirmedOnReferee(false);
        addLog('SYSTEM', `Auto-loaded next match: R${targetNextBout.round_no}B${targetNextBout.bout_no}`);
      } else {
        addLog('SYSTEM', 'All scheduled matches completed in queue');
      }
    } catch (err) {
      console.error('Error saving result and auto loading next match:', err);
      alert('Failed to save result. Please check connection and try again.');
    }
  };

    const handleShortcutAction = useCallback((key: string) => {
    if (key === 'F1') {
      if (isBracketModalOpen) {
        setIsBracketModalOpen(false);
        addLog('SYSTEM', 'Shortcut [F1]: Live Bracket Modal closed (returned to initial page)');
      } else {
        setBracketModalCatId(activeCat?.id || (selectedCatId !== 'ALL' ? selectedCatId : (filteredCategories[0]?.id || 'ALL')));
        setIsBracketModalOpen(true);
        addLog('SYSTEM', 'Shortcut [F1]: Live Bracket Modal opened');
      }
    } else if (key === 'F2') {
      const nextState = !isPlayerDetailsDisplayShowing;
      setIsPlayerDetailsDisplayShowing(nextState);
      if (typeof window !== 'undefined') {
        const channel = new BroadcastChannel('wkf-scoreboard-sync');
        channel.postMessage({
          type: 'SHOW_PLAYER_DETAILS',
          show: nextState,
          akaFighter,
          aoFighter,
          category: activeCat,
          bout: activeBout,
          akaClub: akaFighter ? (clubs.find(c => c.id === akaFighter.club_id)?.name || '') : '',
          aoClub: aoFighter ? (clubs.find(c => c.id === aoFighter.club_id)?.name || '') : '',
          akaCoach: akaFighter ? (coaches.find(c => c.id === akaFighter.coach_id)?.name || '') : '',
          aoCoach: aoFighter ? (coaches.find(c => c.id === aoFighter.coach_id)?.name || '') : '',
        });
        channel.close();
      }
      addLog('SYSTEM', nextState ? 'Shortcut [F2]: Player details presented on Referee / Spectator Screen' : 'Shortcut [F2]: Player details dismissed (returned to initial page)');
    } else if (key === 'F3') {
      handleToggleResultOnRefereeView();
      addLog('RESULT', 'Shortcut [F3]: Confirm / Reverse Result toggled');
    } else if (key === 'F4') {
      const nextBroadcast = !extraTimerBroadcast;
      setExtraTimerBroadcast(nextBroadcast);
      setExtraTimerOpen(true);
      broadcastExtraTimer(extraTime, extraRunning, nextBroadcast);
      addLog('TIMER', nextBroadcast ? 'Shortcut [F4]: Extra Timer synced to Referee / Spectator Screen' : 'Shortcut [F4]: Extra Timer dismissed from Referee Screen');
      setTimeout(() => document.querySelector<HTMLDivElement>('.extra-timer-panel')?.scrollIntoView({ behavior: 'smooth' }), 100);
    } else if (key === 'F5') {
      if (bracketTab !== 'BRACKET CONSOLE') {
        setBracketTab('BRACKET CONSOLE');
        addLog('SYSTEM', 'Shortcut [F5]: Returned to initial Match Console view');
      } else {
        setKeyLogTab('ALL');
        if (logContainerRef.current) logContainerRef.current.scrollTop = 0;
        addLog('SYSTEM', 'Shortcut [F5]: Key Log Terminal focused & reset to ALL');
      }
    } else if (key === 'F6') {
      addLog('SYSTEM', 'Shortcut [F6]: Navigating to Settings');
      router.push('/settings');
    }
  }, [
    isBracketModalOpen,
    activeCat,
    selectedCatId,
    filteredCategories,
    isPlayerDetailsDisplayShowing,
    akaFighter,
    aoFighter,
    clubs,
    coaches,
    activeBout,
    handleToggleResultOnRefereeView,
    extraTimerOpen,
    extraRunning,
    extraTime,
    extraTimerBroadcast,
    bracketTab,
    router,
    addLog
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName);
      if (isInput) return;

      if (['F1', 'F2', 'F3', 'F4', 'F5', 'F6'].includes(e.key)) {
        e.preventDefault();
        handleShortcutAction(e.key);
      } else if (e.key === 'Escape') {
        if (isBracketModalOpen) { setIsBracketModalOpen(false); addLog('SYSTEM', 'Hotkey [Esc]: Bracket modal closed'); }
        else if (isLoadMatchModalOpen) { setIsLoadMatchModalOpen(false); addLog('SYSTEM', 'Hotkey [Esc]: Load match modal closed'); }
        else if (isNotesModalOpen) { setIsNotesModalOpen(false); addLog('SYSTEM', 'Hotkey [Esc]: Notes modal closed'); }
        else if (selectedProfileModal) { setSelectedProfileModal(null); addLog('SYSTEM', 'Hotkey [Esc]: Profile modal closed'); }
        else if (expandModal) { setExpandModal(null); addLog('SYSTEM', 'Hotkey [Esc]: Expanded modal closed'); }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleShortcutAction,
    isBracketModalOpen,
    isLoadMatchModalOpen,
    isNotesModalOpen,
    selectedProfileModal,
    expandModal,
    addLog
  ]);

  const initialDockButtons: DockBtn[] = [
    { id: 'bracket',         icon: Trophy,         label: 'BRACKET',       color: 'yellow', action: () => {
        if (isBracketModalOpen) {
          setIsBracketModalOpen(false);
          addLog('SYSTEM', 'Function Dock: Live Bracket Modal closed (returned to initial page)');
        } else {
          setBracketModalCatId(activeCat?.id || (selectedCatId !== 'ALL' ? selectedCatId : (filteredCategories[0]?.id || 'ALL')));
          setIsBracketModalOpen(true);
          addLog('SYSTEM', 'Function Dock: Live Bracket Modal opened');
        }
      } 
    },
    { id: 'matches',         icon: List,           label: 'MATCHES',        color: 'blue',   action: () => {
        if (bracketTab === 'MATCH LIST') {
          setBracketTab('BRACKET CONSOLE');
          addLog('SYSTEM', 'Function Dock: Returned to initial BRACKET CONSOLE view');
        } else {
          setBracketTab('MATCH LIST');
          addLog('SYSTEM', 'Function Dock: Switched to MATCH LIST');
        }
      } 
    },
    { id: 'player_details',  icon: UserSquare2,    label: 'PLAYER DETAILS', color: 'blue',   action: () => {
        const nextState = !isPlayerDetailsDisplayShowing;
        setIsPlayerDetailsDisplayShowing(nextState);
        if (typeof window !== 'undefined') {
          const channel = new BroadcastChannel('wkf-scoreboard-sync');
          channel.postMessage({
            type: 'SHOW_PLAYER_DETAILS',
            show: nextState,
            akaFighter,
            aoFighter,
            category: activeCat,
            bout: activeBout,
            akaClub: akaFighter ? (clubs.find(c => c.id === akaFighter.club_id)?.name || '') : '',
            aoClub: aoFighter ? (clubs.find(c => c.id === aoFighter.club_id)?.name || '') : '',
            akaCoach: akaFighter ? (coaches.find(c => c.id === akaFighter.coach_id)?.name || '') : '',
            aoCoach: aoFighter ? (coaches.find(c => c.id === aoFighter.coach_id)?.name || '') : '',
          });
          channel.close();
        }
        addLog('SYSTEM', nextState ? 'Function Dock: Player details presented on Referee / Spectator Screen' : 'Function Dock: Player details dismissed (returned to initial page)');
      } 
    },
    { id: 'extra_timer',     icon: Timer,          label: 'EXTRA TIMER',    color: 'orange', action: () => {
        const nextBroadcast = !extraTimerBroadcast;
        setExtraTimerBroadcast(nextBroadcast);
        setExtraTimerOpen(true);
        broadcastExtraTimer(extraTime, extraRunning, nextBroadcast);
        addLog('TIMER', nextBroadcast ? 'Function Dock: Extra Timer synced to Referee / Spectator Screen' : 'Function Dock: Extra Timer dismissed from Referee Screen');
        setTimeout(() => document.querySelector<HTMLDivElement>('.extra-timer-panel')?.scrollIntoView({ behavior: 'smooth' }), 100);
      } 
    },
    { id: 'current_match',   icon: ChevronRight,   label: 'CURRENT MATCH',  color: 'yellow', action: () => {
        if (isControlPanelOpen) {
          setIsControlPanelOpen(false);
          addLog('SYSTEM', 'Function Dock: Scoreboard panel closed (returned to initial view)');
        } else if (activeBout) {
          setIsControlPanelOpen(true);
          addLog('SYSTEM', `Function Dock: Opened Current Match Console (${boutLabel})`);
        } else {
          addLog('SYSTEM', 'Function Dock: No active match to open in console');
        }
      } 
    },
    { id: 'referee_screen',  icon: Tv,             label: 'REFEREE SCREEN', color: 'blue',   action: () => {
        if (expandModal) {
          setExpandModal(null);
          addLog('SYSTEM', 'Function Dock: Referee Screen modal closed (returned to initial page)');
        } else {
          const url = `${basePath}/display?liveOnly=true${activeBout ? `&boutId=${activeBout.id}` : ''}`;
          setExpandModal({
            open: true,
            terminal: 'REFEREE & SPECTATOR SCREEN',
            targetUrl: url
          });
          addLog('SYSTEM', 'Function Dock: Opened Referee & Spectator Screen in Modal');
        }
      } 
    },
    { id: 'standby', icon: Clock, label: isStandby ? 'EXIT STANDBY' : 'STANDBY', color: isStandby ? 'red' : 'yellow', action: () => {
        const nextStandby = !isStandby;
        setIsStandby(nextStandby);
        if (typeof window !== 'undefined') {
          try {
            const channel = new BroadcastChannel('wkf-scoreboard-sync');
            channel.postMessage({ type: 'SET_IDLE', isIdle: nextStandby });
            channel.close();
            if (!nextStandby) {
              if ((window as any)._broadcastFullState) {
                (window as any)._broadcastFullState();
              }
              broadcastOperatorTimer(timerSeconds, timerRunning);
            }
          } catch (err) {}
        }
        addLog('SYSTEM', nextStandby
          ? 'Function Dock: Display set to Arena Standby'
          : 'Function Dock: Standby dismissed — returning to live display');
      }
    },
    { id: 'notes',           icon: FileText,       label: 'NOTES',          color: 'blue',   action: () => {
        if (isNotesModalOpen) {
          setIsNotesModalOpen(false);
          addLog('SYSTEM', 'Function Dock: Notes closed (returned to initial page)');
        } else if (activeBout) {
          setNotesText(activeBout.notes || '');
          setIsNotesModalOpen(true);
          addLog('SYSTEM', `Function Dock: Opened Notes for Match ${boutLabel}`);
        } else {
          addLog('SYSTEM', 'Function Dock: No active match for Notes');
        }
      } 
    },
    { id: 'katalist',        icon: BookOpen,       label: 'KATALIST',       color: 'blue',   action: () => {
        window.open(`${basePath}/katalist`, '_blank');
        addLog('SYSTEM', 'Function Dock: Opened WKF Kata List in new tab');
      } 
    },
    { id: 'next_match',      icon: ArrowRight,     label: 'NEXT MATCH',     color: 'blue',   action: () => {
        if (nextBout) {
          loadBout(nextBout);
          setIsControlPanelOpen(true);
          addLog('SYSTEM', `Function Dock: Loaded Next Match R${nextBout.round_no}B${nextBout.bout_no}`);
        } else {
          addLog('SYSTEM', 'Function Dock: No next match available in category/queue');
        }
      } 
    },
    { id: 'prev_match',      icon: ArrowLeft,      label: 'PREV MATCH',     color: 'blue',   action: () => {
        if (prevBout) {
          loadBout(prevBout);
          setIsControlPanelOpen(true);
          addLog('SYSTEM', `Function Dock: Loaded Previous Match R${prevBout.round_no}B${prevBout.bout_no}`);
        } else {
          addLog('SYSTEM', 'Function Dock: No previous match available');
        }
      } 
    },
    { id: 'load_match',      icon: FolderOpen,     label: 'LOAD MATCH',     color: 'blue',   action: () => {
        if (isLoadMatchModalOpen) {
          setIsLoadMatchModalOpen(false);
          addLog('SYSTEM', 'Function Dock: Load Match modal closed (returned to initial page)');
        } else {
          setLoadMatchSearch('');
          setExpandedCatId(null);
          setIsLoadMatchModalOpen(true);
          addLog('SYSTEM', 'Function Dock: Opened Load Match modal');
        }
      } 
    },
    { id: 'match_log',       icon: ClipboardList,  label: 'MATCH LOG',      color: 'blue',   action: () => {
        setKeyLogTab('ALL');
        addLog('SYSTEM', 'Function Dock: Key Log filter reset to ALL');
      } 
    },
    { id: 'officials',       icon: ShieldCheck,    label: 'OFFICIALS',      color: 'blue',   action: () => {
        setIsOfficialsModalOpen(true);
        addLog('SYSTEM', 'Function Dock: Opened Officials Directory');
      } 
    },
    { id: 'queue',           icon: Users2,         label: 'QUEUE',          color: 'blue',   action: () => {
        if (bracketTab === 'QUEUE') {
          setBracketTab('BRACKET CONSOLE');
          addLog('SYSTEM', 'Function Dock: Returned to initial BRACKET CONSOLE view');
        } else {
          setBracketTab('QUEUE');
          addLog('SYSTEM', 'Function Dock: Switched to QUEUE tab');
        }
      } 
    },
    { id: 'undo',            icon: Undo2,          label: 'UNDO',           color: 'orange', action: () => {
        scoreboardRef.current?.undoLastAction();
        addLog('SYSTEM', 'Function Dock: Undo action triggered');
      } 
    },
    { id: 'rematch',         icon: RotateCcw,      label: 'REMATCH',        color: 'red',    action: handleOperatorRematch },
    { id: 'confirm_result',  icon: CheckCircle2,   label: isResultConfirmedOnReferee ? 'REVERSE RESULT' : 'CONFIRM RESULT', color: isResultConfirmedOnReferee ? 'orange' : 'green', action: handleToggleResultOnRefereeView },
    { id: 'save_result',     icon: Save,           label: 'SAVE RESULT',    color: 'green',  action: handleSaveResultAndLoadNextMatch },
    { id: 'print',           icon: Printer,        label: 'PRINT',          color: 'blue',   action: () => {
        addLog('SYSTEM', 'Function Dock: Triggered Browser Print dialog');
        window.print();
      } 
    },
    { id: 'vr_recording',    icon: Camera,         label: vrRecordingActive ? '● VR ON' : 'VR OFF', color: vrRecordingActive ? 'red' : 'blue', action: async () => {
        if (vrRecordingActive) {
          await stopVrRecording();
        } else {
          await startVrRecording();
        }
      } 
    },
    { id: 'vr_playback',     icon: Play,           label: 'PLAYBACK',      color: 'blue',   action: () => {
        if (vrPlaybackOpen) {
          setVrPlaybackOpen(false);
          addLog('SYSTEM', 'Function Dock: VR playback viewer closed');
        } else {
          openVrPlayback();
          addLog('SYSTEM', 'Function Dock: Opened VR footage viewer');
        }
      } 
    },
    { id: 'display',         icon: Monitor,        label: 'DISPLAY',        color: 'blue',   action: () => {
        addLog('SYSTEM', 'Function Dock: Navigating to Spectator Display');
        router.push(`/display?liveOnly=true${activeBout ? `&boutId=${activeBout.id}` : ''}`);
      } 
    },
    { id: 'live_display',    icon: Radio,          label: 'LIVE DISPLAY',   color: 'blue',   action: () => {
        addLog('SYSTEM', 'Function Dock: Launched Live Spectator Display in new tab');
        window.open(`${basePath}/display?liveOnly=true${activeBout ? `&boutId=${activeBout.id}` : ''}`, '_blank');
      } 
    },
    { id: 'lock',            icon: Lock,           label: 'LOCK',           color: 'red',    action: () => {
        updateBout({ status: 'Completed' });
        addLog('SYSTEM', `Function Dock: Match ${boutLabel} Locked as Completed`);
      } 
    },
    { id: 'pc_manager',      icon: Cpu,            label: 'PC MANAGER',     color: 'blue',   action: () => {
        addLog('SYSTEM', 'Function Dock: Navigating to PC Manager / Admin');
        router.push('/admin');
      } 
    },
    { id: 'settings',        icon: Settings,       label: 'SETTINGS',       color: 'blue',   action: () => {
        addLog('SYSTEM', 'Function Dock: Navigating to Settings');
        router.push('/settings');
      } 
    },
  ];

  const handleDockReorder = useCallback((draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    setDockOrder(prev => {
      const baseOrder = prev.length > 0 ? prev : initialDockButtons.map(b => b.id);
      const fromIndex = baseOrder.indexOf(draggedId);
      const toIndex = baseOrder.indexOf(targetId);
      if (fromIndex === -1 || toIndex === -1) return prev;

      const newOrder = [...baseOrder];
      const [moved] = newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, moved);

      try {
        localStorage.setItem('kt_operator_dock_order', JSON.stringify(newOrder));
      } catch (e) {}
      return newOrder;
    });
  }, [initialDockButtons]);

  const resetDockOrder = useCallback(() => {
    setDockOrder([]);
    try {
      localStorage.removeItem('kt_operator_dock_order');
    } catch (e) {}
    addLog('SYSTEM', 'Function Dock: Button arrangement reset to default order');
  }, [addLog]);

  const orderedDockButtons = useMemo(() => {
    if (!dockOrder || dockOrder.length === 0) return initialDockButtons;
    const map = new Map(initialDockButtons.map(b => [b.id, b]));
    const result: DockBtn[] = [];
    for (const rawId of dockOrder) {
      const id = rawId === 'reopen_match' ? 'rematch' : rawId;
      const btn = map.get(id);
      if (btn) {
        result.push(btn);
        map.delete(id);
      }
    }
    map.forEach(btn => result.push(btn));
    return result;
  }, [initialDockButtons, dockOrder]);

  if (!mounted) return null;

  return (
    <div className="h-[100dvh] w-full operator-console-root flex flex-col overflow-hidden select-none relative" style={{ fontFamily: 'system-ui, sans-serif' }}>
      
      {/* ADMIN TAKEOVER OVERLAY */}
      {isLockedOutByAdmin && (
        <div className="absolute inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center pointer-events-auto">
          <div className="bg-red-900/90 border border-red-500 rounded-2xl p-8 max-w-lg text-center shadow-2xl shadow-red-900/50">
            <Lock className="w-20 h-20 text-red-400 mx-auto mb-4 animate-pulse" />
            <h2 className="text-3xl font-black text-white tracking-widest mb-2">TATAMI TAKEN OVER</h2>
            <p className="text-red-200 font-medium text-lg">
              The Tournament Director has taken remote control of this Tatami. 
              Local controls are temporarily disabled to prevent conflicts.
            </p>
          </div>
        </div>
      )}

      {/* TOP BAR */}
      <header className="flex items-center justify-between px-3 py-1.5 operator-panel border-b shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <img src={`${basePath}/karatetech-logo.png`} alt="KarateTech Logo" className="h-9 w-9 object-contain rounded-full border border-white/20 shadow-md shadow-black/50" />
              <div>
                <div style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 900, fontSize: '0.85rem', lineHeight: 1, letterSpacing: '0.01em' }}>
                  <span style={{ color: '#b91c2e' }}>Karate</span>
                  <span style={{ color: '#38bdf8' }}>Tech</span>
                  <span style={{ color: '#ffffff', marginLeft: '3px', fontSize: '0.75rem' }}>2.0</span>
                  <span style={{ color: '#94a3b8', fontSize: '0.55rem', marginLeft: '2px', verticalAlign: 'super' }}>©</span>
                </div>
                <div className="text-[6.5px] text-white/40 font-bold uppercase tracking-[0.15em] mt-0.5 leading-none">
                  • PRECISION. SPEED. RESULTS. •
                </div>
                <div className="mt-1 flex items-center overflow-hidden">
                  <img 
                    src={`${basePath}/spsportdata-logo.jpg`} 
                    alt="SP SportData Solution" 
                    className="h-4.5 max-h-[18px] w-auto object-contain mix-blend-screen"
                  />
                </div>
              </div>
            </div>

            {/* Separate Divider & Operator Console Title */}
            <div className="h-7 w-px bg-white/15" />
            <div className="flex flex-col justify-center">
              <span className="text-[9.5px] font-black text-yellow-400 tracking-widest uppercase leading-none">
                OPERATOR CONSOLE
              </span>
              <span className="text-[7px] text-white/40 font-bold uppercase tracking-wider mt-0.5">
                MATCH CONTROL DESK
              </span>
            </div>
          </div>
          <div className="h-5 w-px bg-white/10" />
          <div className="flex items-center gap-2 text-[11px] font-bold text-white/60">
            <span>TATAMI {takeoverTatami || tatamiId || localTatamiParam || (activeBout?.tatami === 'Tatami 2' ? 2 : (activeCat as any)?.assigned_tatami === 'Tatami 2' ? 2 : 1)}</span>
            <span className="text-white/20">|</span>
            <span className="max-w-[160px] truncate text-white/80">{activeCat?.name || 'SELECT MATCH'}</span>
            <span className="text-white/20">|</span>
            <span>ROUND {activeBout?.round_no || '-'}</span>
            <span className="text-white/20">|</span>
            <span>BOUT #{activeBout?.bout_no || '-'}</span>
            <span className="text-white/20">|</span>
            <span className={`px-2 py-0.5 rounded border text-[9px] font-black ${
              activeBout?.status === 'Running'
                ? 'text-emerald-400 bg-emerald-950/40 border-emerald-500/40 animate-pulse'
                : activeBout?.status === 'Completed'
                ? 'text-blue-400 bg-blue-950/40 border-blue-500/40'
                : activeBout?.status === 'Scheduled'
                ? 'text-yellow-400 bg-yellow-950/40 border-yellow-500/40'
                : 'text-white/50 bg-white/5 border-white/10'
            }`}>
              {activeBout?.status?.toUpperCase() || 'IDLE'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded border ${isOnline ? 'text-green-400 bg-green-900/20 border-green-700/40' : 'text-red-400 bg-red-900/20 border-red-700/40'}`}>
            {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {isOnline ? 'CONNECTED' : 'OFFLINE'}
          </div>
          {/* Console Theme Picker */}
          <div className="relative">
            <button 
              onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)} 
              className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/10 transition cursor-pointer text-[10px] font-bold" 
              title="Select Console Theme (WKF Dark, Arena Blue, Tatami Green)"
            >
              <Palette className="h-3 w-3 text-yellow-400" />
              <span className="capitalize hidden sm:inline">
                {consoleTheme === 'wkf-dark' ? 'WKF Dark' : consoleTheme === 'arena-blue' ? 'Arena Blue' : consoleTheme === 'tatami-green' ? 'Tatami Green' : 'Dojo Gold'}
              </span>
              <ChevronDownIcon className="h-2.5 w-2.5 opacity-50" />
            </button>

            {isThemeMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsThemeMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-64 bg-[#0d121f] border border-white/20 rounded-xl shadow-2xl z-50 p-2.5 space-y-2 text-white animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                    <span className="text-[10px] font-black uppercase tracking-wider text-white/50 flex items-center gap-1">
                      <Palette className="h-3 w-3 text-yellow-400" />
                      Console Theme
                    </span>
                    <span className="text-[9px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">
                      Scoreboard Locked
                    </span>
                  </div>

                  <div className="space-y-1">
                    {/* 1. WKF Dark */}
                    <label
                      onClick={() => { setConsoleTheme('wkf-dark'); addLog('SYSTEM', 'Theme switched to WKF Dark'); setIsThemeMenuOpen(false); }}
                      className={`flex items-center justify-between p-1.5 rounded-lg border cursor-pointer transition text-[11px] ${
                        consoleTheme === 'wkf-dark'
                          ? 'bg-yellow-500/20 border-yellow-500/60 text-white font-bold'
                          : 'border-transparent hover:bg-white/5 text-white/60 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="operatorTheme"
                          checked={consoleTheme === 'wkf-dark'}
                          onChange={() => { setConsoleTheme('wkf-dark'); addLog('SYSTEM', 'Theme switched to WKF Dark'); setIsThemeMenuOpen(false); }}
                          className="h-3 w-3 text-yellow-500 cursor-pointer"
                        />
                        <span>1. WKF Dark</span>
                      </div>
                      <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
                    </label>

                    {/* 2. Arena Blue */}
                    <label
                      onClick={() => { setConsoleTheme('arena-blue'); addLog('SYSTEM', 'Theme switched to Arena Blue'); setIsThemeMenuOpen(false); }}
                      className={`flex items-center justify-between p-1.5 rounded-lg border cursor-pointer transition text-[11px] ${
                        consoleTheme === 'arena-blue'
                          ? 'bg-sky-500/20 border-sky-500/60 text-white font-bold'
                          : 'border-transparent hover:bg-white/5 text-white/60 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="operatorTheme"
                          checked={consoleTheme === 'arena-blue'}
                          onChange={() => { setConsoleTheme('arena-blue'); addLog('SYSTEM', 'Theme switched to Arena Blue'); setIsThemeMenuOpen(false); }}
                          className="h-3 w-3 text-sky-400 cursor-pointer"
                        />
                        <span>2. Arena Blue</span>
                      </div>
                      <span className="w-2.5 h-2.5 rounded-full bg-sky-400" />
                    </label>

                    {/* 3. Tatami Green */}
                    <label
                      onClick={() => { setConsoleTheme('tatami-green'); addLog('SYSTEM', 'Theme switched to Tatami Green'); setIsThemeMenuOpen(false); }}
                      className={`flex items-center justify-between p-1.5 rounded-lg border cursor-pointer transition text-[11px] ${
                        consoleTheme === 'tatami-green'
                          ? 'bg-emerald-500/20 border-emerald-500/60 text-white font-bold'
                          : 'border-transparent hover:bg-white/5 text-white/60 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="operatorTheme"
                          checked={consoleTheme === 'tatami-green'}
                          onChange={() => { setConsoleTheme('tatami-green'); addLog('SYSTEM', 'Theme switched to Tatami Green'); setIsThemeMenuOpen(false); }}
                          className="h-3 w-3 text-emerald-400 cursor-pointer"
                        />
                        <span>3. Tatami Green</span>
                      </div>
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                    </label>

                    {/* 4. Dojo Gold */}
                    <label
                      onClick={() => { setConsoleTheme('dojo-gold'); addLog('SYSTEM', 'Theme switched to Dojo Gold'); setIsThemeMenuOpen(false); }}
                      className={`flex items-center justify-between p-1.5 rounded-lg border cursor-pointer transition text-[11px] ${
                        consoleTheme === 'dojo-gold'
                          ? 'bg-amber-500/20 border-amber-400/60 text-white font-bold'
                          : 'border-transparent hover:bg-white/5 text-white/60 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="operatorTheme"
                          checked={consoleTheme === 'dojo-gold'}
                          onChange={() => { setConsoleTheme('dojo-gold'); addLog('SYSTEM', 'Theme switched to Dojo Gold'); setIsThemeMenuOpen(false); }}
                          className="h-3 w-3 text-amber-400 cursor-pointer"
                        />
                        <span>4. Dojo Gold</span>
                      </div>
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-xs shadow-amber-400" />
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>

          <button onClick={() => { loadData(); addLog('SYSTEM', 'Top Bar: Data refresh requested'); }} className="p-1.5 rounded text-white/30 hover:text-white/70 transition cursor-pointer" title="Refresh Data"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
          <button onClick={() => { addLog('SYSTEM', 'Top Bar: Navigating to Settings'); router.push('/settings'); }} className="p-1.5 rounded text-white/30 hover:text-white/70 transition cursor-pointer" title="Settings"><Settings className="h-3.5 w-3.5" /></button>
          <button onClick={() => { document.documentElement.requestFullscreen?.().catch(() => {}); addLog('SYSTEM', 'Top Bar: Fullscreen requested'); }} className="p-1.5 rounded text-white/30 hover:text-white/70 transition cursor-pointer" title="Fullscreen"><Maximize2 className="h-3.5 w-3.5" /></button>
          <Link href="/" onClick={() => addLog('SYSTEM', 'Top Bar: Exit to Home clicked')} className="p-1.5 rounded text-white/30 hover:text-red-400 transition" title="Back to Home"><X className="h-3.5 w-3.5" /></Link>
        </div>
      </header>      {/* DYNAMIC LIVE SCOREBOARD CONTROL (NO HARDCODED MOCKUPS) */}
      {isControlPanelOpen && activeBout ? (
        <div className="shrink-0 w-full border-b border-white/10 bg-[#07070a] relative overflow-y-auto" style={{ zoom: 0.45, maxHeight: 'calc(100dvh - 30px)' }}>
          <button 
            onClick={() => setIsControlPanelOpen(false)}
            className="absolute top-4 right-4 z-[200] p-3 bg-red-600 hover:bg-red-500 rounded-full text-white shadow-xl flex items-center gap-2 cursor-pointer transition"
          >
            <X className="h-5 w-5" />
            <span className="font-bold text-sm">CLOSE SCOREBOARD</span>
          </button>
          <React.Suspense fallback={<div className="flex h-full items-center justify-center p-20">Loading Controls...</div>}>
            {boutIsKata ? (
              <KataControlPanelContent ref={scoreboardRef} boutId={activeBout.id} onClose={() => { setIsControlPanelOpen(false); setActiveBout(null); loadData(); }} onLogEvent={addLog} />
            ) : (
              <KumiteScoreboardControl ref={scoreboardRef} boutId={activeBout.id} onClose={() => { setIsControlPanelOpen(false); setActiveBout(null); loadData(); }} onLogEvent={addLog} />
            )}
          </React.Suspense>
        </div>
      ) : activeBout ? (
        <div className="shrink-0 w-full border-b border-white/10 bg-[#07070a] relative overflow-y-auto" style={{ zoom: 0.45, maxHeight: 'calc(100dvh - 30px)' }}>
          <React.Suspense fallback={<div className="flex h-full items-center justify-center p-10">Loading Live Scoreboard...</div>}>
            {boutIsKata ? (
              <KataControlPanelContent ref={scoreboardRef} boutId={activeBout.id} onClose={() => { setActiveBout(null); loadData(); }} onLogEvent={addLog} />
            ) : (
              <KumiteScoreboardControl ref={scoreboardRef} boutId={activeBout.id} onClose={() => { setActiveBout(null); loadData(); }} onLogEvent={addLog} />
            )}
          </React.Suspense>
        </div>
      ) : (
        <section className="shrink-0 h-[140px] operator-panel border-b flex flex-col items-center justify-center p-4 text-center">
          <div className="flex items-center gap-2 mb-1.5">
            <Trophy className="h-5 w-5 text-yellow-400" />
            <span className="text-sm font-black uppercase tracking-widest text-white">NO ACTIVE MATCH LOADED</span>
          </div>
          <p className="text-xs text-white/50 mb-2.5 max-w-md">Select any match from the Match Console bracket list on the left to begin live scoring.</p>
          <button
            onClick={() => { setLoadMatchSearch(''); setExpandedCatId(null); setIsLoadMatchModalOpen(true); }}
            className="px-4 py-1.5 bg-yellow-500 hover:bg-yellow-400 text-black font-black text-xs uppercase tracking-wider rounded-lg transition shadow-md cursor-pointer flex items-center gap-1.5"
          >
            <FolderOpen className="h-3.5 w-3.5" /> Load Match
          </button>
        </section>
      )}

      {/* MAIN CONTENT AREA BELOW SCOREBOARD */}
      <div className="flex-1 min-h-0 grid grid-cols-[290px_1fr] overflow-hidden">

        {/* LEFT COLUMN — MATCH CONSOLE (Spans top to bottom of remaining screen) */}
        <aside className="flex flex-col operator-panel border-r overflow-hidden h-full">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 shrink-0">
            <span className="text-[9px] font-black uppercase tracking-widest text-white/50">MATCH CONSOLE</span>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  const targetUrl = chartCategoryId ? `${basePath}/display/brackets?categoryId=${chartCategoryId}` : `${basePath}/display/brackets`;
                  setExpandModal({ open: true, terminal: 'MATCH CONSOLE', targetUrl });
                }}
                title="Expand & Output Display"
                className="p-1 rounded text-white/20 hover:text-white/60 transition cursor-pointer"
              >
                <Maximize2 className="h-3 w-3" />
              </button>
              <button className="p-1 rounded text-white/20 hover:text-white/60 transition cursor-pointer"><X className="h-3 w-3" /></button>
            </div>
          </div>
          <div className="flex border-b border-white/10 shrink-0">
            {(['BRACKET CONSOLE', 'CHART', 'MATCH LIST', 'QUEUE'] as const).map(tab => (
              <button key={tab} onClick={() => { setBracketTab(tab); addLog('SYSTEM', `Match Console: Tab switched to ${tab}`); }}
                className={`flex-1 text-[7.5px] font-black uppercase py-1.5 tracking-wider transition border-b-2 cursor-pointer ${bracketTab === tab ? 'text-yellow-400 border-yellow-400' : 'text-white/25 border-transparent hover:text-white/50'}`}>
                {tab}
              </button>
            ))}
          </div>
          {/* Discipline Filter Pills (ALL / KUMITE / KATA) */}
          <div className="flex px-2 py-1 gap-1 border-b border-white/5 bg-white/[0.02] shrink-0">
            {(['ALL', 'KUMITE', 'KATA'] as const).map(disc => (
              <button
                key={disc}
                onClick={() => {
                  setDisciplineFilter(disc);
                  setSelectedCatId('ALL');
                  addLog('SYSTEM', `Match Console: Discipline filter changed to ${disc}`);
                }}
                className={`flex-1 text-[7.5px] font-black uppercase py-1 rounded transition cursor-pointer border ${
                  disciplineFilter === disc
                    ? disc === 'KUMITE'
                      ? 'bg-red-500/20 border-red-500/50 text-red-300'
                      : disc === 'KATA'
                      ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                      : 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400'
                    : 'bg-white/5 border-white/10 text-white/30 hover:bg-white/10 hover:text-white/60'
                }`}
              >
                {disc}
              </button>
            ))}
          </div>

          {/* Category Dropdown (loads all matching categories) */}
          <div className="px-2 py-1.5 border-b border-white/5 shrink-0">
            <select
              value={selectedCatId}
              onChange={e => {
                setSelectedCatId(e.target.value);
                const found = categories.find(c => c.id === e.target.value);
                addLog('SYSTEM', `Match Console: Category filter selected - ${found ? found.name : 'ALL'}`);
              }}
              className="w-full text-[9px] bg-[#121620] border border-white/10 rounded px-2 py-1 text-white/80 focus:outline-none focus:border-yellow-400/50 cursor-pointer font-sans"
            >
              <option value="ALL">ALL CATEGORIES ({filteredCategories.length} Categories · {allBoutsFiltered.length} Bouts)</option>
              {filteredCategories.map(c => {
                const isKata = isKataCategory(c);
                const genderTag = c.gender === 'Male' ? ' ♂' : c.gender === 'Female' ? ' ♀' : '';
                const ageLabel = c.min_age ? ` [Age ${c.min_age}${c.max_age && c.max_age < 99 ? `-${c.max_age}` : '+'}]` : '';
                const cBouts = allBoutsFiltered.filter(b => b.category_id === c.id);
                const totalB = cBouts.length;
                const completedB = cBouts.filter(b => b.status === 'Completed').length;
                const liveB = cBouts.filter(b => b.status === 'Running').length;
                const statusTag = liveB > 0 ? ' [LIVE]' : totalB > 0 && completedB === totalB ? ' [DONE]' : '';
                const boutInfo = totalB > 0 ? ` (${totalB} Bouts · ${completedB}/${totalB}${statusTag})` : ' (0 Bouts)';

                return (
                  <option key={c.id} value={c.id}>
                    {isKata ? '🥋 [KATA]' : '🥊 [KUMITE]'}{genderTag}{ageLabel} {c.name} — {boutInfo}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8"><RefreshCw className="h-4 w-4 text-yellow-400 animate-spin" /></div>
            ) : catBouts.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-white/20 text-[10px]">No matches</div>
            ) : bracketTab === 'CHART' ? (
              /* GENERATED BRACKET CHART VIEW WITH DIRECTIONAL SCROLL & ZOOM */
              <div className="flex flex-col h-full w-full bg-[#0d1117] overflow-hidden">
                {chartCategoryId ? (
                  <>
                    {/* Header + Fullscreen */}
                    <div className="flex items-center justify-between px-2 py-1 bg-[#121620] border-b border-white/10 shrink-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Trophy className="h-3 w-3 text-yellow-400 shrink-0" />
                        <span className="text-[8.5px] font-black uppercase text-yellow-400 truncate">
                          {categories.find(c => c.id === chartCategoryId)?.name || 'LIVE BRACKET CHART'}
                        </span>
                      </div>
                      <a
                        href={`${basePath}/display/brackets?categoryId=${chartCategoryId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[7.5px] font-bold text-yellow-400/80 hover:text-yellow-300 flex items-center gap-1 bg-yellow-500/10 px-1.5 py-0.5 rounded border border-yellow-500/30 transition shrink-0"
                      >
                        FULL SCREEN <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </div>

                    {/* Scroll & Zoom Controls Bar */}
                    <div className="flex items-center justify-between px-2 py-1 bg-[#090b10] border-b border-white/10 shrink-0 text-[8px] gap-1">
                      {/* Directional Pad */}
                      <div className="flex items-center gap-0.5">
                        <span className="text-[7px] text-white/30 font-black mr-1 uppercase">SCROLL:</span>
                        <button onClick={() => { scrollChart(0, -150); addLog('SYSTEM', 'Bracket Chart: Scrolled Up'); }} title="Scroll Up" className="p-1 rounded bg-white/5 hover:bg-white/15 border border-white/10 text-white/70 hover:text-white transition cursor-pointer">
                          <ChevronUp className="h-3 w-3" />
                        </button>
                        <button onClick={() => { scrollChart(0, 150); addLog('SYSTEM', 'Bracket Chart: Scrolled Down'); }} title="Scroll Down" className="p-1 rounded bg-white/5 hover:bg-white/15 border border-white/10 text-white/70 hover:text-white transition cursor-pointer">
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        <button onClick={() => { scrollChart(-150, 0); addLog('SYSTEM', 'Bracket Chart: Scrolled Left'); }} title="Scroll Left" className="p-1 rounded bg-white/5 hover:bg-white/15 border border-white/10 text-white/70 hover:text-white transition cursor-pointer">
                          <ChevronLeft className="h-3 w-3" />
                        </button>
                        <button onClick={() => { scrollChart(150, 0); addLog('SYSTEM', 'Bracket Chart: Scrolled Right'); }} title="Scroll Right" className="p-1 rounded bg-white/5 hover:bg-white/15 border border-white/10 text-white/70 hover:text-white transition cursor-pointer">
                          <ChevronRight className="h-3 w-3" />
                        </button>
                      </div>

                      {/* Zoom controls */}
                      <div className="flex items-center gap-0.5">
                        <span className="text-[7px] text-white/30 font-black mr-1 uppercase">ZOOM:</span>
                        <button onClick={() => { setChartZoom(z => Math.max(0.3, +(z - 0.1).toFixed(2))); addLog('SYSTEM', 'Bracket Chart: Zoom Out'); }} title="Zoom Out" className="p-1 rounded bg-white/5 hover:bg-white/15 border border-white/10 text-white/70 hover:text-white transition cursor-pointer">
                          <ZoomOut className="h-3 w-3" />
                        </button>
                        <span className="font-mono text-[7.5px] text-yellow-400 font-bold px-1">{Math.round(chartZoom * 100)}%</span>
                        <button onClick={() => { setChartZoom(z => Math.min(1.2, +(z + 0.1).toFixed(2))); addLog('SYSTEM', 'Bracket Chart: Zoom In'); }} title="Zoom In" className="p-1 rounded bg-white/5 hover:bg-white/15 border border-white/10 text-white/70 hover:text-white transition cursor-pointer">
                          <ZoomIn className="h-3 w-3" />
                        </button>
                        <button onClick={() => { setChartZoom(0.6); addLog('SYSTEM', 'Bracket Chart: Scale reset to 60% FIT'); }} title="Reset Scale (60%)" className="px-1 py-0.5 rounded bg-white/5 hover:bg-white/15 text-[7px] font-bold text-white/40 hover:text-white transition cursor-pointer">
                          FIT
                        </button>
                      </div>
                    </div>

                    {/* Scrollable & Scalable Viewport */}
                    <div ref={chartScrollRef} className="flex-1 w-full overflow-auto relative bg-[#0d1117]">
                      <div
                        style={{
                          transform: `scale(${chartZoom})`,
                          transformOrigin: 'top left',
                          width: `${100 / chartZoom}%`,
                          height: `${100 / chartZoom}%`,
                        }}
                        className="h-full min-w-[700px] min-h-[500px]"
                      >
                        <iframe
                          src={`${basePath}/display/brackets?categoryId=${chartCategoryId}`}
                          className="w-full h-full border-0 bg-white"
                          title="Bracket Chart Display"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-center py-12 text-white/20 text-[10px]">
                    Select a category to view bracket chart
                  </div>
                )}
              </div>
            ) : (
              /* MATCH LIST / BRACKET CONSOLE: GROUPED BY CATEGORY WITH BOUTS */
              <div className="divide-y divide-white/10 font-sans">
                {groupedCategorySections.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-white/30 text-[10px] text-center px-4">
                    <Trophy className="h-5 w-5 mb-1 opacity-40 text-yellow-400" />
                    <span>No bouts scheduled for this selection</span>
                  </div>
                ) : (
                  groupedCategorySections.map(({ category: cat, bouts: catBoutList, completedCount, runningCount, totalCount }) => {
                    const isKata = isKataCategory(cat);
                    const isCollapsed = Boolean(collapsedCategories[cat.id]);
                    const genderTag = cat.gender === 'Male' ? ' ♂' : cat.gender === 'Female' ? ' ♀' : '';
                    const ageLabel = cat.min_age ? ` [Age ${cat.min_age}${cat.max_age && cat.max_age < 99 ? `-${cat.max_age}` : '+'}]` : '';

                    return (
                      <div key={cat.id} className="bg-black/20">
                        {/* Category Group Header */}
                        <div
                          onClick={() => toggleCategoryCollapse(cat.id)}
                          className="sticky top-0 z-10 flex items-center justify-between px-2 py-1.5 bg-[#121622] hover:bg-[#181e2e] border-y border-white/10 cursor-pointer transition select-none shadow-sm"
                        >
                          <div className="flex items-center gap-1.5 min-w-0 pr-1">
                            <span className={`text-[6px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                              isKata
                                ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                                : 'bg-red-600/30 text-red-300 border border-red-500/40'
                            }`}>
                              {isKata ? '🥋 KATA' : '🥊 KUMITE'}{genderTag}
                            </span>
                            <span className="text-[8px] font-black text-white/90 truncate" title={`${cat.name}${ageLabel}`}>
                              {cat.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            {runningCount > 0 && (
                              <span className="flex items-center gap-0.5 text-[6px] font-black bg-yellow-400/20 text-yellow-400 border border-yellow-400/40 px-1 py-0.2 rounded animate-pulse">
                                <span className="w-1 h-1 rounded-full bg-yellow-400" /> LIVE
                              </span>
                            )}
                            <span className="text-[6.5px] font-bold text-white/50 bg-white/5 px-1 py-0.5 rounded border border-white/10">
                              {completedCount}/{totalCount}
                            </span>
                            {isCollapsed ? (
                              <ChevronDown className="h-3 w-3 text-white/40" />
                            ) : (
                              <ChevronUp className="h-3 w-3 text-yellow-400" />
                            )}
                          </div>
                        </div>

                        {/* Category Bouts List */}
                        {!isCollapsed && (
                          <div className="divide-y divide-white/5 bg-black/40">
                            {catBoutList.length === 0 ? (
                              <div className="p-2 text-center text-[8px] text-white/30 italic">
                                No bouts generated in this category
                              </div>
                            ) : (
                              catBoutList.map(bout => {
                                const pA = participants.find(p => p.id === bout.participant_a_id);
                                const pB = participants.find(p => p.id === bout.participant_b_id);
                                const isAct = bout.id === activeBout?.id;
                                const akaWin = bout.winner_id && bout.winner_id === bout.participant_a_id;
                                const aoWin = bout.winner_id && bout.winner_id === bout.participant_b_id;
                                const sb = bout.status === 'Running'
                                  ? 'bg-yellow-400/20 text-yellow-400 font-bold border border-yellow-400/40'
                                  : bout.status === 'Completed'
                                  ? 'bg-green-600/20 text-green-400 font-bold border border-green-500/30'
                                  : 'bg-white/5 text-white/30 border border-white/10';

                                const rawScoreA = isKata
                                  ? (bout.total_score_a !== undefined && bout.total_score_a !== null
                                      ? bout.total_score_a
                                      : (bout.judge_scores_a && bout.judge_scores_a.length > 0
                                          ? bout.judge_scores_a.reduce((acc, v) => acc + v, 0)
                                          : (bout.score_a ?? 0)))
                                  : (bout.score_a ?? 0);

                                const rawScoreB = isKata
                                  ? (bout.total_score_b !== undefined && bout.total_score_b !== null
                                      ? bout.total_score_b
                                      : (bout.judge_scores_b && bout.judge_scores_b.length > 0
                                          ? bout.judge_scores_b.reduce((acc, v) => acc + v, 0)
                                          : (bout.score_b ?? 0)))
                                  : (bout.score_b ?? 0);

                                const displayScoreA = isKata && rawScoreA % 1 !== 0 ? rawScoreA.toFixed(2) : rawScoreA;
                                const displayScoreB = isKata && rawScoreB % 1 !== 0 ? rawScoreB.toFixed(2) : rawScoreB;

                                return (
                                  <button
                                    key={bout.id}
                                    onClick={() => loadBout(bout)}
                                    className={`w-full text-left px-2 py-1.5 transition hover:bg-white/5 cursor-pointer border-l-2 ${
                                      isAct
                                        ? 'bg-yellow-400/10 border-l-yellow-400 shadow-inner'
                                        : 'border-l-transparent'
                                    }`}
                                  >
                                    {/* Match Header */}
                                    <div className="flex items-center justify-between mb-0.5">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[8.5px] font-black text-white/90">
                                          R{bout.round_no}B{bout.bout_no}
                                        </span>
                                        {bout.scheduled_time && (
                                          <span className="text-[6.5px] text-white/40 font-mono">
                                            {bout.scheduled_time}
                                          </span>
                                        )}
                                      </div>
                                      <span className={`text-[6.5px] font-black px-1.5 py-0.2 rounded uppercase ${sb}`}>
                                        {bout.status === 'Running' ? '● LIVE' : bout.status}
                                      </span>
                                    </div>

                                    {/* AKA Competitor & Result */}
                                    <div className={`flex items-center justify-between px-1.5 py-0.5 rounded text-[8px] transition ${
                                      akaWin ? 'bg-red-950/70 border border-red-700/50 text-red-200 font-bold' : 'text-white/80'
                                    }`}>
                                      <div className="flex items-center gap-1 min-w-0">
                                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                                        <span className="truncate">{pA?.full_name || 'TBD'}</span>
                                        {bout.senshu_a && (
                                          <span className="text-[5.5px] font-black text-yellow-400 bg-yellow-400/10 px-1 rounded border border-yellow-400/30">
                                            SENSHU
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1 shrink-0">
                                        {akaWin && (
                                          <span className="text-[6px] bg-red-600/60 text-white px-1 rounded font-black">
                                            WINNER
                                          </span>
                                        )}
                                        <span className="font-mono text-[8.5px] font-black px-1 rounded bg-black/40">
                                          {displayScoreA}
                                        </span>
                                      </div>
                                    </div>

                                    {/* AO Competitor & Result */}
                                    <div className={`flex items-center justify-between px-1.5 py-0.5 rounded mt-0.5 text-[8px] transition ${
                                      aoWin ? 'bg-blue-950/70 border border-blue-700/50 text-blue-200 font-bold' : 'text-white/80'
                                    }`}>
                                      <div className="flex items-center gap-1 min-w-0">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                                        <span className="truncate">{pB?.full_name || 'TBD'}</span>
                                        {bout.senshu_b && (
                                          <span className="text-[5.5px] font-black text-yellow-400 bg-yellow-400/10 px-1 rounded border border-yellow-400/30">
                                            SENSHU
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1 shrink-0">
                                        {aoWin && (
                                          <span className="text-[6px] bg-blue-600/60 text-white px-1 rounded font-black">
                                            WINNER
                                          </span>
                                        )}
                                        <span className="font-mono text-[8.5px] font-black px-1 rounded bg-black/40">
                                          {displayScoreB}
                                        </span>
                                      </div>
                                    </div>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
          <div className="shrink-0 border-t border-white/10 p-2 flex gap-1">
            <button onClick={() => { loadData(); addLog('SYSTEM', 'Match Console: Refresh clicked'); }} className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-white/5 hover:bg-white/10 rounded text-[8px] font-bold text-white/50 transition cursor-pointer">
              <RefreshCw className="h-2.5 w-2.5" /> REFRESH
            </button>
            <button onClick={() => { handleChartClick(); addLog('SYSTEM', 'Match Console: Chart view triggered'); }} className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 rounded text-[8px] font-bold text-yellow-400 transition cursor-pointer">
              <BarChart3 className="h-2.5 w-2.5" /> CHART
            </button>
            <Link href="/draws" onClick={() => addLog('SYSTEM', 'Match Console: Navigating to Repechage / Draws')} className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-white/5 hover:bg-white/10 rounded text-[8px] font-bold text-white/50 transition">
              <List className="h-2.5 w-2.5" /> REPECHAGE
            </Link>
          </div>
        </aside>

        {/* RIGHT AREA — TOP (Dock + Keylog) & BOTTOM (Player Details + Extra Timer + Status) */}
        <div className="flex flex-col h-full min-h-0 overflow-hidden">

          {/* TOP SECTION: FUNCTION DOCK (left) | KEY LOG TERMINAL (right) */}
          <div className="flex-1 min-h-0 flex overflow-hidden border-b border-white/10">

            {/* FUNCTION DOCK */}
            <main className="flex flex-col bg-[#09090d] overflow-hidden shrink-0 w-[58%] max-w-[620px] border-r border-white/10">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-black uppercase tracking-widest text-white/50">FUNCTION DOCK</span>
                  <span className="text-[7px] text-white/20 font-bold hidden sm:inline">(DRAG & DROP TO REORDER)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {dockOrder.length > 0 && (
                    <button
                      onClick={resetDockOrder}
                      title="Reset Button Order"
                      className="px-1.5 py-0.5 rounded text-[7px] font-bold text-yellow-400/80 hover:text-yellow-300 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 transition flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="h-2 w-2" /> RESET
                    </button>
                  )}
                  <button
                    onClick={() => setExpandModal({ open: true, terminal: 'FUNCTION DOCK', targetUrl: `${basePath}/display` })}
                    title="Expand & Output Display"
                    className="p-1 rounded text-white/20 hover:text-white/60 transition cursor-pointer"
                  >
                    <Maximize2 className="h-3 w-3" />
                  </button>
                  <button className="p-1 rounded text-white/20 hover:text-white/60 transition cursor-pointer"><SlidersHorizontal className="h-3 w-3" /></button>
                  <button className="p-1 rounded text-white/20 hover:text-white/60 transition cursor-pointer"><X className="h-3 w-3" /></button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                <div className="grid grid-cols-8 gap-1.5">
                  {orderedDockButtons.map((btn) => {
                    const Icon = btn.icon;
                    const isDragging = draggedDockId === btn.id;
                    const isDragOver = dragOverDockId === btn.id;
                    return (
                      <button
                        key={btn.id}
                        draggable
                        onDragStart={(e) => {
                          setDraggedDockId(btn.id);
                          e.dataTransfer.setData('text/plain', btn.id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                        }}
                        onDragEnter={() => setDragOverDockId(btn.id)}
                        onDragLeave={() => {
                          if (dragOverDockId === btn.id) setDragOverDockId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (draggedDockId) {
                            handleDockReorder(draggedDockId, btn.id);
                            setDraggedDockId(null);
                            setDragOverDockId(null);
                          }
                        }}
                        onDragEnd={() => {
                          setDraggedDockId(null);
                          setDragOverDockId(null);
                        }}
                        onClick={btn.action}
                        title={`${btn.label} (Drag to rearrange)`}
                        className={`group relative flex flex-col items-center justify-center gap-1 p-1 h-[44px] sm:h-[48px] rounded-lg border transition cursor-grab active:cursor-grabbing ${dockColorMap[btn.color]} ${
                          isDragging
                            ? 'opacity-40 scale-95 border-dashed border-yellow-400 ring-2 ring-yellow-400/50'
                            : isDragOver
                            ? 'ring-2 ring-yellow-400 scale-105 z-10 shadow-lg shadow-yellow-500/20'
                            : 'hover:scale-[1.02]'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0 group-hover:scale-110 transition-transform pointer-events-none" />
                        <span className="text-[6px] sm:text-[6.5px] font-black uppercase tracking-wider text-center leading-tight block truncate max-w-full px-0.5 pointer-events-none">
                          {btn.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2.5 pt-2 border-t border-white/5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[7.5px] text-white/30 font-black uppercase tracking-wider mr-1">SHORTCUTS:</span>
                  {[
                    ['F1', 'BRACKET'],
                    ['F2', 'PLAYER'],
                    ['F3', 'RESULT'],
                    ['F4', 'EXTRA TIMER'],
                    ['F5', 'KEY LOG'],
                    ['F6', 'SETTINGS'],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => handleShortcutAction(key)}
                      title={`Press ${key} or click to trigger ${label}`}
                      className="flex items-center gap-1 text-[7px] text-white/50 hover:text-white bg-white/5 hover:bg-white/15 active:scale-95 border border-white/10 hover:border-yellow-400/50 rounded-md px-1.5 py-0.5 transition cursor-pointer font-bold shadow-xs"
                    >
                      <span className="bg-yellow-400/10 text-yellow-400 border border-yellow-400/30 rounded px-1 py-0.2 font-mono font-black text-[6.5px]">
                        {key}
                      </span>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </main>

            {/* KEY LOG TERMINAL */}
            <aside className="flex flex-col flex-1 bg-[#0c0f14] overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 shrink-0">
                <span className="text-[9px] font-black uppercase tracking-widest text-white/50">KEY LOG TERMINAL</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      setExpandModal({ open: true, terminal: 'KEY LOG TERMINAL', targetUrl: `${basePath}/dashboard/control` });
                      addLog('SYSTEM', 'Key Log: Expanded to output display modal');
                    }}
                    title="Expand & Output Display"
                    className="p-1 rounded text-white/20 hover:text-white/60 transition cursor-pointer"
                  >
                    <Maximize2 className="h-3 w-3" />
                  </button>
                  <button onClick={() => addLog('SYSTEM', 'Key Log: Filter options toggled')} title="Filter" className="p-1 rounded text-white/20 hover:text-white/60 transition cursor-pointer"><Filter className="h-3 w-3" /></button>
                  <button onClick={() => { setKeyLog([]); addLog('SYSTEM', 'Key Log: Cleared all log history'); }} title="Clear Log" className="p-1 rounded text-white/20 hover:text-red-400 transition cursor-pointer"><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
              <div className="flex border-b border-white/10 shrink-0">
                {(['ALL', 'SCORE', 'PENALTY', 'TIMER', 'SYSTEM'] as const).map(tab => (
                  <button key={tab} onClick={() => { setKeyLogTab(tab); addLog('SYSTEM', `Key Log: Tab filtered by ${tab}`); }}
                    className={`flex-1 text-[7px] font-black uppercase py-1.5 tracking-wider transition border-b-2 cursor-pointer ${keyLogTab === tab ? 'text-yellow-400 border-yellow-400' : 'text-white/25 border-transparent hover:text-white/50'}`}>
                    {tab}
                  </button>
                ))}
              </div>
              <div ref={logContainerRef} className="flex-1 overflow-y-auto font-mono text-[9px] scroll-smooth p-1">
                {filteredLog.length === 0 ? (
                  <div className="flex items-center justify-center py-4 text-white/20 text-[9px]">No entries</div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {filteredLog.map(entry => (
                      <div key={entry.id} className="px-2 py-1 hover:bg-white/5 flex gap-1.5 items-center">
                        <span className="text-white/20 shrink-0 text-[8px]">{entry.time}</span>
                        <span className={`shrink-0 px-1 py-0.2 rounded text-[6.5px] font-black ${logColorMap[entry.category] || ''}`}>{entry.category}</span>
                        <span className="text-white/70 break-all text-[8px] truncate">{entry.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="shrink-0 border-t border-white/10 p-2 space-y-1.5">
                <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded px-2">
                  <Search className="h-3 w-3 text-white/25 shrink-0" />
                  <input value={keyLogSearch} onChange={e => setKeyLogSearch(e.target.value)}
                    placeholder="Search logs..." className="bg-transparent text-[8.5px] text-white placeholder-white/20 flex-1 outline-none py-0.5" />
                </div>
                <div className="flex gap-1">
                  <button onClick={handleExportKeyLog} className="flex-1 flex items-center justify-center gap-1 py-1 bg-white/5 hover:bg-white/15 active:scale-95 rounded text-[7.5px] font-black uppercase text-slate-200 hover:text-white transition cursor-pointer border border-white/10 shadow-xs"><Download className="h-2.5 w-2.5 text-sky-400" /> EXPORT</button>
                  <button onClick={handlePrintKeyLog} className="flex-1 flex items-center justify-center gap-1 py-1 bg-white/5 hover:bg-white/15 active:scale-95 rounded text-[7.5px] font-black uppercase text-slate-200 hover:text-white transition cursor-pointer border border-white/10 shadow-xs"><Printer className="h-2.5 w-2.5 text-amber-400" /> PRINT</button>
                  <button onClick={() => { setKeyLog([]); addLog('SYSTEM', 'Key Log: Cleared all log history'); }} className="flex-1 flex items-center justify-center gap-1 py-1 bg-red-900/20 hover:bg-red-900/40 active:scale-95 border border-red-800/30 rounded text-[7.5px] font-black uppercase text-red-400 hover:text-red-300 transition cursor-pointer"><Trash2 className="h-2.5 w-2.5" /> CLEAR</button>
                </div>
              </div>
            </aside>
          </div>

          {/* BOTTOM SECTION: PLAYER DETAILS | EXTRA TIMER | SYSTEM STATUS */}
          <section className="h-[108px] shrink-0 operator-panel-secondary flex items-stretch overflow-hidden border-t">

            {/* PLAYER DETAILS (Full Database Fields for AKA & AO) */}
            <div className="flex-1 min-w-0 border-r border-white/10 px-3 py-2 flex gap-2.5 items-center overflow-hidden h-full">
              {/* AKA */}
              <div
                onClick={() => akaFighter && setSelectedProfileModal({ participant: akaFighter, corner: 'AKA' })}
                className="flex gap-2 flex-1 items-center min-w-0 h-full bg-red-950/20 hover:bg-red-950/40 border border-red-900/30 rounded-xl p-2 transition cursor-pointer"
                title="Click for full participant profile"
              >
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <span className="text-[7.5px] font-black text-red-300 bg-red-900/60 border border-red-700/50 px-1.5 py-0.5 rounded leading-none">AKA</span>
                  <div className="w-10 h-13 rounded-lg bg-white/5 border border-white/10 overflow-hidden flex items-center justify-center shadow-inner">
                    {akaFighter?.photo_url
                      ? <img src={akaFighter.photo_url} alt={akaFighter.full_name} className="w-full h-full object-cover" />
                      : <UserSquare2 className="h-5 w-5 text-red-300/40" />}
                  </div>
                </div>

                <div className="text-[8px] leading-tight text-white/70 space-y-0.5 min-w-0 flex-1">
                  <div className="font-black text-white text-[9.5px] truncate flex items-center gap-1">
                    <span>{akaFighter?.full_name || '—'}</span>
                    {akaFighter?.gender && <span className="text-[7px] text-white/40">({akaFighter.gender})</span>}
                  </div>
                  <div className="text-[7.5px] text-white/50 truncate">
                    <span>REG: #{akaFighter?.registration_no || '—'}</span> · <span>AGE: {calculateAge(akaFighter?.dob) ?? '—'}</span>
                  </div>
                  <div className="text-[8px] text-yellow-400 font-bold truncate">
                    <span>CLUB: {akaFighter ? (clubs.find(c => c.id === akaFighter.club_id)?.name || '—') : '—'}</span>
                  </div>
                  <div className="text-[7.5px] text-white/50 truncate">
                    <span>COACH: {akaFighter ? (coaches.find(c => c.id === akaFighter.coach_id)?.name || '—') : '—'}</span> · <span>WT: {akaFighter?.weight ? `${akaFighter.weight}kg` : '—'}</span>
                  </div>
                </div>
              </div>

              <div className="w-px bg-white/10 self-stretch shrink-0" />

              {/* AO */}
              <div
                onClick={() => aoFighter && setSelectedProfileModal({ participant: aoFighter, corner: 'AO' })}
                className="flex gap-2 flex-1 items-center min-w-0 h-full bg-blue-950/20 hover:bg-blue-950/40 border border-blue-900/30 rounded-xl p-2 transition cursor-pointer"
                title="Click for full participant profile"
              >
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <span className="text-[7.5px] font-black text-blue-300 bg-blue-900/60 border border-blue-700/50 px-1.5 py-0.5 rounded leading-none">AO</span>
                  <div className="w-10 h-13 rounded-lg bg-white/5 border border-white/10 overflow-hidden flex items-center justify-center shadow-inner">
                    {aoFighter?.photo_url
                      ? <img src={aoFighter.photo_url} alt={aoFighter.full_name} className="w-full h-full object-cover" />
                      : <UserSquare2 className="h-5 w-5 text-blue-300/40" />}
                  </div>
                </div>

                <div className="text-[8px] leading-tight text-white/70 space-y-0.5 min-w-0 flex-1">
                  <div className="font-black text-white text-[9.5px] truncate flex items-center gap-1">
                    <span>{aoFighter?.full_name || '—'}</span>
                    {aoFighter?.gender && <span className="text-[7px] text-white/40">({aoFighter.gender})</span>}
                  </div>
                  <div className="text-[7.5px] text-white/50 truncate">
                    <span>REG: #{aoFighter?.registration_no || '—'}</span> · <span>AGE: {calculateAge(aoFighter?.dob) ?? '—'}</span>
                  </div>
                  <div className="text-[8px] text-cyan-400 font-bold truncate">
                    <span>CLUB: {aoFighter ? (clubs.find(c => c.id === aoFighter.club_id)?.name || '—') : '—'}</span>
                  </div>
                  <div className="text-[7.5px] text-white/50 truncate">
                    <span>COACH: {aoFighter ? (coaches.find(c => c.id === aoFighter.coach_id)?.name || '—') : '—'}</span> · <span>WT: {aoFighter?.weight ? `${aoFighter.weight}kg` : '—'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* EXTRA TIMER (Fixed width, zero overflow) */}
            <div className="w-[210px] shrink-0 border-r border-white/10 px-3 py-2 flex flex-col justify-between h-full bg-[#0c0f16] extra-timer-panel">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-[7.5px] font-black uppercase tracking-wider text-white/40">EXTRA TIMER</span>
                  <button
                    onClick={() => {
                      const next = !extraTimerBroadcast;
                      setExtraTimerBroadcast(next);
                      broadcastExtraTimer(extraTime, extraRunning, next);
                      addLog('TIMER', next ? 'Extra Timer display sync ON' : 'Extra Timer display sync OFF');
                    }}
                    className={`text-[6.5px] font-black px-1.5 py-0.5 rounded transition cursor-pointer border ${
                      extraTimerBroadcast ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50' : 'bg-white/5 text-white/30 border-white/10 hover:text-white'
                    }`}
                    title="Click to toggle broadcast to Referee / Spectator Screen"
                  >
                    {extraTimerBroadcast ? '📡 SYNC ON' : '📡 SYNC OFF'}
                  </button>
                </div>
                <span className="text-[7px] text-yellow-400 font-bold">NEXT {nextBout ? `R${nextBout.round_no}B${nextBout.bout_no}` : '—'}</span>
              </div>
              <div className="text-xl font-mono font-black text-white text-center leading-none my-0.5 tracking-wider">{formatTimer(extraTime)}</div>
              <div className="grid grid-cols-5 gap-0.5">
                {[600, 300, 180, 120, 60].map(t => (
                  <button key={t} onClick={() => { 
                    setExtraTime(t); 
                    setExtraRunning(false); 
                    broadcastExtraTimer(t, false, extraTimerBroadcast);
                    addLog('TIMER', `Extra Timer: Preset set to ${formatTimer(t)}`);
                  }}
                    className={`text-[6.5px] font-black rounded py-0.5 transition cursor-pointer border ${extraTime === t && !extraRunning ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400' : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white'}`}>
                    {formatTimer(t)}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 mt-0.5">
                <button onClick={() => {
                  const nextRunning = !extraRunning;
                  setExtraRunning(nextRunning);
                  broadcastExtraTimer(extraTime, nextRunning, extraTimerBroadcast);
                  addLog('TIMER', nextRunning ? `Extra Timer: Started (${formatTimer(extraTime)})` : `Extra Timer: Paused at ${formatTimer(extraTime)}`);
                }}
                  className={`flex-1 flex items-center justify-center gap-1 py-1 rounded text-[7px] font-black transition cursor-pointer ${extraRunning ? 'bg-orange-500 text-white' : 'bg-green-600 text-white'}`}>
                  {extraRunning ? <><Pause className="h-2 w-2" /> PAUSE</> : <><Play className="h-2 w-2" /> START</>}
                </button>
                <button onClick={() => { 
                  setExtraTime(300); 
                  setExtraRunning(false); 
                  broadcastExtraTimer(300, false, extraTimerBroadcast);
                  addLog('TIMER', 'Extra Timer: Reset to 05:00');
                }}
                  className="flex-1 flex items-center justify-center gap-1 py-1 bg-orange-900/30 hover:bg-orange-900/50 border border-orange-800/40 rounded text-[7px] font-black text-orange-300 transition cursor-pointer">
                  <RotateCcw className="h-2 w-2" /> RESET
                </button>
              </div>
            </div>

            {/* SYSTEM STATUS (Dynamic, clean layout) */}
            <LiveSystemStatus effectiveTatami={effectiveTatami} userEmail={userEmail || 'unknown'} isOnline={isOnline} dbStatus={dbStatus} />
          </section>
        </div>
      </div>

      {/* LAUNCH REFEREE SCREEN MODAL (SAME AS SCOREBOARD) */}
      {expandModal?.open && (
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-cyan-500/30 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 relative">
            <button 
              onClick={() => setExpandModal(null)}
              className="absolute top-4 right-4 p-1.5 bg-white/5 hover:bg-white/10 rounded-full text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center justify-center w-12 h-12 bg-cyan-500/10 rounded-xl mb-2 border border-cyan-500/20 mx-auto">
              <Tv className="h-6 w-6 text-cyan-400" />
            </div>

            <div className="text-center">
              <h2 className="text-xl font-black text-white uppercase tracking-wide">Launch Referee Screen</h2>
              <p className="text-xs text-slate-400 mt-1">
                Choose how you want to open the live referee screen for this tatami.
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <button
                onClick={() => {
                  window.open(expandModal.targetUrl, 'KarateTech_RefereeScreen', 'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no');
                  setExpandModal(null);
                  addLog('SYSTEM', 'Referee Screen launched in Clean Window');
                }}
                className="w-full flex items-center justify-between p-4 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 hover:border-cyan-500/50 rounded-xl transition cursor-pointer group text-left"
              >
                <div className="flex items-center gap-3">
                  <Monitor className="h-5 w-5 text-cyan-400 shrink-0" />
                  <div>
                    <div className="font-bold text-sm text-cyan-100">Open in Clean Window (Recommended)</div>
                    <div className="text-[10.5px] text-cyan-400/80">Frameless window, best for secondary monitor / projector</div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-cyan-400 shrink-0" />
              </button>

              <button
                onClick={() => {
                  window.open(expandModal.targetUrl, '_blank');
                  setExpandModal(null);
                  addLog('SYSTEM', 'Referee Screen opened in New Tab');
                }}
                className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-cyan-500/10 border border-white/10 hover:border-cyan-500/30 rounded-xl transition cursor-pointer group text-left"
              >
                <div className="flex items-center gap-3">
                  <ExternalLink className="h-5 w-5 text-slate-400 group-hover:text-cyan-400 shrink-0" />
                  <div>
                    <div className="font-bold text-sm text-white">Open in New Tab</div>
                    <div className="text-[10.5px] text-slate-400">Standard browser tab</div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-500 group-hover:text-cyan-400 shrink-0" />
              </button>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-lg p-2 text-[9px] font-mono text-white/40 truncate text-center">
              URL: {expandModal.targetUrl}
            </div>

            <button
              onClick={() => setExpandModal(null)}
              className="w-full py-2 bg-transparent hover:bg-white/5 text-white/40 hover:text-white/80 font-bold rounded-lg text-xs transition cursor-pointer"
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {vrPlaybackOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="flex h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-cyan-500/30 bg-[#0b1220] shadow-2xl shadow-cyan-950/30">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <div className="text-[9px] font-black uppercase tracking-[0.25em] text-cyan-400">VR FOOTAGE VIEWER</div>
                <div className="text-xs text-white/60">Review saved match footage without leaving the console</div>
              </div>
              <button
                onClick={() => setVrPlaybackOpen(false)}
                className="rounded border border-white/10 bg-white/5 p-2 text-white/60 transition hover:bg-white/10 hover:text-white cursor-pointer"
                title="Close playback viewer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid flex-1 overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]">
              <aside className="border-b border-white/10 bg-[#0f172a]/70 p-3 lg:border-b-0 lg:border-r">
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="block text-[8px] font-black uppercase tracking-[0.2em] text-white/40">Search footage</label>
                    <div className="flex items-center gap-2 rounded border border-white/10 bg-white/5 px-2 py-2">
                      <Search className="h-3 w-3 text-white/40" />
                      <input
                        value={vrPlaybackSearch}
                        onChange={(event) => setVrPlaybackSearch(event.target.value)}
                        placeholder="Category / match / athlete"
                        className="w-full bg-transparent text-[10px] text-white placeholder:text-white/30 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-[8px] font-black uppercase tracking-[0.2em] text-white/40">Category</label>
                    <select
                      value={vrPlaybackCategory}
                      onChange={(event) => setVrPlaybackCategory(event.target.value)}
                      className="w-full rounded border border-white/10 bg-[#111827] px-2 py-2 text-[10px] text-white focus:outline-none"
                    >
                      <option value="ALL">ALL CATEGORIES</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={() => {
                      const currentMatchId = activeBout?.id || null;
                      if (currentMatchId) {
                        setVrPlaybackSelectedId(currentMatchId);
                        setVrPlaybackCategory(activeBout?.category_id || 'ALL');
                      }
                    }}
                    className="w-full rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-2 text-[9px] font-black uppercase tracking-[0.22em] text-cyan-200 transition hover:bg-cyan-500/20 cursor-pointer"
                  >
                    Focus current match
                  </button>
                </div>

                <div className="mt-4 space-y-2 overflow-y-auto pr-1">
                  {filteredVrPlaybackEntries.length === 0 ? (
                    <div className="rounded border border-dashed border-white/10 bg-white/5 p-4 text-center text-[10px] text-white/45">
                      No recordings found for this search.
                    </div>
                  ) : (
                    filteredVrPlaybackEntries.map((entry, index) => {
                      const selected = selectedVrPlaybackEntry?.id === entry.id;
                      return (
                        <button
                          key={entry.id}
                          onClick={() => setVrPlaybackSelectedId(entry.id)}
                          className={`w-full rounded-xl border p-2 text-left transition ${selected ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10'} cursor-pointer`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-300">{entry.matchCode}</span>
                            <span className="text-[7px] text-white/40">{entry.duration ? `${Math.round(entry.duration)}s` : '—'}</span>
                          </div>
                          <div className="mt-1 text-xs font-bold text-white">{entry.categoryName}</div>
                          <div className="mt-0.5 text-[10px] text-white/60">{entry.akaName} vs {entry.aoName}</div>
                          <div className="mt-1 text-[8px] uppercase tracking-[0.15em] text-white/35">{entry.cameraLabel} • {new Date(entry.recordedAt).toLocaleString()}</div>
                          {index === 0 && activeBout?.vr_file_url === entry.url && (
                            <div className="mt-2 text-[8px] font-black uppercase tracking-[0.2em] text-yellow-300">Current match footage</div>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </aside>

              <div className="flex min-h-0 flex-col bg-[#0b1220]">
                {selectedVrPlaybackEntry ? (
                  <>
                    <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                      <div>
                        <div className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-300">{selectedVrPlaybackEntry.categoryName}</div>
                        <div className="text-sm font-black text-white">{selectedVrPlaybackEntry.matchCode} • {selectedVrPlaybackEntry.akaName} vs {selectedVrPlaybackEntry.aoName}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const currentIndex = filteredVrPlaybackEntries.findIndex((entry) => entry.id === selectedVrPlaybackEntry.id);
                            const prevEntry = filteredVrPlaybackEntries[currentIndex - 1] || filteredVrPlaybackEntries[filteredVrPlaybackEntries.length - 1];
                            if (prevEntry) setVrPlaybackSelectedId(prevEntry.id);
                          }}
                          className="rounded border border-white/10 bg-white/5 p-2 text-white/70 transition hover:bg-white/10 cursor-pointer"
                          title="Previous clip"
                        >
                          <ArrowLeft className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            const currentIndex = filteredVrPlaybackEntries.findIndex((entry) => entry.id === selectedVrPlaybackEntry.id);
                            const nextEntry = filteredVrPlaybackEntries[currentIndex + 1] || filteredVrPlaybackEntries[0];
                            if (nextEntry) setVrPlaybackSelectedId(nextEntry.id);
                          }}
                          className="rounded border border-white/10 bg-white/5 p-2 text-white/70 transition hover:bg-white/10 cursor-pointer"
                          title="Next clip"
                        >
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-hidden p-4">
                      <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-black/30">
                        <video
                          key={selectedVrPlaybackEntry.url}
                          ref={vrPlaybackVideoRef}
                          src={selectedVrPlaybackEntry.url}
                          controls
                          playsInline
                          preload="metadata"
                          onError={() => {
                            setVrError('This VR recording could not be loaded or is not supported by the current browser.');
                          }}
                          className="h-full w-full bg-black object-contain"
                        />
                        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-[#0a1019] px-4 py-3">
                          <button
                            onClick={() => {
                              const video = vrPlaybackVideoRef.current;
                              if (!video || !video.src) return;

                              try {
                                if (video.paused) {
                                  const playPromise = video.play();
                                  if (playPromise && typeof playPromise.catch === 'function') {
                                    playPromise.catch((error: unknown) => {
                                      console.warn('VR playback blocked:', error);
                                      setVrError('This recording cannot autoplay in this browser. Use the native video controls to play it manually.');
                                    });
                                  }
                                } else {
                                  video.pause();
                                }
                              } catch (error) {
                                console.warn('VR playback error:', error);
                                setVrError('This recording could not be played in the current browser.');
                              }
                            }}
                            className="flex items-center gap-2 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1.5 text-[8px] font-black uppercase tracking-[0.22em] text-cyan-200 transition hover:bg-cyan-500/20 cursor-pointer"
                          >
                            <Play className="h-3 w-3" /> Play / Pause
                          </button>
                          <button
                            onClick={() => {
                              const video = vrPlaybackVideoRef.current;
                              if (!video) return;
                              void video.requestFullscreen?.();
                            }}
                            className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-[8px] font-black uppercase tracking-[0.22em] text-white/80 transition hover:bg-white/10 cursor-pointer"
                          >
                            Fullscreen
                          </button>
                          {[0.5, 1, 1.5, 2].map((rate) => (
                            <button
                              key={rate}
                              onClick={() => {
                                const video = vrPlaybackVideoRef.current;
                                if (!video) return;
                                video.playbackRate = rate;
                              }}
                              className={`rounded border px-2 py-1.5 text-[8px] font-black uppercase tracking-[0.18em] transition cursor-pointer ${
                                (vrPlaybackVideoRef.current?.playbackRate ?? 1) === rate
                                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-200'
                                  : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                              }`}
                            >
                              {rate}x
                            </button>
                          ))}
                          <a
                            href={selectedVrPlaybackEntry.url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-auto rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-1.5 text-[8px] font-black uppercase tracking-[0.22em] text-yellow-200 transition hover:bg-yellow-500/20 cursor-pointer"
                          >
                            Open file
                          </a>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex h-full items-center justify-center p-8 text-center text-white/45">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.2em] text-white/50">No footage selected</div>
                      <div className="mt-2 text-sm">Choose a saved recording from the list to review it here.</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {vrPreviewOpen && (
        <div
          className="fixed z-50 w-[280px] rounded-xl border border-red-500/40 bg-[#0b0f14]/95 shadow-2xl backdrop-blur-sm"
          style={{ left: vrPreviewPosition.x, top: vrPreviewPosition.y }}
        >
          <div
            className="flex cursor-grab items-center justify-between border-b border-white/10 px-3 py-2 text-[8px] font-black uppercase tracking-wider text-red-400"
            onMouseDown={(event) => {
              vrDragRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                originX: vrPreviewPosition.x,
                originY: vrPreviewPosition.y,
              };
            }}
            onMouseMove={(event) => {
              if (!vrDragRef.current) return;
              const dx = event.clientX - vrDragRef.current.startX;
              const dy = event.clientY - vrDragRef.current.startY;
              setVrPreviewPosition({
                x: Math.min(window.innerWidth - 300, Math.max(0, vrDragRef.current.originX + dx)),
                y: Math.min(window.innerHeight - 220, Math.max(0, vrDragRef.current.originY + dy)),
              });
            }}
            onMouseUp={() => { vrDragRef.current = null; }}
            onMouseLeave={() => { vrDragRef.current = null; }}
          >
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" /> REC</span>
            <span>{formatRecordingDuration(vrRecordingSeconds)}</span>
          </div>
          <div className="relative">
            <video ref={vrVideoRef} autoPlay muted playsInline className="h-[170px] w-full bg-black object-cover" />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 text-[7px] uppercase tracking-[0.2em] text-white/80">
              Live Webcam
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-white/10 px-3 py-2 text-[7px] text-white/70">
            <span className="truncate">{vrCameraLabel}</span>
            {vrResultPath ? (
              <button
                onClick={() => window.open(vrResultPath, '_blank', 'noopener,noreferrer')}
                className="rounded border border-white/10 bg-white/5 px-2 py-1 font-black uppercase text-yellow-300 transition hover:bg-white/10 cursor-pointer"
              >
                View Recording
              </button>
            ) : (
              <button
                onClick={async () => { await stopVrRecording(); }}
                className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 font-black uppercase text-red-300 transition hover:bg-red-500/20 cursor-pointer"
              >
                Stop
              </button>
            )}
          </div>
        </div>
      )}

      {vrError && (
        <div className="fixed bottom-6 right-6 z-[60] max-w-sm rounded-xl border border-red-500/40 bg-[#120b0b]/95 px-4 py-3 text-sm text-red-100 shadow-2xl">
          <div className="font-black uppercase tracking-wide text-red-300">VR Recording Error</div>
          <div className="mt-1 text-xs text-red-100/80">{vrError}</div>
        </div>
      )}

      {/* FULL PARTICIPANT PROFILE MODAL */}
      {selectedProfileModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121620] border border-white/20 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 text-sans">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <span className={`text-xs font-black px-2 py-1 rounded border uppercase ${selectedProfileModal.corner === 'AKA' ? 'bg-red-950 text-red-300 border-red-700' : 'bg-blue-950 text-blue-300 border-blue-700'}`}>
                  {selectedProfileModal.corner} CORNER
                </span>
                <div>
                  <h2 className="text-base font-black text-white">{selectedProfileModal.participant.full_name}</h2>
                  <p className="text-[10px] text-white/50 font-mono">REG ID: #{selectedProfileModal.participant.registration_no}</p>
                </div>
              </div>
              <button onClick={() => setSelectedProfileModal(null)} className="p-1 rounded text-white/30 hover:text-white transition cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content Details Grid */}
            <div className="grid grid-cols-12 gap-3 text-xs">
              {/* Photo & Quick Badges */}
              <div className="col-span-4 flex flex-col items-center gap-2 bg-white/5 p-3 rounded-xl border border-white/10 text-center">
                <div
                  className="w-20 h-24 rounded-lg bg-black/40 border border-white/15 overflow-hidden flex items-center justify-center cursor-pointer group relative"
                  onClick={() => setPhotoModalParticipant(selectedProfileModal.participant)}
                  title="Click to change photo"
                >
                  {selectedProfileModal.participant.photo_url
                    ? <img src={selectedProfileModal.participant.photo_url} alt={selectedProfileModal.participant.full_name} className="w-full h-full object-cover" />
                    : <UserSquare2 className="h-10 w-10 text-white/20" />}
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera className="h-5 w-5 text-white" />
                  </div>
                </div>
                <span className="text-[10px] font-bold text-yellow-400">{selectedProfileModal.participant.nationality_code || 'NATIONAL'}</span>
                <span className={`text-[8.5px] font-black px-2 py-0.5 rounded-full ${selectedProfileModal.participant.status === 'Checked In' ? 'bg-green-500/20 text-green-400 border border-green-500/40' : 'bg-white/10 text-white/60'}`}>
                  ● {selectedProfileModal.participant.status || 'CONFIRMED'}
                </span>
              </div>

              {/* Comprehensive DB Fields Grid */}
              <div className="col-span-8 grid grid-cols-2 gap-2 text-[10px] leading-snug">
                <div className="bg-white/5 p-2 rounded border border-white/5">
                  <span className="text-[8px] font-black uppercase text-white/30 block">GENDER & AGE</span>
                  <span className="font-bold text-white">{selectedProfileModal.participant.gender} · {calculateAge(selectedProfileModal.participant.dob) ?? '—'} yrs</span>
                </div>
                <div className="bg-white/5 p-2 rounded border border-white/5">
                  <span className="text-[8px] font-black uppercase text-white/30 block">DATE OF BIRTH</span>
                  <span className="font-bold text-white">{selectedProfileModal.participant.dob || '—'}</span>
                </div>
                <div className="bg-white/5 p-2 rounded border border-white/5">
                  <span className="text-[8px] font-black uppercase text-white/30 block">PASSPORT / IC</span>
                  <span className="font-mono font-bold text-white">{selectedProfileModal.participant.passport_ic || '—'}</span>
                </div>
                <div className="bg-white/5 p-2 rounded border border-white/5">
                  <span className="text-[8px] font-black uppercase text-white/30 block">WEIGHT & HEIGHT</span>
                  <span className="font-bold text-white">{selectedProfileModal.participant.weight ? `${selectedProfileModal.participant.weight} kg` : '—'} / {selectedProfileModal.participant.height ? `${selectedProfileModal.participant.height} cm` : '—'}</span>
                </div>
                <div className="bg-white/5 p-2 rounded border border-white/5 col-span-2">
                  <span className="text-[8px] font-black uppercase text-white/30 block">CLUB / DOJO</span>
                  <span className="font-bold text-white">{clubs.find(c => c.id === selectedProfileModal.participant.club_id)?.name || '—'}</span>
                </div>
                <div className="bg-white/5 p-2 rounded border border-white/5 col-span-2">
                  <span className="text-[8px] font-black uppercase text-white/30 block">ASSIGNED COACH</span>
                  <span className="font-bold text-white">{coaches.find(c => c.id === selectedProfileModal.participant.coach_id)?.name || 'Unassigned'}</span>
                </div>
                <div className="bg-white/5 p-2 rounded border border-white/5">
                  <span className="text-[8px] font-black uppercase text-white/30 block">MEDICAL STATUS</span>
                  <span className="font-bold text-green-400">{selectedProfileModal.participant.medical_status || 'Cleared'}</span>
                </div>
                <div className="bg-white/5 p-2 rounded border border-white/5">
                  <span className="text-[8px] font-black uppercase text-white/30 block">PAYMENT STATUS</span>
                  <span className="font-bold text-blue-400">{selectedProfileModal.participant.payment_status || 'Paid'}</span>
                </div>
              </div>
            </div>

            {/* Contact & Emergency info */}
            <div className="bg-white/[0.02] border border-white/10 rounded-xl p-3 grid grid-cols-2 gap-2 text-[9.5px]">
              <div>
                <span className="text-[8px] font-black uppercase text-white/30 block">EMAIL & PHONE</span>
                <p className="text-white/80 font-mono truncate">{selectedProfileModal.participant.email || '—'}</p>
                <p className="text-white/60 font-mono">{selectedProfileModal.participant.phone || '—'}</p>
              </div>
              <div>
                <span className="text-[8px] font-black uppercase text-white/30 block">EMERGENCY CONTACT</span>
                <p className="text-white/80 font-bold truncate">{selectedProfileModal.participant.emergency_contact_name || '—'}</p>
                <p className="text-white/60 font-mono">{selectedProfileModal.participant.emergency_contact_phone || '—'}</p>
              </div>
            </div>

            {selectedProfileModal.participant.remarks && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2 text-[9.5px] text-yellow-300">
                <span className="font-bold uppercase text-[8px] block text-yellow-400">REMARKS</span>
                {selectedProfileModal.participant.remarks}
              </div>
            )}

            {/* Footer buttons */}
            <div className="pt-2 flex gap-2">
              <button
                onClick={() => {
                  setEditParticipantId(selectedProfileModal.participant.id);
                  setSelectedProfileModal(null);
                }}
                className="flex-1 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 font-black rounded-lg text-xs transition cursor-pointer flex items-center justify-center gap-1.5 border border-yellow-500/30"
              >
                ✏️ EDIT PROFILE
              </button>
              <button onClick={() => setSelectedProfileModal(null)} className="flex-1 py-2 bg-white/10 hover:bg-white/20 text-white font-bold rounded-lg text-xs transition cursor-pointer">
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PLAYER PHOTO UPLOAD / WEBCAM MODAL */}
      {photoModalParticipant && (
        <PlayerPhotoModal
          participant={photoModalParticipant}
          onClose={() => setPhotoModalParticipant(null)}
          onSaved={(updated) => {
            // Refresh participants list so photo shows immediately
            setPhotoModalParticipant(null);
            loadData();
            // If profile modal is open for same participant, reflect update
            if (selectedProfileModal?.participant.id === updated.id) {
              setSelectedProfileModal(prev => prev ? { ...prev, participant: updated } : null);
            }
          }}
        />
      )}

      {/* EDIT PARTICIPANT DRAWER */}
      {editParticipantId && (
        <EditParticipantDrawer
          participantId={editParticipantId}
          onClose={() => {
            setEditParticipantId(null);
            loadData();
          }}
        />
      )}


      {/* MATCH NOTES MODAL */}
      {isNotesModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-[#121620] border border-white/10 rounded-xl w-[400px] overflow-hidden flex flex-col shadow-2xl">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-yellow-400" />
                <span className="font-black text-sm uppercase tracking-widest text-white">MATCH NOTES</span>
              </div>
              <button onClick={() => setIsNotesModalOpen(false)} className="text-white/40 hover:text-white transition cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-[10px] text-white/50 uppercase tracking-wider">
                These notes will be saved to the current match ({activeBout ? `R${activeBout.round_no}B${activeBout.bout_no}` : ''}).
              </p>
              <textarea
                value={notesText}
                onChange={e => setNotesText(e.target.value)}
                className="w-full h-32 bg-[#090b0f] border border-white/10 rounded p-3 text-sm text-white/80 focus:outline-none focus:border-yellow-400/50 resize-none"
                placeholder="Type your notes here..."
              />
            </div>
            <div className="p-3 border-t border-white/10 bg-black/20 flex gap-2 justify-end">
              <button
                onClick={() => setIsNotesModalOpen(false)}
                className="px-4 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white/70 text-xs font-bold transition cursor-pointer"
              >
                CANCEL
              </button>
              <button
                onClick={() => {
                  if (activeBout) {
                    updateBout({ notes: notesText });
                    addLog('SYSTEM', 'Match notes updated');
                  }
                  setIsNotesModalOpen(false);
                }}
                className="px-4 py-1.5 rounded bg-yellow-500 hover:bg-yellow-400 text-black text-xs font-black transition cursor-pointer"
              >
                SAVE NOTES
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LOAD MATCH CATEGORY SELECTOR MODAL */}
      {isLoadMatchModalOpen && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-[#121620] border border-white/20 rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-yellow-500/10 rounded-xl text-yellow-400 border border-yellow-500/30">
                  <FolderOpen className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-black text-white uppercase tracking-wide">LOAD MATCH — CATEGORIES</h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-white/50 font-medium">Select a category to load onto Match Console</span>
                    <span className={`text-[8.5px] font-black uppercase px-2 py-0.5 rounded-full border ${
                      disciplineFilter === 'KUMITE'
                        ? 'bg-red-950/80 border-red-700 text-red-300'
                        : disciplineFilter === 'KATA'
                        ? 'bg-blue-950/80 border-blue-700 text-blue-300'
                        : 'bg-yellow-950/80 border-yellow-700 text-yellow-300'
                    }`}>
                      {disciplineFilter === 'KUMITE' ? '🥊 KUMITE ONLY (LOCKED)' : disciplineFilter === 'KATA' ? '🥋 KATA ONLY (LOCKED)' : '🥋 ALL DISCIPLINES'}
                    </span>
                  </div>
                </div>
              </div>
              <button onClick={() => setIsLoadMatchModalOpen(false)} className="p-1 rounded text-white/30 hover:text-white transition cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Discipline Filter Tabs & Search Bar */}
            <div className="px-5 py-3 border-b border-white/10 bg-black/20 flex flex-col sm:flex-row gap-2.5 items-center justify-between">
              {/* Discipline Switcher */}
              <div className="flex p-1 bg-white/5 rounded-lg border border-white/10 w-full sm:w-auto">
                {(['ALL', 'KUMITE', 'KATA'] as const).map(disc => (
                  <button
                    key={disc}
                    onClick={() => {
                      setDisciplineFilter(disc);
                      setSelectedCatId('ALL');
                    }}
                    className={`px-3 py-1 text-[9px] font-black uppercase rounded-md transition cursor-pointer ${
                      disciplineFilter === disc
                        ? disc === 'KUMITE'
                          ? 'bg-red-600 text-white shadow-md'
                          : disc === 'KATA'
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'bg-yellow-500 text-black shadow-md'
                        : 'text-white/40 hover:text-white'
                    }`}
                  >
                    {disc === 'KUMITE' ? '🥊 KUMITE' : disc === 'KATA' ? '🥋 KATA' : 'ALL'}
                  </button>
                ))}
              </div>

              {/* Search Bar */}
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 w-full sm:w-64">
                <Search className="h-3.5 w-3.5 text-white/30 shrink-0" />
                <input
                  type="text"
                  value={loadMatchSearch}
                  onChange={e => setLoadMatchSearch(e.target.value)}
                  placeholder="Search category name, age..."
                  className="bg-transparent text-xs text-white placeholder-white/30 outline-none flex-1 font-sans"
                />
                {loadMatchSearch && (
                  <button onClick={() => setLoadMatchSearch('')} className="text-white/30 hover:text-white">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Categories List */}
            <div className="flex-1 overflow-y-auto p-5 space-y-2.5">
              {(() => {
                const modalCategories = filteredCategories.filter(c => {
                  if (!loadMatchSearch) return true;
                  const q = loadMatchSearch.toLowerCase();
                  return (
                    c.name.toLowerCase().includes(q) ||
                    (c.gender && c.gender.toLowerCase().includes(q)) ||
                    (c.min_age && c.min_age.toString().includes(q))
                  );
                });

                if (modalCategories.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-12 text-center text-white/30 space-y-2">
                      <FolderOpen className="h-10 w-10 opacity-30" />
                      <p className="text-sm font-bold">No categories found matching your filter</p>
                      <p className="text-xs text-white/20">Try switching between KUMITE and KATA or clearing your search.</p>
                    </div>
                  );
                }

                return modalCategories.map(cat => {
                  const isKata = isKataCategory(cat);
                  const catBoutsList = bouts.filter(b => b.category_id === cat.id && b.status !== 'Walkover');
                  const completedBouts = catBoutsList.filter(b => b.status === 'Completed').length;
                  const isExpanded = expandedCatId === cat.id;

                  const myTatami = `Tatami ${takeoverTatami || tatamiId || localTatamiParam || 1}`;
                  const isLockedByOther = false;

                  return (
                    <div
                      key={cat.id}
                      className={`bg-white/5 hover:bg-white/[0.07] border border-white/10 rounded-xl overflow-hidden transition ${isLockedByOther ? 'opacity-60' : ''}`}
                    >
                      {/* Main Category Row */}
                      <div className="p-3.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className={`text-[8.5px] font-black uppercase px-2 py-0.5 rounded border shrink-0 ${
                            isKata ? 'bg-blue-950/80 border-blue-700 text-blue-300' : 'bg-red-950/80 border-red-700 text-red-300'
                          }`}>
                            {isKata ? '🥋 KATA' : '🥊 KUMITE'}
                          </span>

                          <div className="min-w-0 flex-1">
                            <h3 className="text-xs font-black text-white truncate">{cat.name}</h3>
                            <div className="flex items-center gap-2 text-[9.5px] text-white/40 mt-0.5">
                              {cat.gender && <span>{cat.gender === 'Male' ? '♂ Male' : cat.gender === 'Female' ? '♀ Female' : cat.gender}</span>}
                              {cat.min_age && <span>· Age {cat.min_age}{cat.max_age && cat.max_age < 99 ? `-${cat.max_age}` : '+'}</span>}
                              <span>· {completedBouts}/{catBoutsList.length} matches completed</span>
                            </div>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-2 shrink-0">
                          {isLockedByOther ? (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-950/40 border border-red-500/20 rounded-lg shadow-sm">
                              <Lock className="w-3.5 h-3.5 text-red-400" />
                              <span className="text-[10px] font-black uppercase text-red-400 tracking-wider">LOCKED</span>
                            </div>
                          ) : (
                            <>
                              {catBoutsList.length > 0 && (
                                <button
                                  onClick={() => setExpandedCatId(isExpanded ? null : cat.id)}
                                  className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition flex items-center gap-1 cursor-pointer border ${
                                    isExpanded
                                      ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
                                      : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10 hover:text-white'
                                  }`}
                                >
                                  <span>{catBoutsList.length} Bouts</span>
                                  {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                </button>
                              )}

                              <button
                                onClick={() => {
                                  setSelectedCatId(cat.id);
                                  setBracketTab('MATCH LIST');
                                  setIsLoadMatchModalOpen(false);
                                  addLog('SYSTEM', `Category loaded: ${cat.name}`);
                                }}
                                className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-400 text-black font-black rounded-lg text-[10px] uppercase tracking-wider transition cursor-pointer shadow-md"
                              >
                                SELECT CATEGORY
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Expanded Bout List */}
                      {isExpanded && catBoutsList.length > 0 && (
                        <div className="border-t border-white/10 bg-black/40 p-3 space-y-1.5">
                          <span className="text-[8.5px] font-black uppercase tracking-wider text-white/30 block mb-1">
                            SELECT BOUT TO LOAD DIRECTLY:
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                            {catBoutsList.map(b => {
                              const aka = participants.find(p => p.id === b.participant_a_id);
                              const ao = participants.find(p => p.id === b.participant_b_id);
                              const isCurrent = activeBout?.id === b.id;

                              return (
                                <button
                                  key={b.id}
                                  onClick={() => {
                                    setSelectedCatId(cat.id);
                                    loadBout(b);
                                    setBracketTab('MATCH LIST');
                                    setIsLoadMatchModalOpen(false);
                                  }}
                                  className={`p-2 rounded-lg border text-left flex items-center justify-between gap-2 transition cursor-pointer ${
                                    isCurrent
                                      ? 'bg-yellow-500/15 border-yellow-500/50 text-yellow-300'
                                      : 'bg-white/5 border-white/10 hover:bg-white/10 text-white/80'
                                  }`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[8.5px] font-black font-mono px-1 rounded bg-white/10 text-yellow-400">
                                        R{b.round_no}B{b.bout_no}
                                      </span>
                                      <span className={`text-[7.5px] font-bold px-1 rounded uppercase ${
                                        b.status === 'Completed' ? 'bg-green-900/40 text-green-400' : b.status === 'Running' ? 'bg-red-900/40 text-red-400' : 'bg-white/5 text-white/40'
                                      }`}>
                                        {b.status}
                                      </span>
                                    </div>
                                    <div className="text-[9.5px] font-bold truncate mt-0.5 flex items-center gap-1">
                                      <span className="text-red-400">{aka?.full_name || 'AKA'}</span>
                                      <span className="text-white/30 text-[8px]">vs</span>
                                      <span className="text-blue-400">{ao?.full_name || 'AO'}</span>
                                    </div>
                                  </div>
                                  <ChevronRight className="h-3.5 w-3.5 text-white/30 shrink-0" />
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-white/10 bg-white/[0.02] flex items-center justify-between">
              <span className="text-[10px] text-white/40">
                {filteredCategories.length} categories available under active filter
              </span>
              <button
                onClick={() => setIsLoadMatchModalOpen(false)}
                className="px-4 py-1.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-lg text-xs transition cursor-pointer"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LIVE BRACKET POPUP MODAL */}
      {isBracketModalOpen && (
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 lg:p-6">
          <div className="bg-[#0b0f19] border border-cyan-500/30 rounded-2xl w-full max-w-7xl h-[92vh] flex flex-col overflow-hidden shadow-2xl relative">
            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-white/10 bg-[#0e1422] flex items-center justify-between gap-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-yellow-400">
                  <Trophy className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm sm:text-base font-black text-white uppercase tracking-wider">LIVE TOURNAMENT BRACKET</h2>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-black tracking-widest bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE SYNC
                    </span>
                  </div>
                  <p className="text-[10px] text-white/50">
                    Real-time match tree, scoring progress, and winner bracket advancement
                  </p>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2 sm:gap-3">
                {/* Category Dropdown Filter */}
                <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-xl px-2.5 py-1.5">
                  <Filter className="h-3 w-3 text-yellow-400 shrink-0" />
                  <select
                    value={bracketModalCatId}
                    onChange={e => setBracketModalCatId(e.target.value)}
                    className="bg-transparent text-[11px] font-bold text-white outline-none cursor-pointer pr-1 max-w-[180px] sm:max-w-[260px] truncate"
                  >
                    <option value="ALL" className="bg-[#0e1422] text-white">ALL CATEGORIES</option>
                    {filteredCategories.map(c => (
                      <option key={c.id} value={c.id} className="bg-[#0e1422] text-white">
                        {isKataCategory(c) ? '🥋' : '🥊'} {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* External Display / Projector Button */}
                <button
                  onClick={() => {
                    const catIdToOpen = bracketModalCatId !== 'ALL' ? bracketModalCatId : (activeCat?.id || filteredCategories[0]?.id || '');
                    window.open(`${basePath}/display/brackets?categoryId=${catIdToOpen}`, '_blank');
                  }}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 rounded-xl text-xs font-bold transition cursor-pointer"
                  title="Open bracket on external screen / projector"
                >
                  <Tv className="h-3.5 w-3.5" />
                  <span>Projector View</span>
                </button>

                {/* Print Button */}
                <button
                  onClick={() => {
                    if (bracketModalCatId === 'ALL') {
                      // Print every category that has bracket data, in tournament order
                      const catIdsWithBouts = new Set(bouts.map(b => b.category_id));
                      const orderedCatIds = filteredCategories.filter(c => catIdsWithBouts.has(c.id)).map(c => c.id);
                      if (orderedCatIds.length === 0) {
                        alert('No brackets found to print.');
                        return;
                      }
                      window.open(`${basePath}/draws/print-preview?catId=${orderedCatIds.join(',')}&autoPrint=true`, '_blank');
                      return;
                    }
                    const catIdToPrint = bracketModalCatId !== 'ALL' ? bracketModalCatId : (activeCat?.id || filteredCategories[0]?.id || '');
                    window.open(`${basePath}/draws/print-preview?catId=${catIdToPrint}&autoPrint=true`, '_blank');
                  }}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 border border-white/15 text-white rounded-xl text-xs font-bold transition cursor-pointer"
                  title={bracketModalCatId === 'ALL' ? 'Print / Save PDF for every category (one page per category)' : 'Print Draw Sheet'}
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>{bracketModalCatId === 'ALL' ? 'Print All Brackets' : 'Print'}</span>
                </button>

                {/* Close Button */}
                <button
                  onClick={() => setIsBracketModalOpen(false)}
                  className="p-1.5 bg-white/5 hover:bg-white/10 text-white/50 hover:text-white rounded-xl transition cursor-pointer"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Modal Body - Interactive Sportdata Live Bracket Tree */}
            <div className="flex-1 overflow-auto bg-[#070a12] p-2 sm:p-4">
              <SportdataBracket
                bouts={bouts}
                participants={participants}
                clubs={clubs}
                categories={categories}
                selectedCatId={bracketModalCatId !== 'ALL' ? bracketModalCatId : (activeCat?.id || filteredCategories[0]?.id || null)}
                onBoutClick={b => {
                  loadBout(b);
                  setSelectedCatId(b.category_id);
                  setIsBracketModalOpen(false);
                  setIsControlPanelOpen(true);
                  addLog('SYSTEM', `Loaded match R${b.round_no}B${b.bout_no} from Bracket into console`);
                }}
                theme="dark"
                height="100%"
              />
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-2.5 border-t border-white/10 bg-[#0e1422] flex items-center justify-between text-[10.5px] text-white/50 shrink-0">
              <div className="flex items-center gap-2">
                <span>💡 <strong className="text-yellow-400">Interactive:</strong> Click any bout card in the bracket tree to load it directly into the Match Console.</span>
              </div>
              <button
                onClick={() => setIsBracketModalOpen(false)}
                className="px-4 py-1 bg-white/10 hover:bg-white/20 text-white font-bold rounded-lg text-xs transition cursor-pointer"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OFFICIAL WKF KATA LIST MODAL */}
      {isKataListModalOpen && (
        <KataListModal isOpen={isKataListModalOpen} onClose={() => setIsKataListModalOpen(false)} />
      )}

      {/* Officials Modal */}
      {isOfficialsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#11141b] border border-white/10 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between p-5 border-b border-white/5 shrink-0 bg-[#0a0c10]/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                  <ShieldCheck className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-white uppercase tracking-widest">Officials Directory</h2>
                  <p className="text-[10px] text-white/40 font-bold uppercase tracking-wider">Tournament Roster</p>
                </div>
              </div>
              <button 
                onClick={() => setIsOfficialsModalOpen(false)}
                className="p-2 rounded-xl text-white/30 hover:text-white hover:bg-white/10 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 bg-[#0a0c10]/20">
              {officials.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-white/30 space-y-3">
                  <Shield className="h-10 w-10 opacity-50" />
                  <p className="text-xs font-bold uppercase tracking-widest">No officials registered.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {officials.map(official => (
                    <div key={official.id} className="bg-[#11141b] border border-white/5 hover:border-white/20 transition-all rounded-2xl overflow-hidden flex flex-col shadow-lg">
                      <div className="p-4 flex items-center gap-4 border-b border-white/5">
                        <div className="w-16 h-16 rounded-full bg-black/50 border-2 border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                          {official.photo_url ? (
                            <img src={official.photo_url} alt={official.name} className="w-full h-full object-cover" />
                          ) : (
                            <Shield className="h-6 w-6 text-white/20" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-bold text-white truncate">{official.name}</h3>
                          <span className={`inline-block px-2 py-0.5 mt-1 rounded text-[9px] font-black uppercase tracking-wider ${
                            official.role === 'Tatami Manager' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                            official.role === 'Referee' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                            official.role === 'Judge' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' :
                            'bg-white/10 text-white/60 border border-white/10'
                          }`}>
                            {official.role}
                          </span>
                        </div>
                      </div>
                      <div className="p-4 space-y-3 bg-[#0a0c10]/30 flex-1">
                        <div>
                          <span className="text-[9px] font-black text-white/30 uppercase tracking-widest block mb-0.5">Qualification</span>
                          <span className="text-xs font-semibold text-white/80">{official.qualification || 'None listed'}</span>
                        </div>
                        <div>
                          <span className="text-[9px] font-black text-white/30 uppercase tracking-widest block mb-0.5">Contact</span>
                          <div className="flex flex-col gap-1 mt-1">
                            {official.phone ? (
                              <div className="flex items-center gap-2 text-xs font-medium text-white/70">
                                <Phone className="h-3 w-3 text-white/30" />
                                <span>{official.phone}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-white/40 italic">No phone</span>
                            )}
                            {official.email && (
                              <div className="flex items-center gap-2 text-xs font-medium text-white/70 mt-0.5">
                                <Mail className="h-3 w-3 text-white/30" />
                                <span className="truncate">{official.email}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-white/5 bg-[#11141b] flex justify-end">
              <button 
                onClick={() => setIsOfficialsModalOpen(false)}
                className="px-6 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl text-xs font-bold uppercase tracking-widest transition cursor-pointer"
              >
                Close Directory
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
