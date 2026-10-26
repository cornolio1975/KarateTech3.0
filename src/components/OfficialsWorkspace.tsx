'use client';

import React, { useState, useEffect } from 'react';
import { db } from '@/db/dbClient';
import { Official } from '@/db/types';
import { 
  ShieldCheck, Plus, Search, Edit2, Trash2, Shield, 
  MapPin, Check, X, RefreshCw, Grid, List, Mail, Phone, Users, Camera, Copy, ExternalLink
} from 'lucide-react';
import OfficialPhotoModal from '@/components/OfficialPhotoModal';

import { useTournament } from '@/context/TournamentContext';

export interface OfficialsContentProps {
  isClubMode?: boolean;
  clubId?: string;
}

export function OfficialsContent({ isClubMode, clubId }: OfficialsContentProps) {
  const { canModify: contextCanModify, userRole } = useTournament();
  const canModify = isClubMode && userRole === 'Club' ? false : contextCanModify; // No club_id on officials yet, so Clubs cannot modify
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [officials, setOfficials] = useState<Official[]>([]);
  
  // View states
  const [viewMode, setViewMode] = useState<'LIST' | 'ALLOCATION'>('LIST');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [tatamiFilter, setTatamiFilter] = useState('ALL');

  // Form states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [selectedOfficialForPhoto, setSelectedOfficialForPhoto] = useState<Official | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState<Official['role']>('Referee');
  const [qualification, setQualification] = useState('');
  const [assignedTatami, setAssignedTatami] = useState('Tatami 1');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<'Active' | 'Inactive'>('Active');
  
  useEffect(() => {
    setMounted(true);
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const list = await db.officials.list();
      const filteredByClub = isClubMode && clubId 
        ? list.filter(o => (o as any).club_id === clubId) 
        : list;
      setOfficials(filteredByClub);
    } catch (err) {
      console.error('Error loading officials:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAddModal = () => {
    setEditingId(null);
    setName('');
    setRole('Referee');
    setQualification('');
    setAssignedTatami('Tatami 1');
    setEmail('');
    setPhone('');
    setStatus('Active');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (off: Official) => {
    setEditingId(off.id);
    setName(off.name);
    setRole(off.role);
    setQualification(off.qualification);
    setAssignedTatami(off.assigned_tatami || 'Tatami 1');
    setEmail(off.email || '');
    setPhone(off.phone || '');
    setStatus(off.status);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !qualification) {
      alert('Please fill in all required fields.');
      return;
    }

    try {
      setLoading(true);
      const payload = {
        name,
        role,
        qualification,
        assigned_tatami: assignedTatami,
        email,
        phone,
        status
      };

      if (editingId) {
        await db.officials.update(editingId, payload);
      } else {
        await db.officials.add(payload);
      }

      setIsModalOpen(false);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to save official.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to remove this official from the tournament roster?')) return;
    try {
      setLoading(true);
      await db.officials.delete(id);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete official.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyDisplayLink = () => {
    const url = `${window.location.origin}/display/officials`;
    navigator.clipboard.writeText(url);
    alert('Display link copied to clipboard!');
  };

  if (!mounted) return null;

  // Filter officials list
  const filteredOfficials = officials.filter((off) => {
    const matchesSearch = off.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      off.qualification.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'ALL' || off.role === roleFilter;
    const matchesTatami = tatamiFilter === 'ALL' || off.assigned_tatami === tatamiFilter;
    return matchesSearch && matchesRole && matchesTatami;
  });

  return (
    <div className="p-6 space-y-6 text-foreground w-full min-h-[calc(100vh-64px)] flex flex-col overflow-y-auto">
      
      {/* Title */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Officials Management</h1>
          <p className="text-sm text-muted-foreground">Register tournament referees, judges, timekeepers, and assign them to active tatami competition areas.</p>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Toggle view modes */}
          <div className="flex items-center bg-secondary p-0.5 rounded-lg border border-border">
            <button
              onClick={() => setViewMode('LIST')}
              className={`p-1.5 rounded-md cursor-pointer transition ${
                viewMode === 'LIST' ? 'bg-card shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              title="List View"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('ALLOCATION')}
              className={`p-1.5 rounded-md cursor-pointer transition ${
                viewMode === 'ALLOCATION' ? 'bg-card shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              title="Tatami Grid View"
            >
              <Grid className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={handleCopyDisplayLink}
            className="px-3 py-2 bg-secondary text-foreground border border-border hover:bg-secondary/80 rounded-lg text-xs font-bold transition shadow-sm cursor-pointer flex items-center gap-1.5"
            title="Copy Public Display Link"
          >
            <Copy className="h-4 w-4 text-muted-foreground" />
            <span className="hidden sm:inline">Copy Display Link</span>
          </button>

          {canModify && (
            <button
              onClick={handleOpenAddModal}
              className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/95 rounded-lg text-xs font-bold transition shadow-sm cursor-pointer flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4 text-white" />
              <span>Add Official</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-card border border-border p-4 rounded-xl shadow-xs shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative w-64">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name, rank..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 bg-secondary border border-border rounded-lg text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          {/* Role filter */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase">Role</span>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-3 py-1.5 bg-secondary border border-border rounded-lg text-xs font-semibold text-foreground focus:outline-none"
            >
              <option value="ALL">All Roles</option>
              <option value="Referee">Referee</option>
              <option value="Judge">Judge</option>
              <option value="Table Official">Table Official</option>
              <option value="Tatami Manager">Tatami Manager</option>
              <option value="Coach">Coach</option>
            </select>
          </div>

          {/* Tatami filter */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase">Tatami Ring</span>
            <select
              value={tatamiFilter}
              onChange={(e) => setTatamiFilter(e.target.value)}
              className="px-3 py-1.5 bg-secondary border border-border rounded-lg text-xs font-semibold text-foreground focus:outline-none"
            >
              <option value="ALL">All Tatamis</option>
              <option value="Tatami 1">Tatami 1</option>
              <option value="Tatami 2">Tatami 2</option>
              <option value="Tatami 3">Tatami 3</option>
            </select>
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
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
        {loading && officials.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-12 text-muted-foreground text-xs font-semibold">
            Loading official roster...
          </div>
        ) : filteredOfficials.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted-foreground text-xs bg-card border border-border rounded-xl space-y-2">
            <ShieldCheck className="h-8 w-8 text-primary/20" />
            <span className="font-bold text-foreground">No Officials Found</span>
            <span>Check filters or add a new referee to the tournament list.</span>
          </div>
        ) : viewMode === 'LIST' ? (
          
          /* VIEW 1: ROSTER LIST TABLE */
          <div className="flex-1 border border-border bg-card rounded-xl overflow-hidden flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-secondary/40 font-bold border-b border-border sticky top-0 z-10 backdrop-blur-xs">
                  <tr>
                    <th className="p-3">Official Name</th>
                    <th className="p-3">Role</th>
                    <th className="p-3">Qualification Level</th>
                    <th className="p-3">Assigned Ring</th>
                    <th className="p-3">Contact Details</th>
                    <th className="p-3 w-24 text-center">Status</th>
                    {canModify && <th className="p-3 w-28 text-center">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredOfficials.map((off) => (
                    <tr key={off.id} className="hover:bg-secondary/25 transition-colors">
                      <td className="p-3 font-semibold text-foreground flex items-center gap-3">
                        <div 
                          className="w-8 h-8 rounded-full bg-secondary/80 border border-border flex items-center justify-center overflow-hidden shrink-0 cursor-pointer hover:border-primary transition"
                          onClick={() => { setSelectedOfficialForPhoto(off); setPhotoModalOpen(true); }}
                          title="Manage Photo"
                        >
                          {off.photo_url ? (
                            <img src={off.photo_url} alt={off.name} className="w-full h-full object-cover" />
                          ) : (
                            <Camera className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </div>
                        {off.name}
                      </td>
                      <td className="p-3">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          off.role === 'Tatami Manager' ? 'bg-purple-500/10 text-purple-500' :
                          off.role === 'Referee' ? 'bg-red-500/10 text-red-500' :
                          off.role === 'Judge' ? 'bg-blue-500/10 text-blue-500' :
                          off.role === 'Coach' ? 'bg-emerald-500/10 text-emerald-500' :
                          'bg-gray-500/10 text-gray-500'
                        }`}>
                          {off.role}
                        </span>
                      </td>
                      <td className="p-3 text-muted-foreground font-semibold">{off.qualification}</td>
                      <td className="p-3 font-bold text-primary">{off.assigned_tatami || 'Unassigned'}</td>
                      <td className="p-3 font-medium text-muted-foreground space-y-0.5">
                        {off.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3 text-gray-400 shrink-0" />
                            <span>{off.email}</span>
                          </span>
                        )}
                        {off.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3 text-gray-400 shrink-0" />
                            <span>{off.phone}</span>
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          off.status === 'Active' 
                            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' 
                            : 'bg-gray-500/10 text-gray-500 border-gray-500/20'
                        }`}>
                          {off.status}
                        </span>
                      </td>
                      {canModify && (
                        <td className="p-3">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => { setSelectedOfficialForPhoto(off); setPhotoModalOpen(true); }}
                              className="p-1 text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10 rounded cursor-pointer"
                              title="Update Photo"
                            >
                              <Camera className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleOpenEditModal(off)}
                              className="p-1 text-muted-foreground hover:text-foreground hover:bg-secondary rounded cursor-pointer"
                              title="Edit official details"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(off.id)}
                              className="p-1 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded cursor-pointer"
                              title="Delete official"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        ) : (
          
          /* VIEW 2: TATAMI RING ALLOCATION GRID */
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {['Tatami 1', 'Tatami 2', 'Tatami 3'].map((ring) => {
                const ringOfficials = filteredOfficials.filter(o => o.assigned_tatami === ring);

                return (
                  <div key={ring} className="bg-card border border-border rounded-xl p-5 shadow-xs flex flex-col space-y-4">
                    <div className="border-b border-border pb-3 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-primary">
                        <MapPin className="h-4.5 w-4.5" />
                        <span className="font-extrabold text-sm uppercase tracking-wider">{ring}</span>
                      </div>
                      <span className="text-[10px] bg-secondary px-2.5 py-1 rounded-md font-bold text-muted-foreground">
                        {ringOfficials.length} assigned
                      </span>
                    </div>

                    <div className="space-y-3 flex-1">
                      {ringOfficials.length === 0 ? (
                        <div className="text-center text-xs text-muted-foreground italic py-8 border border-dashed border-border rounded-xl">
                          No officials assigned to this ring.
                        </div>
                      ) : (
                        ringOfficials.map((off) => (
                          <div 
                            key={off.id}
                            className="p-3 bg-secondary/35 border border-border/60 hover:border-primary/50 transition rounded-xl flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <span className="font-bold text-xs block text-foreground truncate">{off.name}</span>
                              <span className="text-[9px] text-muted-foreground font-semibold uppercase">{off.qualification}</span>
                            </div>
                            <span className={`shrink-0 px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                              off.role === 'Tatami Manager' ? 'bg-purple-500/10 text-purple-500' :
                              off.role === 'Referee' ? 'bg-red-500/10 text-red-500' :
                              off.role === 'Judge' ? 'bg-blue-500/10 text-blue-500' :
                              off.role === 'Coach' ? 'bg-emerald-500/10 text-emerald-500' :
                              'bg-gray-500/10 text-gray-500'
                            }`}>
                              {off.role === 'Table Official' ? 'Table' : off.role === 'Tatami Manager' ? 'Manager' : off.role}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ADD / EDIT DIALOG MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          {/* ... existing modal ... */}
          <div className="bg-card border border-border max-w-md w-full rounded-2xl shadow-xl overflow-hidden flex flex-col">
            
            <div className="p-5 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                <h3 className="font-extrabold text-sm">{editingId ? 'Edit Official' : 'Add New Official'}</h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 hover:bg-secondary rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              
              {/* Name */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Official Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Sensei Haris Ahmad"
                  className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Role & Ring Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Role Selection</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as any)}
                    className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-xs font-semibold text-foreground focus:outline-none"
                  >
                    <option value="Referee">Referee</option>
                    <option value="Judge">Judge</option>
                    <option value="Table Official">Table Official</option>
                    <option value="Tatami Manager">Tatami Manager</option>
                    <option value="Coach">Coach</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Assign Ring</label>
                  <select
                    value={assignedTatami}
                    onChange={(e) => setAssignedTatami(e.target.value)}
                    className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-xs font-semibold text-foreground focus:outline-none"
                  >
                    <option value="Tatami 1">Tatami 1</option>
                    <option value="Tatami 2">Tatami 2</option>
                    <option value="Tatami 3">Tatami 3</option>
                  </select>
                </div>
              </div>

              {/* Qualification */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Qualification Level *</label>
                <input
                  type="text"
                  required
                  value={qualification}
                  onChange={(e) => setQualification(e.target.value)}
                  placeholder="e.g. WKF Referee A, National Judge B"
                  className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Contact grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@email.com"
                    className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Phone Number</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+6012-3456789"
                    className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Status */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Status</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                    <input
                      type="radio"
                      name="status"
                      checked={status === 'Active'}
                      onChange={() => setStatus('Active')}
                      className="text-primary focus:ring-primary"
                    />
                    <span>Active</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                    <input
                      type="radio"
                      name="status"
                      checked={status === 'Inactive'}
                      onChange={() => setStatus('Inactive')}
                      className="text-primary focus:ring-primary"
                    />
                    <span>Inactive</span>
                  </label>
                </div>
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
                  <span>{editingId ? 'Save Changes' : 'Add Official'}</span>
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* Official Photo Modal */}
      {photoModalOpen && selectedOfficialForPhoto && (
        <OfficialPhotoModal
          official={selectedOfficialForPhoto}
          onClose={() => {
            setPhotoModalOpen(false);
            setSelectedOfficialForPhoto(null);
          }}
          onSaved={(updated) => {
            setOfficials(prev => prev.map(o => o.id === updated.id ? updated : o));
          }}
        />
      )}

    </div>
  );
}

export default function OfficialsPage() {
  return <OfficialsContent />;
}
