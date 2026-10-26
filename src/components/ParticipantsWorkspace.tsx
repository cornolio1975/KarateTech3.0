'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useTournament } from '@/context/TournamentContext';
import { db, describeError } from '@/db/dbClient';
import { Participant, Club, Country, Category, Coach, Bout, isKataCategory, isKumiteCategory } from '@/db/types';
import AddParticipantModal from '@/components/AddParticipantModal';
import EditParticipantDrawer from '@/components/EditParticipantDrawer';
import ImportModal from '@/components/ImportModal';
import { buildParticipantCsv } from '@/utils/participantCsv';
import { 
  Check, Eye, Trash2, Edit2, ArrowUpDown, ChevronLeft, 
  ChevronRight, HelpCircle, Columns, Download, Printer, UserCheck, 
  Search, SlidersHorizontal, Trophy, Award, BadgeAlert, Plus, CheckSquare, ListFilter, X, RefreshCw, Upload, Move, AlertCircle
} from 'lucide-react';

export interface ParticipantsContentProps {
  isClubMode?: boolean;
  clubId?: string;
}

export function ParticipantsContent({ isClubMode, clubId }: ParticipantsContentProps) {
  const {
    searchQuery,
    setSearchQuery,
    selectedIds,
    setSelectedIds,
    isAddOpen,
    setIsAddOpen,
    refreshKey,
    triggerRefresh,
    canModify: contextCanModify,
    userEmail,
    userRole
  } = useTournament();

  const canModify = isClubMode && userRole === 'Club' ? true : contextCanModify;

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isClubStatsOpen, setIsClubStatsOpen] = useState(false);
  const [isReassignOpen, setIsReassignOpen] = useState(false);
  const [reassignPartId, setReassignPartId] = useState('');
  const [reassignTargetCatId, setReassignTargetCatId] = useState('');
  const [reassignEligibility, setReassignEligibility] = useState<{ eligible: boolean; reason: string } | null>(null);
  
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [mappings, setMappings] = useState<any[]>([]);
  const [bouts, setBouts] = useState<Bout[]>([]);
  
  // Active states
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);

  const tableContainerRef = useRef<HTMLDivElement>(null);

  const scrollTable = (direction: 'left' | 'right') => {
    if (tableContainerRef.current) {
      const scrollAmount = 350;
      tableContainerRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
    }
  };
  const { filters, setFilters } = useTournament();
  const [activeCategoryTab, setActiveCategoryTab] = useState<'ALL' | 'KUMITE' | 'KATA' | 'CONFIRMED'>('ALL');
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [disciplineFilter, setDisciplineFilter] = useState<'ALL' | 'KUMITE' | 'KATA'>(filters.discipline);
  
  // Sync with global discipline filter
  useEffect(() => {
    if (filters.discipline !== disciplineFilter) {
      setDisciplineFilter(filters.discipline);
      if (filters.discipline !== 'ALL') {
        setActiveCategoryTab(filters.discipline);
      } else {
        setActiveCategoryTab('ALL');
      }
      setSelectedCatId(null);
      setCurrentPage(1);
    }
  }, [filters.discipline]);

  // Custom local filter states matching KumiteTechnology demo UI
  const [statusFilter, setStatusFilter] = useState<string>('Active'); // Active / Inactive / All
  const [schoolFilter, setSchoolFilter] = useState<string>(''); // maps to Club
  const [countryFilter, setCountryFilter] = useState<string>('');
  const [regionFilter, setRegionFilter] = useState<string>('');
  const [cityFilter, setCityFilter] = useState<string>('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50); // Matches KT default "50"

  // Sorting
  const [sortField, setSortField] = useState<keyof Participant>('dob');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [pList, cList, cntList, catList, coList, pcList, bList] = await Promise.all([
        db.participants.list(),
        db.clubs.list(),
        db.countries.list(),
        db.categories.list(),
        db.coaches.list(),
        db.participantCategories.list(),
        db.bouts.list()
      ]);
      const seen = new Set<string>();
      const uniqueParticipants = (pList || []).filter(p => {
        if (!p || !p.id || seen.has(p.id)) return false;
        // In club mode, only load participants for this club
        if (isClubMode && clubId && p.club_id !== clubId) return false;
        seen.add(p.id);
        return true;
      });
      setParticipants(uniqueParticipants);
      setClubs(cList);
      setCountries(cntList);
      setCategories(catList);
      setCoaches(coList);
      setMappings(pcList);
      setBouts(bList);
    } catch (e) {
      console.error('Error loading participants data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (mounted) {
      loadData();
    }
  }, [mounted, refreshKey]);

  // Reassign Participants: live eligibility preview against the target category's rules
  useEffect(() => {
    if (!reassignPartId || !reassignTargetCatId) {
      setReassignEligibility(null);
      return;
    }
    const p = participants.find(part => part.id === reassignPartId);
    const c = categories.find(cat => cat.id === reassignTargetCatId);
    if (!p || !c) return;

    const dob = new Date(p.dob);
    const today = new Date();
    const age = today.getFullYear() - dob.getFullYear();
    const ageOk = age >= c.min_age && age <= c.max_age;
    const weightOk = p.weight >= c.min_weight && p.weight <= c.max_weight;
    const genderOk = c.gender === 'Mixed' || c.gender === p.gender;

    if (ageOk && weightOk && genderOk) {
      setReassignEligibility({ eligible: true, reason: `Eligible: matches rules (Age: ${age} yr, Weight: ${p.weight}kg, Gender: ${p.gender})` });
    } else {
      const mismatches: string[] = [];
      if (!ageOk) mismatches.push(`Age: ${age} yr (expected ${c.min_age}-${c.max_age})`);
      if (!weightOk) mismatches.push(`Weight: ${p.weight}kg (expected ${c.min_weight}-${c.max_weight}kg)`);
      if (!genderOk) mismatches.push(`Gender: ${p.gender} (expected ${c.gender})`);
      setReassignEligibility({ eligible: false, reason: `Ineligible: ${mismatches.join(', ')}. Manual override will bypass auto-rules.` });
    }
  }, [reassignPartId, reassignTargetCatId, participants, categories]);

  if (!mounted) return null;

  // Sorting Handler
  const handleSort = (field: keyof Participant) => {
    const isAsc = sortField === field && sortOrder === 'asc';
    setSortField(field);
    setSortOrder(isAsc ? 'desc' : 'asc');
  };

  // Helper age calculation
  const getAge = (dobString: string) => {
    if (!dobString) return 0;
    const dob = new Date(dobString);
    const today = new Date();
    return today.getFullYear() - dob.getFullYear();
  };

  // Helper: split full_name into first/last (Malaysian: last word = last name)
  const splitName = (fullName: string): { firstName: string; lastName: string } => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return { firstName: parts[0], lastName: '' };
    const lastName = parts[parts.length - 1];
    const firstName = parts.slice(0, parts.length - 1).join(' ');
    return { firstName, lastName };
  };

  // Get count of participants currently in a category
  const getCategoryCountInfo = (catId: string) => {
    const matchedParts = mappings.filter((m: any) => m.category_id === catId).map((m: any) => m.participant_id);
    const activeInCat = participants.filter(p => matchedParts.includes(p.id));
    
    const total = activeInCat.length;
    const confirmed = activeInCat.filter(p => p.status === 'Confirmed' || p.status === 'Checked In').length;
    
    return { confirmed, total };
  };

  // Whether a category already has bouts generated (used/scheduled/completed) — used to warn before reassignment
  const isCategoryInCompetition = (catId: string) => bouts.some(b => b.category_id === catId);

  const handleReassignSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reassignPartId || !reassignTargetCatId) return;

    const currentCatId = mappings.find((m: any) => m.participant_id === reassignPartId)?.category_id;
    const involvesCompetitionData = isCategoryInCompetition(reassignTargetCatId) || (currentCatId && isCategoryInCompetition(currentCatId));
    if (involvesCompetitionData) {
      const proceed = confirm('This participant or category is already being used by competition data (brackets, schedules, or matches). Reassigning may affect eligibility, brackets, or scheduling. Continue?');
      if (!proceed) return;
    }

    try {
      setLoading(true);
      await db.participants.assignCategoryManually(reassignPartId, reassignTargetCatId, 'Admin');
      alert('Participant reassigned successfully.');
      setIsReassignOpen(false);
      setReassignPartId('');
      setReassignTargetCatId('');
      setReassignEligibility(null);
      triggerRefresh();
    } catch (err: any) {
      alert(err?.message || describeError(err));
    } finally {
      setLoading(false);
    }
  };

  // Clears every participant's category mapping (including manual overrides) and recomputes
  // fresh matches from current category rules, for every active participant.
  const handleForcedAutoReassign = async () => {
    if (participants.length === 0) {
      alert('No participants to reassign.');
      return;
    }
    const involvesCompetitionData = bouts.length > 0;
    const warningSuffix = involvesCompetitionData
      ? ' Some categories already have brackets/matches — reassigning may affect participant eligibility, brackets, or scheduling.'
      : '';
    if (!confirm(`This will remove ALL current category assignments (including manual overrides) for ${participants.length} participant(s) and re-run automatic category matching.${warningSuffix} Continue?`)) {
      return;
    }

    try {
      setLoading(true);
      let reassignedCount = 0;
      const errors: string[] = [];
      for (const p of participants) {
        try {
          await db.participants.autoAssignCategory(p);
          reassignedCount++;
        } catch (err: any) {
          errors.push(`${p.full_name}: ${err?.message || describeError(err)}`);
        }
      }
      if (errors.length > 0) {
        alert(`Forced auto reassignment finished with ${errors.length} error(s):\n${errors.join('\n')}`);
      } else {
        alert(`Forced auto reassignment completed for ${reassignedCount} participant(s).`);
      }
      triggerRefresh();
      await loadData();
    } catch (err: any) {
      alert(err?.message || describeError(err));
    } finally {
      setLoading(false);
    }
  };

  // Bulk actions checklist selection helper
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(filteredParticipants.map(p => p.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedIds([...selectedIds, id]);
    } else {
      setSelectedIds(selectedIds.filter(val => val !== id));
    }
  };

  // Quick Action: Activate All (Mark Confirmed & Auto-Assign Categories)
  const handleActivateAll = async () => {
    if (filteredParticipants.length === 0) return;
    if (confirm(`Confirm and activate all ${filteredParticipants.length} matching participants and auto-assign their categories?`)) {
      try {
        setLoading(true);
        for (const p of filteredParticipants) {
          await db.participants.update(p.id, { status: 'Confirmed' }, 'Admin Bulk Operation');
          await db.participants.autoAssignCategory(p);
        }
        alert(`Activated and auto-assigned categories for ${filteredParticipants.length} participants.`);
        triggerRefresh();
        loadData();
      } catch (err: any) {
        alert(describeError(err));
      } finally {
        setLoading(false);
      }
    }
  };

  // Quick Action: Deactivate All (Mark Pending)
  const handleDeactivateAll = async () => {
    if (filteredParticipants.length === 0) return;
    if (confirm(`Reset status to pending for all ${filteredParticipants.length} matching participants?`)) {
      try {
        for (const p of filteredParticipants) {
          await db.participants.update(p.id, { status: 'Pending' }, 'Admin Bulk Operation');
        }
        alert('All matching participants status set to pending.');
        triggerRefresh();
      } catch (err: any) {
        alert(describeError(err));
      }
    }
  };

  const getParticipantCategoryInfo = (participant: Participant) => {
    const mappedCategories = mappings
      .filter((m: any) => m.participant_id === participant.id)
      .map((m: any) => categories.find((c: Category) => c.id === m.category_id))
      .filter(Boolean) as Category[];

    const kumiteCat = mappedCategories.find(c => isKumiteCategory(c));
    const kataCat = mappedCategories.find(c => isKataCategory(c));

    return {
      kumiteCatName: kumiteCat?.name || '',
      kataCatName: kataCat?.name || '',
      isKumite: Boolean(participant.isKumite || kumiteCat),
      isKata: Boolean(participant.isKata || kataCat),
    };
  };

  const escapeCsv = (value: string | number | undefined | null) => {
    const text = String(value ?? '').replace(/\r?\n/g, ' ');
    return `"${text.replace(/"/g, '""')}"`;
  };

  const handleExportCSV = () => {
    // Exact database field export for a lossless Export -> Import round trip
    const categoryLookup = (participantId: string) => {
      const partMappings = mappings.filter((m: any) => m.participant_id === participantId);
      const kumite = partMappings.map((m: any) => categories.find(c => c.id === m.category_id)).find(c => c && isKumiteCategory(c));
      const kata = partMappings.map((m: any) => categories.find(c => c.id === m.category_id)).find(c => c && isKataCategory(c));
      return { kumite: kumite?.id, kata: kata?.id };
    };

    const csvBody = buildParticipantCsv(filteredParticipants, categoryLookup);
    const blob = new Blob(['\uFEFF' + csvBody], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `KT_Participants_Export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Delete the ${selectedIds.length} selected participant(s)?`)) return;

    try {
      setLoading(true);
      for (const id of selectedIds) {
        await db.participants.delete(id, userEmail || 'User');
      }
      setSelectedIds([]);
      triggerRefresh();
      await loadData();
      alert(`Successfully deleted ${selectedIds.length} participant(s).`);
    } catch (err: any) {
      alert(`Failed to delete selected participants: ${describeError(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePrintParticipants = () => {
    const printWindow = window.open('', '_blank', 'width=1200,height=900');
    if (!printWindow) {
      alert('Please allow pop-ups to print the participants list.');
      return;
    }

    const rows = filteredParticipants.map((p, idx) => {
      const clubName = clubs.find(c => c.id === p.club_id)?.name || 'Independent';
      const categoryInfo = getParticipantCategoryInfo(p);
      return `
        <tr>
          <td>${idx + 1}</td>
          <td>${p.registration_no}</td>
          <td>${p.full_name}</td>
          <td>${p.gender}</td>
          <td>${getAge(p.dob)}</td>
          <td>${p.dob}</td>
          <td>${p.weight}</td>
          <td>${p.height}</td>
          <td>${clubName}</td>
          <td>${categoryInfo.isKumite ? '☑' : '☐'}</td>
          <td>${categoryInfo.isKata ? '☑' : '☐'}</td>
          <td>${categoryInfo.kumiteCatName}</td>
          <td>${categoryInfo.kataCatName}</td>
          <td>${p.email || ''}</td>
          <td>${p.phone || ''}</td>
          <td>${p.passport_ic || ''}</td>
        </tr>
      `;
    }).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>Participants Export</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; color: #111827; }
            h1 { font-size: 24px; margin-bottom: 12px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; }
            th { background: #f3f4f6; }
            tr:nth-child(even) { background: #fafafa; }
            @media print { body { margin: 0; } }
          </style>
        </head>
        <body>
          <h1>Participants List</h1>
          <table>
            <thead>
              <tr>
                <th>No</th>
                <th>Registration No</th>
                <th>Full Name</th>
                <th>Gender</th>
                <th>Age</th>
                <th>Date of Birth</th>
                <th>Weight</th>
                <th>Height</th>
                <th>School / Club</th>
                <th>Kumite</th>
                <th>Kata</th>
                <th>Kumite Category</th>
                <th>Kata Category</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Passport / IC</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  };

  // --- Filtering logic matching KT demo ---
  const filteredParticipants = participants.filter((p) => {
    // 1. Search Query (Name / Reg No)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!p.full_name.toLowerCase().includes(q) && !p.registration_no.toLowerCase().includes(q)) {
        return false;
      }
    }

    // 2. Left side-panel Category filter
    if (selectedCatId) {
      const isAssigned = mappings.some((m: any) => m.participant_id === p.id && m.category_id === selectedCatId);
      if (!isAssigned) return false;
    }

    // 3. Category Tab filter (Confirmed only vs ALL)
    if (activeCategoryTab === 'CONFIRMED' && p.status !== 'Confirmed' && p.status !== 'Checked In') {
      return false;
    }

    // 4. Active / Inactive filter dropdown
    if (statusFilter === 'Active' && p.status === 'Cancelled') return false;
    if (statusFilter === 'Inactive' && p.status !== 'Cancelled') return false;

    // 5. School/Club filter
    if (isClubMode && clubId) {
      if (p.club_id !== clubId) return false;
    } else if (schoolFilter && p.club_id !== schoolFilter) {
      return false;
    }

    // 6. Country filter
    if (countryFilter && p.nationality_code !== countryFilter) return false;

    return true;
  });

  // Sort logic
  const sortedParticipants = [...filteredParticipants].sort((a, b) => {
    let valA = a[sortField];
    let valB = b[sortField];

    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    if (valA === undefined || valA === null) return 1;
    if (valB === undefined || valB === null) return -1;

    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  // Pagination bounds
  const totalItems = sortedParticipants.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const paginatedParticipants = sortedParticipants.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // Filtered categories display list
  const displayCategories = categories.filter(c => {
    if (activeCategoryTab === 'CONFIRMED') {
      const { confirmed } = getCategoryCountInfo(c.id);
      if (confirmed === 0) return false;
    }
    if (disciplineFilter === 'KUMITE') return isKumiteCategory(c);
    if (disciplineFilter === 'KATA') return isKataCategory(c);
    return true;
  }).sort((a, b) => {
    // 1. Sort by Age (low to high)
    if (a.min_age !== b.min_age) return a.min_age - b.min_age;
    if (a.max_age !== b.max_age) return a.max_age - b.max_age;
    
    // 2. Sort by Gender
    if (a.gender !== b.gender) {
      const order = { 'Male': 1, 'Female': 2, 'Mixed': 3 };
      const gA = order[a.gender as keyof typeof order] || 99;
      const gB = order[b.gender as keyof typeof order] || 99;
      if (gA !== gB) return gA - gB;
      return a.gender.localeCompare(b.gender);
    }
    
    // 3. Sort by Weight
    if (a.min_weight !== b.min_weight) return a.min_weight - b.min_weight;
    if (a.max_weight !== b.max_weight) return a.max_weight - b.max_weight;
    
    // 4. Fallback to name
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col lg:flex-row h-auto min-h-[calc(100vh-64px)] w-full text-foreground bg-background overflow-y-auto">
      
      {/* ======================================================== */}
      {/* LEFT COLUMN: CATEGORY TREE SIDE-PANEL                     */}
      {/* ======================================================== */}
      {!isClubMode && (
        <div className="w-full lg:w-72 bg-card border-b lg:border-b-0 lg:border-r border-border h-48 lg:h-full flex flex-col shrink-0">
          
          {/* Categories Tab selectors */}
          <div className="grid grid-cols-4 border-b border-border text-[10px] font-bold shrink-0 bg-secondary/10">
            <button
              onClick={() => { setActiveCategoryTab('ALL'); setDisciplineFilter('ALL'); setSelectedCatId(null); }}
              className={`py-2.5 text-center transition-colors border-b-2 cursor-pointer ${
                activeCategoryTab === 'ALL' && disciplineFilter === 'ALL' && !selectedCatId
                  ? 'border-primary text-foreground bg-card font-extrabold'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              ALL
            </button>
            <button
              onClick={() => { setActiveCategoryTab('KUMITE'); setDisciplineFilter('KUMITE'); setSelectedCatId(null); }}
              className={`py-2.5 text-center transition-colors border-b-2 cursor-pointer ${
                disciplineFilter === 'KUMITE'
                  ? 'border-yellow-400 text-yellow-400 font-extrabold bg-card'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              KUMITE
            </button>
            <button
              onClick={() => { setActiveCategoryTab('KATA'); setDisciplineFilter('KATA'); setSelectedCatId(null); }}
              className={`py-2.5 text-center transition-colors border-b-2 cursor-pointer ${
                disciplineFilter === 'KATA'
                  ? 'border-blue-400 text-blue-400 font-extrabold bg-card'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              KATA
            </button>
            <button
              onClick={() => { setActiveCategoryTab('CONFIRMED'); setDisciplineFilter('ALL'); setSelectedCatId(null); }}
              className={`py-2.5 text-center transition-colors border-b-2 flex items-center justify-center gap-0.5 cursor-pointer ${
                activeCategoryTab === 'CONFIRMED'
                  ? 'border-primary text-foreground bg-card font-extrabold'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Check className="h-3 w-3" />
              <span>CONF</span>
            </button>
          </div>

          {/* Controller Dropdown & Discipline Filter */}
          <div className="p-3 border-b border-border space-y-2.5 shrink-0">
            {!isClubMode && (
              <div>
                <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">Discipline Filter</label>
                <select 
                  value={disciplineFilter}
                  onChange={e => {
                    const val = e.target.value as 'ALL' | 'KUMITE' | 'KATA';
                    setDisciplineFilter(val);
                    setFilters(prev => ({ ...prev, discipline: val }));
                    setActiveCategoryTab(val);
                    setSelectedCatId(null);
                    setCurrentPage(1);
                  }}
                  className="w-full px-2.5 py-1.5 bg-secondary border border-border rounded-lg text-xs font-semibold text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="ALL">All Disciplines (Kumite & Kata)</option>
                  <option value="KUMITE">Kumite Categories ({categories.filter(isKumiteCategory).length})</option>
                  <option value="KATA">Kata Categories ({categories.filter(isKataCategory).length})</option>
                </select>
              </div>
            )}

            {!isClubMode && (
              <div>
                <label className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block mb-1">Quick Select Category</label>
                <select 
                  value={selectedCatId || ''}
                  onChange={e => {
                    setSelectedCatId(e.target.value || null);
                    setCurrentPage(1);
                  }}
                  className="w-full px-2.5 py-1.5 bg-secondary border border-border rounded-lg text-xs font-semibold text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="">All Categories ({displayCategories.length})</option>
                  {displayCategories.map(c => (
                    <option key={c.id} value={c.id}>
                      {isKataCategory(c) ? '🏆 [KATA] ' : '🥋 [KUMITE] '}{c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-center text-[10px] font-bold text-muted-foreground uppercase bg-secondary/30 p-2 rounded-lg border border-border">
              <div>
                <span className="block text-xs font-extrabold text-foreground">{displayCategories.length}</span>
                <span>Categories</span>
              </div>
              <div>
                <span className="block text-xs font-extrabold text-foreground">
                  {displayCategories.filter(c => getCategoryCountInfo(c.id).total === 0).length}
                </span>
                <span>Empty</span>
              </div>
            </div>
          </div>

          {/* Category List */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-1 bg-secondary/5">
            {displayCategories.map(c => {
              const { confirmed, total } = getCategoryCountInfo(c.id);
              const isSelected = selectedCatId === c.id;

              return (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedCatId(c.id);
                    setCurrentPage(1);
                  }}
                  className={`w-full text-left p-2.5 rounded-lg text-xs font-medium transition-all duration-150 flex items-center justify-between border cursor-pointer ${
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-card text-muted-foreground border-border hover:bg-secondary hover:text-foreground'
                  }`}
                >
                  <span className="truncate pr-2 font-semibold">{c.name}</span>
                  <span className="text-[10px] shrink-0 font-bold bg-secondary/15 px-1.5 py-0.5 rounded-md">
                    ({confirmed}/{total})
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* RIGHT COLUMN: MAIN TABLE & FILTERS PANEL                  */}
      {/* ======================================================== */}
      <div className="flex-1 min-w-0 bg-background p-4 lg:p-6 space-y-4 flex flex-col h-auto lg:h-full lg:overflow-y-auto lg:overflow-x-hidden">
        
        {/* Title Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div>
            <h2 className="text-xl font-extrabold tracking-tight">Participants</h2>
            <p className="text-xs text-muted-foreground">Manage status, search school/club squads, and verify weights.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {canModify && (
              <button
                onClick={() => setIsClubStatsOpen(true)}
                className="px-4 py-2 bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 border border-indigo-500/20 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer transition-colors"
                title="View club participant assignment statistics"
              >
                <Award className="h-3.5 w-3.5" />
                <span>Club Stats</span>
              </button>
            )}
            {canModify && (
              <button
                onClick={() => setIsReassignOpen(true)}
                className="px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer transition-colors"
                title="Move a participant to a different category"
              >
                <Move className="h-3.5 w-3.5" />
                <span>Reassign Participants</span>
              </button>
            )}
            {canModify && (
              <button
                onClick={handleForcedAutoReassign}
                className="px-4 py-2 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer transition-colors"
                title="Remove all current category assignments (including manual overrides) and re-run automatic category matching for every participant"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Forced Auto Reassign</span>
              </button>
            )}
            {canModify && (
              <button
                onClick={() => setIsImportOpen(true)}
                className="px-4 py-2 bg-secondary border border-border hover:bg-secondary/80 text-foreground rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Import CSV</span>
              </button>
            )}
            {canModify && (
              <button
                onClick={() => setIsClearConfirmOpen(true)}
                className="px-4 py-2 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 text-red-500 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear All</span>
              </button>
            )}
            {canModify && (
              <button
                onClick={() => setIsAddOpen(true)}
                className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/95 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="h-4.5 w-4.5" />
                <span>Add Participant</span>
              </button>
            )}
          </div>
        </div>

        {/* Filters Panel (KumiteTechnology demo structure) */}
        <div className="bg-card border border-border p-4 rounded-xl shadow-xs grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5 shrink-0">
          
          {/* Search box */}
          <div className="space-y-1">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">Search</span>
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Name / Reg No"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-secondary border border-border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
              />
            </div>
          </div>

          {/* Active / Inactive */}
          <div className="space-y-1">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">Active / Inactive</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-1.5 bg-secondary border border-border rounded-lg text-xs focus:outline-none text-foreground"
            >
              <option value="Active">Active Registrations</option>
              <option value="Inactive">Cancelled / Bin</option>
              <option value="All">All Dossiers</option>
            </select>
          </div>

          {/* School (Clubs) */}
          {!isClubMode && (
            <div className="space-y-1">
              <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">School / Club</span>
              <select
                value={schoolFilter}
                onChange={(e) => setSchoolFilter(e.target.value)}
                className="w-full px-3 py-1.5 bg-secondary border border-border rounded-lg text-xs focus:outline-none text-foreground"
              >
                <option value="">All Schools</option>
                {clubs.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Country */}
          <div className="space-y-1">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">Country</span>
            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              className="w-full px-3 py-1.5 bg-secondary border border-border rounded-lg text-xs focus:outline-none text-foreground"
            >
              <option value="">All Countries</option>
              {countries.map(c => (
                <option key={c.code} value={c.code}>{c.flag_emoji} {c.name}</option>
              ))}
            </select>
          </div>

          {/* Region */}
          <div className="space-y-1">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">Region</span>
            <input
              type="text"
              placeholder="All Regions"
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="w-full px-3 py-1.5 bg-secondary border border-border rounded-lg text-xs focus:outline-none text-foreground"
            />
          </div>

          {/* City */}
          <div className="space-y-1">
            <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider block">City</span>
            <input
              type="text"
              placeholder="All Cities"
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              className="w-full px-3 py-1.5 bg-secondary border border-border rounded-lg text-xs focus:outline-none text-foreground"
            />
          </div>
        </div>

        {/* Action Button toolbar (KumiteTechnology demo style) */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-secondary/20 border border-border px-4 py-2.5 rounded-xl shrink-0">
          {canModify && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleActivateAll}
                disabled={filteredParticipants.length === 0}
                className="px-3 py-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Check className="h-4 w-4" /> Activate All
              </button>
              <button
                onClick={handleDeactivateAll}
                disabled={filteredParticipants.length === 0}
                className="px-3 py-1.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <X className="h-4 w-4" /> Deactivate All
              </button>
              <button
                onClick={() => alert('Recalculating physical index coefficients (weight/height) for seed rankings.')}
                className="px-3 py-1.5 bg-card hover:bg-secondary text-muted-foreground hover:text-foreground border border-border text-xs font-medium rounded-lg cursor-pointer"
              >
                Setup Physical Indexes
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            {/* Scroll Left / Right controls */}
            <div className="flex items-center gap-1 bg-card border border-border p-1 rounded-lg shadow-2xs">
              <button
                type="button"
                onClick={() => scrollTable('left')}
                className="px-2 py-1 bg-secondary hover:bg-primary hover:text-primary-foreground text-muted-foreground font-bold text-xs rounded transition-colors flex items-center gap-1 cursor-pointer"
                title="Scroll Table Left"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Left</span>
              </button>
              <span className="text-[10px] font-extrabold text-muted-foreground uppercase px-1">Scroll</span>
              <button
                type="button"
                onClick={() => scrollTable('right')}
                className="px-2 py-1 bg-secondary hover:bg-primary hover:text-primary-foreground text-muted-foreground font-bold text-xs rounded transition-colors flex items-center gap-1 cursor-pointer"
                title="Scroll Table Right"
              >
                <span>Right</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              onClick={handlePrintParticipants}
              disabled={filteredParticipants.length === 0}
              className="px-3 py-1.5 bg-indigo-500 text-white hover:bg-indigo-600 text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <Printer className="h-4 w-4" /> Print
            </button>
            {canModify && (
              <button
                onClick={handleDeleteSelected}
                disabled={selectedIds.length === 0 || loading}
                className="px-3 py-1.5 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/15 text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> Delete Selected
              </button>
            )}
            <button
              onClick={handleExportCSV}
              disabled={filteredParticipants.length === 0}
              className="px-3 py-1.5 bg-primary text-primary-foreground hover:bg-primary/95 text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </div>
        </div>

        {/* Participant Data Table (Split layout right side) */}
        <div className="flex-1 border border-border bg-card rounded-xl shadow-xs overflow-hidden flex flex-col min-w-0">
          <div ref={tableContainerRef} className="flex-1 overflow-x-auto overflow-y-auto scroll-smooth">
            <table className="w-full min-w-[1200px] text-left border-collapse text-xs">
              <thead className="bg-secondary/40 sticky top-0 border-b border-border z-10">
                <tr>
                  <th className="p-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={filteredParticipants.length > 0 && selectedIds.length === filteredParticipants.length}
                      onChange={handleSelectAll}
                      className="rounded border-border text-primary"
                    />
                  </th>
                  <th className="p-3 w-12 font-bold text-muted-foreground text-center">No</th>
                  <th className="p-3 w-32 font-bold text-muted-foreground cursor-pointer select-none" onClick={() => handleSort('registration_no')}>
                    <div className="flex items-center gap-1">Reg No <ArrowUpDown className="h-3 w-3" /></div>
                  </th>
                  <th className="p-3 w-40 font-bold text-muted-foreground cursor-pointer select-none" onClick={() => handleSort('full_name')}>
                    <div className="flex items-center gap-1">First Name <ArrowUpDown className="h-3 w-3" /></div>
                  </th>
                  <th className="p-3 w-36 font-bold text-muted-foreground cursor-pointer select-none" onClick={() => handleSort('full_name')}>
                    <div className="flex items-center gap-1">Last Name <ArrowUpDown className="h-3 w-3" /></div>
                  </th>
                  <th className="p-3 w-20 font-bold text-muted-foreground text-center">Kumite</th>
                  <th className="p-3 w-20 font-bold text-muted-foreground text-center">Kata</th>
                  <th className="p-3 w-40 font-bold text-muted-foreground">Kumite Category</th>
                  <th className="p-3 w-40 font-bold text-muted-foreground">Kata Category</th>
                  <th className="p-3 w-28 font-bold text-muted-foreground">Date of Birth</th>
                  <th className="p-3 w-16 font-bold text-muted-foreground cursor-pointer select-none" onClick={() => handleSort('dob')}>
                    <div className="flex items-center gap-1">Age <ArrowUpDown className="h-3 w-3" /></div>
                  </th>
                  <th className="p-3 w-20 font-bold text-muted-foreground">Weight</th>
                  <th className="p-3 w-36 font-bold text-muted-foreground">School / Club</th>
                  {canModify && <th className="p-3 w-24 font-bold text-muted-foreground text-center">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {loading ? (
                  <tr>
                    <td colSpan={14} className="text-center py-12 text-xs text-muted-foreground">
                      <div className="flex items-center justify-center gap-2">
                        <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                        <span>Loading athlete records...</span>
                      </div>
                    </td>
                  </tr>
                ) : paginatedParticipants.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="text-center py-12 text-xs text-muted-foreground">
                      No participants match the selected filter/search parameters.
                    </td>
                  </tr>
                ) : (
                  paginatedParticipants.map((p, idx) => {
                    const isChecked = selectedIds.includes(p.id);
                    const clubName = clubs.find(c => c.id === p.club_id)?.name || 'Independent';
                    
                    // Category Mapping client-side lookup
                    const pMappings = mappings.filter((m: any) => m.participant_id === p.id);
                    const assignedCats = pMappings.map(m => categories.find(c => c.id === m.category_id)).filter(Boolean) as Category[];
                    const kumiteCat = assignedCats.find(c => isKumiteCategory(c));
                    const kataCat = assignedCats.find(c => isKataCategory(c));

                    return (
                      <tr
                        key={`${p.id}-${idx}`}
                        onClick={() => setSelectedPartId(p.id)}
                        className={`hover:bg-secondary/40 transition-colors cursor-pointer select-none ${
                          isChecked ? 'bg-secondary/20' : ''
                        }`}
                      >
                        <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => handleSelectOne(p.id, e.target.checked)}
                            className="rounded border-border text-primary"
                          />
                        </td>
                        <td className="p-3 text-center text-muted-foreground font-semibold">
                          {(currentPage - 1) * pageSize + idx + 1}.
                        </td>
                        <td className="p-3 font-mono font-medium text-foreground">{p.registration_no}</td>
                        <td className="p-3">
                          {/* First Name cell */}
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full overflow-hidden bg-primary/10 text-primary border border-border flex items-center justify-center font-bold uppercase shrink-0 text-[10px]">
                              {p.photo_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={p.photo_url} alt="Profile" className="w-full h-full object-cover" />
                              ) : (
                                p.full_name.substring(0, 2)
                              )}
                            </div>
                            <div>
                              <span className="font-bold text-foreground block">{splitName(p.full_name).firstName || p.full_name}</span>
                              <span className="text-[10px] text-muted-foreground block font-medium">{p.gender}</span>
                            </div>
                            {p.status === 'Confirmed' || p.status === 'Checked In' ? (
                              <Check className="h-4 w-4 text-emerald-500 bg-emerald-500/10 p-0.5 rounded-full shrink-0" />
                            ) : null}
                          </div>
                        </td>
                        <td className="p-3">
                          {/* Last Name cell */}
                          <span className="font-semibold text-foreground">{splitName(p.full_name).lastName}</span>
                        </td>
                        <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <input 
                            type="checkbox" 
                            checked={p.isKumite || false}
                            onChange={async (e) => {
                              const checked = e.target.checked;
                              const updated = { ...p, isKumite: checked };
                              await db.participants.update(p.id, { isKumite: checked }, 'Inline Edit');
                              await db.participants.autoAssignCategory(updated);
                              triggerRefresh();
                              await loadData();
                            }}
                            className="rounded border-border text-primary cursor-pointer accent-primary"
                          />
                        </td>
                        <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <input 
                            type="checkbox" 
                            checked={p.isKata || false}
                            onChange={async (e) => {
                              const checked = e.target.checked;
                              const updated = { ...p, isKata: checked };
                              await db.participants.update(p.id, { isKata: checked }, 'Inline Edit');
                              await db.participants.autoAssignCategory(updated);
                              triggerRefresh();
                              await loadData();
                            }}
                            className="rounded border-border text-primary cursor-pointer accent-primary"
                          />
                        </td>
                        <td className="p-3 font-semibold text-primary hover:underline">
                          {kumiteCat ? kumiteCat.name : <span className="text-muted-foreground/40 font-normal">—</span>}
                        </td>
                        <td className="p-3 font-semibold text-primary hover:underline">
                          {kataCat ? kataCat.name : <span className="text-muted-foreground/40 font-normal">—</span>}
                        </td>
                        <td className="p-3 text-muted-foreground font-mono">{p.dob}</td>
                        <td className="p-3 text-muted-foreground font-semibold font-mono">{getAge(p.dob)}</td>
                        <td className="p-3 text-muted-foreground font-mono">{p.weight} kg</td>
                        <td className="p-3 text-muted-foreground font-semibold truncate max-w-[130px]">{clubName}</td>
                        {canModify && (
                          <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => setSelectedPartId(p.id)}
                                className="p-1 text-muted-foreground hover:bg-secondary rounded-md cursor-pointer"
                                title="Edit Detail"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (confirm('Delete this athlete record?')) {
                                    await db.participants.delete(p.id, 'Admin Operations');
                                    triggerRefresh();
                                  }
                                }}
                                className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-md cursor-pointer"
                                title="Delete Record"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer Navigation (KumiteTechnology style pagination) */}
          <div className="p-4 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground bg-secondary/15 shrink-0 select-none">
            <div className="flex items-center gap-2">
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(parseInt(e.target.value)); setCurrentPage(1); }}
                className="bg-card border border-border rounded-md px-2 py-1 font-semibold text-foreground focus:outline-none"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
            
            <div className="flex items-center gap-4">
              <span className="font-medium">
                {(currentPage - 1) * pageSize + 1}-{Math.min(totalItems, currentPage * pageSize)} of {totalItems}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 border border-border bg-card rounded-lg hover:text-foreground cursor-pointer disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1.5 border border-border bg-card rounded-lg hover:text-foreground cursor-pointer disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* Add Participant Modal */}
      {isAddOpen && <AddParticipantModal fixedClubId={isClubMode ? clubId : undefined} />}

      {/* Edit Participant Drawer */}
      <EditParticipantDrawer
        participantId={selectedPartId}
        onClose={() => setSelectedPartId(null)}
      />

      {/* Import CSV Modal */}
      {isImportOpen && !isClubMode && <ImportModal isOpen={isImportOpen} onClose={() => { setIsImportOpen(false); triggerRefresh(); }} />}

      {/* Reassign Participants Modal */}
      {isReassignOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-30 p-4">
          <form onSubmit={handleReassignSubmit} className="bg-card w-full max-w-md rounded-xl shadow-xl border border-border overflow-hidden animate-scale-in text-foreground">
            <div className="p-5 border-b border-border bg-secondary/10 flex justify-between items-center">
              <span className="font-bold text-sm">Reassign Participants</span>
              <button
                type="button"
                onClick={() => { setIsReassignOpen(false); setReassignPartId(''); setReassignTargetCatId(''); setReassignEligibility(null); }}
                className="p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Select Participant</label>
                <select
                  required
                  value={reassignPartId}
                  onChange={(e) => setReassignPartId(e.target.value)}
                  className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-xs focus:outline-none text-foreground"
                >
                  <option value="">Choose participant...</option>
                  {participants.map(p => {
                    const currentCatId = mappings.find((m: any) => m.participant_id === p.id)?.category_id;
                    const currentCatName = categories.find(c => c.id === currentCatId)?.name || 'Unassigned';
                    return (
                      <option key={p.id} value={p.id}>
                        {p.full_name} ({p.gender}, {p.weight}kg) • Currently: {currentCatName}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Target Category</label>
                <select
                  required
                  value={reassignTargetCatId}
                  onChange={(e) => setReassignTargetCatId(e.target.value)}
                  className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-xs focus:outline-none text-foreground"
                >
                  <option value="">Choose destination category...</option>
                  {categories.filter(c => c.status !== 'Closed').map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.min_weight}-{c.max_weight}kg){isCategoryInCompetition(c.id) ? ' — In Competition' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {reassignEligibility && (
                <div className={`p-3.5 border rounded-lg flex gap-2 text-xs ${
                  reassignEligibility.eligible
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30'
                    : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/30'
                }`}>
                  <AlertCircle className="h-4.5 w-4.5 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">{reassignEligibility.eligible ? 'Ready for Assignment' : 'Eligibility Flag Warning'}</span>
                    <span className="block mt-0.5 leading-relaxed text-[11px]">{reassignEligibility.reason}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border flex justify-end gap-2 bg-secondary/5">
              <button
                type="button"
                onClick={() => { setIsReassignOpen(false); setReassignPartId(''); setReassignTargetCatId(''); setReassignEligibility(null); }}
                className="px-3 py-1.5 border border-border text-muted-foreground hover:text-foreground rounded-lg text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!reassignPartId || !reassignTargetCatId}
                className="px-4 py-1.5 bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/95 text-xs font-bold rounded-lg cursor-pointer"
              >
                Reassign Participant
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Clear All Participants Confirmation Modal */}
      {isClearConfirmOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-red-500/40 rounded-2xl shadow-2xl w-full max-w-md p-6 animate-scale-in">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
                <Trash2 className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <h3 className="font-bold text-base text-foreground">Clear All Participants?</h3>
                <p className="text-xs text-muted-foreground mt-0.5">This will permanently delete all participants from the database. This cannot be undone.</p>
              </div>
            </div>
            <div className="bg-red-500/8 border border-red-500/20 rounded-lg px-4 py-3 mb-5 text-xs text-red-400">
              ⚠️ All participant records, category assignments, and related data will be removed.
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setIsClearConfirmOpen(false)}
                disabled={isClearing}
                className="px-4 py-2 bg-secondary border border-border hover:bg-secondary/80 text-foreground rounded-lg text-xs font-bold cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={isClearing}
                onClick={async () => {
                  setIsClearing(true);
                  try {
                    const count = await db.participants.deleteAll(userEmail || 'Admin');
                    setParticipants([]);
                    setMappings([]);
                    setSelectedIds([]);
                    setSelectedPartId(null);
                    setIsClearConfirmOpen(false);
                    triggerRefresh();
                    await loadData();
                    alert(`✅ Successfully cleared ${count} participants.`);
                  } catch (e: any) {
                    alert(`❌ Failed to clear participants: ${e.message}`);
                  } finally {
                    setIsClearing(false);
                  }
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-60"
              >
                {isClearing ? (
                  <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Clearing...</>
                ) : (
                  <><Trash2 className="h-3.5 w-3.5" /> Yes, Delete All</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================= */}
      {/* CLUB STATS MODAL                                        */}
      {/* ======================================================= */}
      {isClubStatsOpen && canModify && (
        <div className="fixed inset-0 z-[100] p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto flex items-start justify-center">
          <div className="bg-card w-full max-w-3xl border border-border shadow-2xl rounded-2xl flex flex-col shrink-0 my-auto mt-8 mb-8">
            <div className="p-4 border-b border-border bg-secondary/15 flex items-center justify-between sticky top-0 bg-card z-10 rounded-t-2xl">
              <h3 className="font-extrabold text-sm uppercase tracking-wider flex items-center gap-2 text-foreground">
                <Award className="h-4 w-4 text-primary" /> Club Registration Statistics
              </h3>
              <button onClick={() => setIsClubStatsOpen(false)} className="p-1 hover:bg-secondary rounded-md text-muted-foreground transition">
                <X className="h-4 w-4" />
              </button>
            </div>
            
            <div className="p-4">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="bg-secondary/30">
                  <tr>
                    <th className="p-3 font-bold text-muted-foreground uppercase text-[10px] tracking-wider rounded-tl-lg">Club / Dojo</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase text-[10px] tracking-wider text-center">Male</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase text-[10px] tracking-wider text-center">Female</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase text-[10px] tracking-wider text-center border-r border-border/50">Total Athletes</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase text-[10px] tracking-wider text-center">Kumite Entries</th>
                    <th className="p-3 font-bold text-muted-foreground uppercase text-[10px] tracking-wider text-center">Kata Entries</th>
                    <th className="p-3 font-bold text-primary uppercase text-[10px] tracking-wider text-center rounded-tr-lg">Total Entries</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {(() => {
                    const stats = [...clubs, { id: '', name: 'Independent (No Club)' }].map(club => {
                      const clubParticipants = participants.filter(p => 
                        (club.id === '' ? !p.club_id : p.club_id === club.id) && 
                        p.status !== 'Cancelled' && 
                        !p.deleted_at
                      );
                      
                      const kumiteCount = clubParticipants.filter(p => p.isKumite).length;
                      const kataCount = clubParticipants.filter(p => p.isKata).length;
                      
                      const maleCount = clubParticipants.filter(p => p.gender?.toLowerCase().startsWith('m')).length;
                      const femaleCount = clubParticipants.filter(p => p.gender?.toLowerCase().startsWith('f')).length;
                      const totalAthletes = clubParticipants.length;

                      return {
                        clubName: club.name,
                        male: maleCount,
                        female: femaleCount,
                        athletes: totalAthletes,
                        kumite: kumiteCount,
                        kata: kataCount,
                        total: kumiteCount + kataCount
                      };
                    })
                    .filter(stat => stat.athletes > 0)
                    .sort((a, b) => b.athletes - a.athletes);

                    const totalMale = stats.reduce((sum, stat) => sum + stat.male, 0);
                    const totalFemale = stats.reduce((sum, stat) => sum + stat.female, 0);
                    const totalAthletes = stats.reduce((sum, stat) => sum + stat.athletes, 0);
                    const totalKumite = stats.reduce((sum, stat) => sum + stat.kumite, 0);
                    const totalKata = stats.reduce((sum, stat) => sum + stat.kata, 0);
                    const totalEntries = stats.reduce((sum, stat) => sum + stat.total, 0);

                    return (
                      <>
                        {stats.map((stat, idx) => (
                          <tr key={idx} className="hover:bg-secondary/20 transition-colors">
                            <td className="p-3 font-bold text-foreground">{stat.clubName}</td>
                            <td className="p-3 font-medium text-muted-foreground text-center">{stat.male}</td>
                            <td className="p-3 font-medium text-muted-foreground text-center">{stat.female}</td>
                            <td className="p-3 font-bold text-foreground text-center border-r border-border/50">{stat.athletes}</td>
                            <td className="p-3 font-medium text-muted-foreground text-center">{stat.kumite}</td>
                            <td className="p-3 font-medium text-muted-foreground text-center">{stat.kata}</td>
                            <td className="p-3 font-black text-primary text-center bg-primary/5">{stat.total}</td>
                          </tr>
                        ))}
                        <tr className="bg-secondary/40 border-t-2 border-border font-black text-foreground">
                          <td className="p-3 text-right uppercase tracking-wider text-xs">Total</td>
                          <td className="p-3 text-center">{totalMale}</td>
                          <td className="p-3 text-center">{totalFemale}</td>
                          <td className="p-3 text-center border-r border-border/50">{totalAthletes}</td>
                          <td className="p-3 text-center">{totalKumite}</td>
                          <td className="p-3 text-center">{totalKata}</td>
                          <td className="p-3 text-center text-primary bg-primary/10">{totalEntries}</td>
                        </tr>
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-border bg-secondary/10 flex justify-end sticky bottom-0 bg-card rounded-b-2xl">
              <button onClick={() => setIsClubStatsOpen(false)} className="px-5 py-2 bg-primary text-primary-foreground hover:bg-primary/95 rounded-lg text-xs font-bold cursor-pointer">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ParticipantsPage() {
  return <ParticipantsContent />;
}
