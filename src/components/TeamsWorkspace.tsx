'use client';

import React, { useState, useEffect } from 'react';
import { useTournament } from '@/context/TournamentContext';
import { db, describeError } from '@/db/dbClient';
import { Team, Participant, Club, Coach } from '@/db/types';
import { 
  Plus, UsersRound, Trophy, User, Trash2, X, Check, AlertTriangle, ShieldCheck, RefreshCw, Edit, Upload, Search
} from 'lucide-react';
import ImportTeamModal from '@/components/ImportTeamModal';

export interface TeamsContentProps {
  isClubMode?: boolean;
  clubId?: string;
}

export function TeamsContent({ isClubMode, clubId }: TeamsContentProps) {
  const { refreshKey, triggerRefresh, canModify: contextCanModify, userRole } = useTournament();
  const canModify = isClubMode && userRole === 'Club' ? true : contextCanModify;

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const [teams, setTeams] = useState<Team[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  
  // Member maps: holds participant array for each team ID
  const [teamMembersMap, setTeamMembersMap] = useState<Record<string, Participant[]>>({});

  // Dialog open triggers
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);

  // Create Team state
  const [teamName, setTeamName] = useState('');
  const [selectedClubId, setSelectedClubId] = useState('');
  const [selectedCoachId, setSelectedCoachId] = useState('');

  // Add Member state
  const [selectedPartId, setSelectedPartId] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [memberSearchQuery, setMemberSearchQuery] = useState('');

  // Edit Team state
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editTeamName, setEditTeamName] = useState('');
  const [editClubId, setEditClubId] = useState('');
  const [editCoachId, setEditCoachId] = useState('');
  const [editScore, setEditScore] = useState(0);
  const [editRanking, setEditRanking] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [tList, clList, coList, pList, offList] = await Promise.all([
        db.teams.list(),
        db.clubs.list(),
        db.coaches.list(),
        db.participants.list(),
        db.officials.list()
      ]);
      
      // Merge database coaches and officials registered as Coach
      const officialCoaches: Coach[] = offList
        .filter(o => o.role === 'Coach')
        .map(o => ({
          id: o.id,
          name: o.name,
          email: o.email,
          phone: o.phone
        }));

      const mergedCoaches = [...coList];
      // Avoid duplicate IDs just in case
      officialCoaches.forEach(oc => {
        if (!mergedCoaches.some(c => c.id === oc.id)) {
          mergedCoaches.push(oc);
        }
      });
      
      // If in club mode, only keep teams and participants for this club
      const filteredTeams = isClubMode && clubId ? tList.filter(t => t.club_id === clubId) : tList;
      const filteredParts = isClubMode && clubId ? pList.filter(p => p.club_id === clubId) : pList;

      setTeams(filteredTeams);
      setClubs(clList);
      setCoaches(mergedCoaches);
      setParticipants(filteredParts);

      if (isClubMode && clubId) {
        setSelectedClubId(clubId);
      } else if (clList.length > 0) {
        setSelectedClubId(clList[0].id);
      }
      
      if (coList.length > 0) setSelectedCoachId(coList[0].id);

      // Load members for each team
      const tempMembers: Record<string, Participant[]> = {};
      for (const t of filteredTeams) {
        const mems = await db.teams.members(t.id);
        tempMembers[t.id] = mems;
      }
      setTeamMembersMap(tempMembers);

    } catch (e) {
      console.error('Error loading team data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mounted) {
      loadData();
    }
  }, [mounted, refreshKey]);

  // Validate athlete club on membership select
  useEffect(() => {
    if (!selectedPartId || !activeTeamId) {
      setValidationError(null);
      return;
    }

    const t = teams.find(team => team.id === activeTeamId);
    const p = participants.find(part => part.id === selectedPartId);
    
    if (t && p) {
      if (p.club_id !== t.club_id) {
        const teamClubName = clubs.find(c => c.id === t.club_id)?.name || 'Unknown Club';
        const athleteClubName = clubs.find(c => c.id === p.club_id)?.name || 'Independent';
        setValidationError(
          `Validation Warning: Athlete belongs to "${athleteClubName}" but this team represents "${teamClubName}". Only club-mates are allowed.`
        );
      } else {
        setValidationError(null);
      }
    }
  }, [selectedPartId, activeTeamId, teams, participants, clubs]);

  if (!mounted) return null;

  const handleOpenCreateModal = () => {
    setTeamName('');
    setSelectedClubId(isClubMode && clubId ? clubId : (clubs.length > 0 ? clubs[0].id : ''));
    setSelectedCoachId(coaches.length > 0 ? coaches[0].id : '');
    setIsCreateOpen(true);
  };

  // Actions
  const handleCreateTeamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamName || !selectedClubId) {
      alert('Team Name and Club representation are required.');
      return;
    }

    try {
      setLoading(true);
      await db.teams.add({
        name: teamName,
        club_id: selectedClubId,
        coach_id: selectedCoachId || undefined
      });
      alert('Team created successfully.');
      setIsCreateOpen(false);
      setTeamName('');
      triggerRefresh();
    } catch (err: any) {
      alert(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleAddMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTeamId || !selectedPartId) return;

    try {
      setLoading(true);
      await db.teams.addMember(activeTeamId, selectedPartId);
      alert('Member added to team.');
      setIsAddMemberOpen(false);
      setSelectedPartId('');
      setMemberSearchQuery('');
      triggerRefresh();
    } catch (err: any) {
      alert(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveMember = async (teamId: string, partId: string) => {
    if (confirm('Are you sure you want to remove this athlete from the team?')) {
      try {
        setLoading(true);
        await db.teams.removeMember(teamId, partId);
        alert('Member removed from team.');
        triggerRefresh();
      } catch (err: any) {
        alert(describeError(err));
      } finally {
        setLoading(false);
      }
    }
  };

  const handleSetCaptain = async (teamId: string, partId: string) => {
    try {
      setLoading(true);
      await db.teams.update(teamId, { captain_id: partId });
      alert('Team captain updated.');
      triggerRefresh();
    } catch (err: any) {
      alert(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleOpenEditModal = (team: Team) => {
    setEditingTeamId(team.id);
    setEditTeamName(team.name);
    setEditClubId(team.club_id);
    setEditCoachId(team.coach_id || '');
    setEditScore(team.score || 0);
    setEditRanking(team.ranking || 0);
    setIsEditOpen(true);
  };

  const handleEditTeamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeamId || !editTeamName || !editClubId) {
      alert('Team Name and Club representation are required.');
      return;
    }

    try {
      setLoading(true);
      await db.teams.update(editingTeamId, {
        name: editTeamName,
        club_id: editClubId,
        coach_id: editCoachId || undefined,
        score: editScore,
        ranking: editRanking || undefined
      });
      alert('Team updated successfully.');
      setIsEditOpen(false);
      setEditingTeamId(null);
      triggerRefresh();
    } catch (err: any) {
      alert(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTeam = async (teamId: string) => {
    if (!confirm('Are you sure you want to delete this team? All member mappings will be cleared.')) {
      return;
    }
    try {
      setLoading(true);
      await db.teams.delete(teamId);
      alert('Team deleted successfully.');
      triggerRefresh();
    } catch (err: any) {
      alert(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 text-foreground w-full h-full overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team Roster Management</h1>
          <p className="text-sm text-muted-foreground">Form club squads, define team captains, check validation rules, and track rankings.</p>
        </div>
        {canModify && (
          <div className="flex items-center gap-2 flex-wrap">
            {!isClubMode && (
              <button
                onClick={() => setIsImportOpen(true)}
                className="px-4 py-2 bg-secondary border border-border hover:bg-secondary/80 text-foreground text-xs font-bold rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Import CSV</span>
              </button>
            )}
            <button
              onClick={handleOpenCreateModal}
              className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/95 text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Create New Team</span>
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
          <span className="text-xs">Loading squads index...</span>
        </div>
      ) : teams.length === 0 ? (
        <div className="border border-dashed border-border p-12 text-center text-xs text-muted-foreground rounded-xl">
          No teams registered yet. Click &quot;Create New Team&quot; above to form the first squad.
        </div>
      ) : (
        /* Grid of Teams Cards */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {teams.map((t) => {
            const clubName = clubs.find(c => c.id === t.club_id)?.name || 'Unknown Club';
            const coachName = coaches.find(c => c.id === t.coach_id)?.name || 'None';
            const members = teamMembersMap[t.id] || [];
            const captain = members.find(m => m.id === t.captain_id);

            return (
              <div key={t.id} className="bg-card border border-border rounded-xl shadow-xs overflow-hidden flex flex-col justify-between hover:border-muted-foreground/25 transition-all">
                {/* Team meta */}
                <div className="p-5 space-y-4">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <UsersRound className="h-4.5 w-4.5 text-muted-foreground" />
                        <h3 className="font-extrabold text-sm text-foreground">{t.name}</h3>
                      </div>
                      <span className="text-[10px] text-muted-foreground block">{clubName} representation</span>
                    </div>
                    {/* Score / Rank badges */}
                    <div className="flex items-center gap-2">
                      <div className="bg-secondary px-2.5 py-1 rounded-lg text-right shrink-0 border border-border">
                        <span className="text-[9px] text-muted-foreground block uppercase font-bold">Rank</span>
                        <span className="text-xs font-extrabold text-foreground flex items-center gap-0.5 justify-end">
                          <Trophy className="h-3 w-3 text-amber-500" /> #{t.ranking || 'N/A'}
                        </span>
                      </div>
                      <div className="bg-secondary px-2.5 py-1 rounded-lg text-right shrink-0 border border-border">
                        <span className="text-[9px] text-muted-foreground block uppercase font-bold">Score</span>
                        <span className="text-xs font-extrabold text-primary">{t.score} pts</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-xs border-t border-b border-border/50 py-3">
                    <div>
                      <span className="text-[9px] font-bold text-muted-foreground uppercase block">Coach</span>
                      <span className="font-semibold mt-0.5 block">{coachName}</span>
                    </div>
                    <div>
                      <span className="text-[9px] font-bold text-muted-foreground uppercase block">Captain</span>
                      <span className="font-semibold mt-0.5 block text-primary truncate">
                        {captain ? captain.full_name : 'No Captain set'}
                      </span>
                    </div>
                  </div>

                  {/* Members list */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      <span>Squad Members ({members.length})</span>
                      {canModify && (
                        <button
                          onClick={() => { setActiveTeamId(t.id); setIsAddMemberOpen(true); setMemberSearchQuery(''); }}
                          className="text-primary hover:underline flex items-center gap-0.5 cursor-pointer font-bold lowercase"
                        >
                          + Add Member
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                      {members.length === 0 ? (
                        <span className="text-[11px] text-muted-foreground italic block py-2">Squad is currently empty.</span>
                      ) : (
                        members.map(m => (
                          <div key={m.id} className="flex items-center justify-between bg-secondary/30 p-2 rounded-lg text-xs hover:bg-secondary/60">
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 rounded-full bg-primary/10 text-primary font-bold text-[10px] flex items-center justify-center">
                                {m.full_name.substring(0, 2).toUpperCase()}
                              </div>
                              <span className="font-medium">{m.full_name}</span>
                              {m.id === t.captain_id && (
                                <span className="bg-amber-500/10 text-amber-600 text-[8px] font-bold px-1 rounded-full uppercase tracking-wider border border-amber-500/20">
                                  Captain
                                </span>
                              )}
                            </div>
                            {canModify && (
                              <div className="flex items-center gap-2">
                                {m.id !== t.captain_id && (
                                  <button
                                    onClick={() => handleSetCaptain(t.id, m.id)}
                                    className="text-[9px] font-semibold text-muted-foreground hover:text-primary cursor-pointer hover:underline"
                                    title="Appoint Captain"
                                  >
                                    Make Captain
                                  </button>
                                )}
                                <button
                                  onClick={() => handleRemoveMember(t.id, m.id)}
                                  className="p-0.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded cursor-pointer"
                                  title="Remove athlete"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* --- WIZARDS POPUPS --- */}

      {/* 1. CREATE SQUAD TEAM MODAL */}
      {isCreateOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-30 p-4">
          <form onSubmit={handleCreateTeamSubmit} className="bg-card w-full max-w-md rounded-xl shadow-xl border border-border overflow-hidden animate-scale-in text-foreground">
            <div className="p-5 border-b border-border bg-secondary/10 flex justify-between items-center">
              <span className="font-bold text-sm">Create New Squad Team</span>
              <button type="button" onClick={() => setIsCreateOpen(false)} className="p-1 text-muted-foreground hover:text-foreground">
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Squad Team Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Senshi Warriors Elite"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                />
              </div>

              {!isClubMode && (
                <div>
                  <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Select Represented Club Dojo</label>
                  <select
                    required
                    value={selectedClubId}
                    onChange={(e) => setSelectedClubId(e.target.value)}
                    className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-xs focus:outline-none text-foreground"
                  >
                    <option value="">Choose representing club dojo...</option>
                    {clubs.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Assign Coach</label>
                <select
                  value={selectedCoachId}
                  onChange={(e) => setSelectedCoachId(e.target.value)}
                  className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-xs focus:outline-none text-foreground"
                >
                  <option value="">No Coach</option>
                  {coaches.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="p-4 border-t border-border flex justify-end gap-2 bg-secondary/5">
              <button type="button" onClick={() => setIsCreateOpen(false)} className="px-3 py-1.5 border border-border text-muted-foreground hover:text-foreground rounded-lg text-xs font-semibold cursor-pointer">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!teamName || !selectedClubId}
                className="px-4 py-1.5 bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/95 text-xs font-bold rounded-lg cursor-pointer"
              >
                Create Squad
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 2. ADD MEMBER MODAL WITH CLUB VALIDATION */}
      {isAddMemberOpen && activeTeamId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-30 p-4">
          <form onSubmit={handleAddMemberSubmit} className="bg-card w-full max-w-md rounded-xl shadow-xl border border-border overflow-hidden animate-scale-in text-foreground">
            <div className="p-5 border-b border-border bg-secondary/10 flex justify-between items-center">
              <span className="font-bold text-sm">Add Squad Member</span>
              <button type="button" onClick={() => { setIsAddMemberOpen(false); setSelectedPartId(''); setMemberSearchQuery(''); }} className="p-1 text-muted-foreground hover:text-foreground">
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Search Athlete</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    autoFocus
                    value={memberSearchQuery}
                    onChange={(e) => setMemberSearchQuery(e.target.value)}
                    placeholder="Type name or registration no..."
                    className="w-full pl-8 pr-3 py-2 bg-secondary border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Select Athlete</label>
                <select
                  required
                  size={6}
                  value={selectedPartId}
                  onChange={(e) => setSelectedPartId(e.target.value)}
                  className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-xs focus:outline-none text-foreground"
                >
                  <option value="">Choose athlete...</option>
                  {participants
                    .filter(p => !(teamMembersMap[activeTeamId]?.some(m => m.id === p.id)))
                    .filter(p => {
                      const q = memberSearchQuery.trim().toLowerCase();
                      if (!q) return true;
                      return p.full_name.toLowerCase().includes(q) || p.registration_no?.toLowerCase().includes(q);
                    })
                    .map(p => {
                      const clubName = clubs.find(c => c.id === p.club_id)?.name || 'Independent';
                      return (
                        <option key={p.id} value={p.id}>
                          {p.full_name} ({clubName})
                        </option>
                      );
                    })}
                </select>
              </div>

              {/* Club Validation warning alert */}
              {validationError && (
                <div className="p-3.5 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 text-red-800 dark:text-red-400 rounded-lg flex gap-2 text-xs">
                  <AlertTriangle className="h-4.5 w-4.5 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">Validation Check Blocked</span>
                    <span className="block mt-0.5 leading-relaxed text-[11px]">{validationError}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border flex justify-end gap-2 bg-secondary/5">
              <button type="button" onClick={() => { setIsAddMemberOpen(false); setSelectedPartId(''); setMemberSearchQuery(''); }} className="px-3 py-1.5 border border-border text-muted-foreground hover:text-foreground rounded-lg text-xs font-semibold cursor-pointer">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!selectedPartId || !!validationError}
                className="px-4 py-1.5 bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/95 text-xs font-bold rounded-lg cursor-pointer"
              >
                Add Squad Member
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Import CSV Modal */}
      {!isClubMode && (
        <ImportTeamModal 
          isOpen={isImportOpen} 
          onClose={() => setIsImportOpen(false)} 
        />
      )}

    </div>
  );
}

export default function TeamsPage() {
  return <TeamsContent />;
}
