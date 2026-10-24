'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/db/dbClient';
import { Club, Participant, Coach, Team } from '@/db/types';
import { useTournament } from '@/context/TournamentContext';
import { 
  Award, Plus, Search, Edit2, Trash2, X, Check, 
  RefreshCw, MapPin, Building, ShieldCheck, Users, Trophy, Upload
} from 'lucide-react';
import ImportClubModal from '@/components/ImportClubModal';

export interface ClubsContentProps {
  isClubMode?: boolean;
  clubId?: string;
}

export function ClubsContent({ isClubMode, clubId }: ClubsContentProps) {
  const { refreshKey, triggerRefresh, canModify: contextCanModify, userRole } = useTournament();
  const canModify = isClubMode && userRole === 'Club' ? true : contextCanModify;

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  
  const [searchQuery, setSearchQuery] = useState('');

  // Form states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [clList, pList, coList, tList] = await Promise.all([
        db.clubs.list(),
        db.participants.list(),
        db.coaches.list(),
        db.teams.list()
      ]);
      setClubs(clList);
      setParticipants(pList);
      setCoaches(coList);
      setTeams(tList);
    } catch (err) {
      console.error('Error loading clubs data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mounted) {
      loadData();
    }
  }, [mounted, refreshKey]);

  const handleOpenAddModal = () => {
    setEditingId(null);
    setName('');
    setCity('');
    setState('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (club: Club) => {
    setEditingId(club.id);
    setName(club.name);
    setCity(club.city || '');
    setState(club.state || '');
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !city || !state) {
      alert('Please fill in all required fields.');
      return;
    }

    try {
      setLoading(true);
      const payload = { name, city, state };
      if (editingId) {
        await db.clubs.update(editingId, payload);
      } else {
        await db.clubs.add(payload);
      }
      setIsModalOpen(false);
      triggerRefresh();
      alert('Club Dojo saved successfully.');
    } catch (err: any) {
      alert(err.message || 'Failed to save Club Dojo.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    // Check if there are active members in this club first to warn the user!
    const membersCount = participants.filter(p => p.club_id === id).length;
    const warnMessage = membersCount > 0 
      ? `WARNING: This Club Dojo currently has ${membersCount} registered competitors. Deleting this club will leave those competitors unassigned. Do you wish to proceed?`
      : 'Are you sure you want to remove this Club Dojo?';

    if (!confirm(warnMessage)) return;

    try {
      setLoading(true);
      await db.clubs.delete(id);
      triggerRefresh();
      alert('Club Dojo removed successfully.');
    } catch (err: any) {
      alert(err.message || 'Failed to delete Club Dojo.');
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) return null;

  // Filter clubs based on search query and clubId if in club mode
  const displayedClubs = isClubMode && clubId 
    ? clubs.filter(c => c.id === clubId)
    : clubs;

  const filteredClubs = displayedClubs.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (c.city && c.city.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (c.state && c.state.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="p-6 space-y-6 text-foreground w-full min-h-[calc(100vh-64px)] flex flex-col overflow-y-auto">
      
      {/* Title */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dojo & Club Academies</h1>
          <p className="text-sm text-muted-foreground">Register dojos, manage locations, and view athlete representations across active teams.</p>
        </div>

        {canModify && !isClubMode && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsImportOpen(true)}
              className="px-4 py-2 bg-secondary border border-border hover:bg-secondary/80 text-foreground rounded-lg text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Import CSV</span>
            </button>
            <button
              onClick={handleOpenAddModal}
              className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/95 rounded-lg text-xs font-bold transition shadow-sm cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4 text-white" />
              <span>Add Club Dojo</span>
            </button>
          </div>
        )}
      </div>

      {/* Filters Bar */}
      <div className="bg-card border border-border p-4 rounded-xl shadow-xs shrink-0 flex items-center justify-between gap-4">
        {/* Search */}
        <div className="relative w-64">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by dojo name, location..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 bg-secondary border border-border rounded-lg text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="p-2 hover:bg-secondary border border-border text-muted-foreground hover:text-foreground rounded-lg transition-colors cursor-pointer"
          title="Refresh list"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Roster Table Content */}
      <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
        {loading && clubs.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-12 text-muted-foreground text-xs font-semibold">
            Loading Dojo academies Roster...
          </div>
        ) : filteredClubs.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted-foreground text-xs bg-card border border-border rounded-xl space-y-2">
            <Building className="h-8 w-8 text-primary/20" />
            <span className="font-bold text-foreground">No Club Dojos Found</span>
            <span>Check search query or add a new Dojo academy to the registry.</span>
          </div>
        ) : (
          <div className="flex-1 border border-border bg-card rounded-xl overflow-hidden flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-secondary/40 font-bold border-b border-border sticky top-0 z-10 backdrop-blur-xs">
                  <tr>
                    <th className="p-3">Dojo Name</th>
                    <th className="p-3">Location (City, State)</th>
                    <th className="p-3 text-center font-bold text-foreground">Competitors</th>
                    <th className="p-3 text-center font-bold text-foreground">Coaches</th>
                    <th className="p-3 text-center font-bold text-foreground">Squad Teams</th>
                    {canModify && <th className="p-3 text-center font-bold text-foreground">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredClubs.map((club) => {
                    const studentCount = participants.filter(p => p.club_id === club.id).length;
                    const coachCount = coaches.filter(c => c.club_id === club.id).length;
                    const squadCount = teams.filter(t => t.club_id === club.id).length;

                    return (
                      <tr key={club.id} className="hover:bg-secondary/25 transition-colors">
                        <td className="p-3 font-semibold text-foreground flex items-center gap-2">
                          <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0">
                            {club.name.substring(0, 2).toUpperCase()}
                          </div>
                          <span>{club.name}</span>
                        </td>
                        <td className="p-3 text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                            <span>{club.city || 'Unknown'}, {club.state || 'N/A'}</span>
                          </span>
                        </td>
                        <td className="p-3 text-center font-bold text-foreground">
                          <span className="flex items-center justify-center gap-1">
                            <Users className="h-3.5 w-3.5 text-blue-500/80" />
                            <span>{studentCount}</span>
                          </span>
                        </td>
                        <td className="p-3 text-center font-bold text-foreground">
                          <span className="flex items-center justify-center gap-1">
                            <ShieldCheck className="h-3.5 w-3.5 text-purple-500/80" />
                            <span>{coachCount}</span>
                          </span>
                        </td>
                        <td className="p-3 text-center font-bold text-foreground">
                          <span className="flex items-center justify-center gap-1">
                            <Trophy className="h-3.5 w-3.5 text-amber-500/85" />
                            <span>{squadCount}</span>
                          </span>
                        </td>
                        {canModify && (
                          <td className="p-3">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => handleOpenEditModal(club)}
                                className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary rounded cursor-pointer"
                                title="Edit Club details"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              {!isClubMode && (
                                <button
                                  onClick={() => handleDelete(club.id)}
                                  className="p-1 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded cursor-pointer"
                                  title="Delete Club"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ADD / EDIT DIALOG MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-card border border-border max-w-md w-full rounded-2xl shadow-xl overflow-hidden flex flex-col">
            
            <div className="p-5 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building className="h-5 w-5 text-primary" />
                <h3 className="font-extrabold text-sm">{editingId ? 'Edit Club Dojo' : 'Register New Club Dojo'}</h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 hover:bg-secondary rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              
              {/* Dojo Name */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Dojo / Club Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Kelab Senshi Goju-Ryu Karate"
                  className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* City */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">City *</label>
                <input
                  type="text"
                  required
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Petaling Jaya"
                  className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* State */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">State *</label>
                <input
                  type="text"
                  required
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="e.g. Selangor"
                  className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="border-t border-border pt-4 mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-border text-foreground hover:bg-secondary rounded-lg text-xs font-bold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/95 rounded-lg text-xs font-bold transition shadow-sm cursor-pointer flex items-center gap-1 disabled:opacity-50"
                >
                  <Check className="h-4 w-4 text-white" />
                  <span>{editingId ? 'Save Changes' : 'Register Dojo'}</span>
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* Import CSV Modal */}
      {!isClubMode && (
        <ImportClubModal 
          isOpen={isImportOpen} 
          onClose={() => setIsImportOpen(false)} 
        />
      )}

    </div>
  );
}

export default function ClubsPage() {
  return <ClubsContent />;
}
