'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { TournamentProvider, useTournament } from '@/context/TournamentContext';
import Sidebar3 from './Sidebar3';
import TopBar from './TopBar';
import ImportModal from './ImportModal';
import LoginPage from '@/app/login/page';

function LayoutShellContent({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const pathname = usePathname();
  const { isLoggedIn, userRole } = useTournament();

  // Auto-minimize sidebar on mobile or on control page: start closed on small screens
  useEffect(() => {
    const isControlPage = window.location.pathname.includes('/control');
    const mq = window.matchMedia('(min-width: 768px)');
    
    // Default open on desktop, unless it's the control dashboard
    if (isControlPage) {
      setIsSidebarOpen(false);
    } else {
      setIsSidebarOpen(mq.matches);
    }

    setMounted(true);

    const handler = (e: MediaQueryListEvent) => {
      // Don't auto-open if we are on the control page
      if (!window.location.pathname.includes('/control')) {
        setIsSidebarOpen(e.matches);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const handleOpenImport = () => setIsImportOpen(true);
    window.addEventListener('open-import-modal', handleOpenImport);
    return () => window.removeEventListener('open-import-modal', handleOpenImport);
  }, []);

  // Auto-close sidebar when navigating on mobile, or when going to Scoreboard Control
  useEffect(() => {
    const isMobile = !window.matchMedia('(min-width: 768px)').matches;
    const isControlPage = pathname?.includes('/control');
    if (isMobile || isControlPage) {
      setIsSidebarOpen(false);
    }
  }, [pathname]);

  // Normalize pathname to handle trailing slashes from static hosts (e.g. /login/ vs /login)
  const normalizedPath = pathname?.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname;
  const isPublicOrAuthRoute = normalizedPath === '/' || normalizedPath === '/login' || normalizedPath?.startsWith('/public') || normalizedPath?.startsWith('/auth') || normalizedPath?.startsWith('/display') || normalizedPath?.startsWith('/draws/print-preview') || normalizedPath?.startsWith('/registration');

  // Enforce Active Tournament Context
  const [isDbReady, setIsDbReady] = useState(isPublicOrAuthRoute);

  useEffect(() => {
    if (isPublicOrAuthRoute) return;

    let isMounted = true;

    // Safety timeout: If DB doesn't load within 5 seconds, force it to ready 
    // so the user doesn't get stuck on an infinite spinner if network hangs.
    const fallbackTimer = setTimeout(() => {
      if (isMounted) {
        console.warn("DB load timed out, forcing UI to render.");
        setIsDbReady(true);
      }
    }, 5000);

    import('@/db/dbClient').then(async ({ dbManager }) => {
      try {
        let activeDb = dbManager.getActiveTournament();
        
        // If memory was cleared by a hard reload, try to restore from localStorage
        if (!activeDb) {
          const activeId = localStorage.getItem('ts_active_tournament_id');
          if (activeId) {
            const { localStore } = await import('@/db/localStore');
            activeDb = await localStore.loadTournament(activeId);
            if (activeDb) {
               const { setActiveTournamentDb } = await import('@/db/mockStore');
               setActiveTournamentDb(activeDb);
            }
          }
        }

        if (!isMounted) return;
        clearTimeout(fallbackTimer);

        if (!activeDb) {
          window.location.href = '/';
        } else {
          setIsDbReady(true);
        }
      } catch (err) {
        console.error("Error loading tournament DB:", err);
        if (isMounted) {
          clearTimeout(fallbackTimer);
          setIsDbReady(true); // Don't block the UI forever
        }
      }
    }).catch(err => {
      console.error("Failed to import DB modules:", err);
      if (isMounted) {
        clearTimeout(fallbackTimer);
        setIsDbReady(true);
      }
    });

    return () => { 
      isMounted = false; 
      clearTimeout(fallbackTimer);
    };
  }, [pathname, isPublicOrAuthRoute]);

  // If public or auth route, render directly without admin frame
  if (isPublicOrAuthRoute) {
    return (
      <div className="flex h-screen w-screen overflow-hidden print:h-auto print:w-auto print:overflow-visible print:block bg-background text-foreground">
        <main className="flex-1 overflow-y-auto print:overflow-visible bg-background focus:outline-none relative text-foreground">
          {children}
        </main>
      </div>
    );
  }

  // Prevent rendering anything until mounted to avoid hydration mismatch on isLoggedIn
  if (!mounted) {
    return (
       <div className="flex items-center justify-center h-screen bg-background text-foreground">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
       </div>
    );
  }

  // If not logged in, force render the login screen
  if (!isLoggedIn) {
    return <LoginPage />;
  }

  // Prevent rendering protected admin routes until DB is loaded into memory
  if (!isPublicOrAuthRoute && !isDbReady) {
    return (
       <div className="flex items-center justify-center h-screen bg-background text-foreground">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
       </div>
    );
  }

  // Standard Admin layout for logged in Admin/Co-Admin
  return (
    <div id="admin-layout-wrapper" className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Mobile backdrop overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* KarateTech 3.0 Sidebar */}
      <Sidebar3
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {/* Content Shell */}
      <div id="admin-layout-shell" className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <TopBar
          onImportClick={() => setIsImportOpen(true)}
          onMenuToggle={() => setIsSidebarOpen((prev) => !prev)}
        />

        {/* Page Body */}
        <main id="admin-layout-main" className="flex-1 overflow-y-auto bg-background focus:outline-none relative">
          {children}
        </main>
      </div>

      {/* Global Import Modal */}
      <ImportModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} />
    </div>
  );
}

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <TournamentProvider>
      <LayoutShellContent>{children}</LayoutShellContent>
    </TournamentProvider>
  );
}
