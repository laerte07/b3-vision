import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, Scale, Calculator, GitBranch,
  FileText, Settings, LogOut, TrendingUp, Brain, Wallet,
  LineChart, ChevronLeft, ChevronRight, Menu, X, Pin, PinOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';

const navItems = [
  { path: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/app/portfolio', label: 'Carteira', icon: Briefcase },
  { path: '/app/rebalancing', label: 'Rebalanceamento', icon: Scale },
  { path: '/app/contributions', label: 'Aportes', icon: Wallet },
  { path: '/app/rentabilidade', label: 'Rentabilidade', icon: LineChart },
  { path: '/app/valuations', label: 'Valuations', icon: Calculator },
  { path: '/app/score', label: 'Score', icon: Brain },
  { path: '/app/correlation', label: 'Correlação', icon: GitBranch },
  { path: '/app/reports', label: 'Relatórios', icon: FileText },
  { path: '/app/settings', label: 'Configurações', icon: Settings },
];

interface SidebarState {
  /** Visual width: true = narrow icon strip */
  collapsed: boolean;
  mobileOpen: boolean;
}

const SidebarContext = createContext<SidebarState>({ collapsed: true, mobileOpen: false });
export const useSidebarState = () => useContext(SidebarContext);

export const SidebarProvider = ({ children }: { children: ReactNode }) => {
  const location = useLocation();
  const isMobile = useIsMobile();

  // pinned = user manually locked sidebar open
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // collapsed = icon-only strip (when not pinned and not hovered)
  const expanded = pinned || hovered;
  const collapsed = isMobile ? false : !expanded;

  return (
    <SidebarContext.Provider value={{ collapsed, mobileOpen }}>
      {children}
      <SidebarNav
        pinned={pinned}
        setPinned={setPinned}
        hovered={hovered}
        setHovered={setHovered}
        expanded={expanded}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        isMobile={isMobile}
      />
    </SidebarContext.Provider>
  );
};

interface SidebarNavProps {
  pinned: boolean;
  setPinned: (v: boolean) => void;
  hovered: boolean;
  setHovered: (v: boolean) => void;
  expanded: boolean;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  isMobile: boolean;
}

const SidebarNav = ({ pinned, setPinned, hovered, setHovered, expanded, mobileOpen, setMobileOpen, isMobile }: SidebarNavProps) => {
  const location = useLocation();
  const { signOut } = useAuth();

  const showLabels = isMobile || expanded;

  const navContent = (
    <>
      {/* Logo */}
      <div className={cn(
        'flex items-center h-14 border-b border-sidebar-border shrink-0',
        !showLabels ? 'justify-center px-2' : 'px-4 justify-between'
      )}>
        <Link to="/dashboard" className="flex items-center gap-2.5 group">
          <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
          </div>
          {showLabels && (
            <span className="text-sm font-semibold text-foreground tracking-tight whitespace-nowrap sidebar-label-enter">Fortuna</span>
          )}
        </Link>
        {isMobile && (
          <button onClick={() => setMobileOpen(false)} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              title={!showLabels ? item.label : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-md text-[13px] font-medium transition-all duration-150 relative group whitespace-nowrap',
                !showLabels ? 'justify-center px-2 py-2' : 'px-3 py-[7px]',
                isActive
                  ? 'text-primary bg-primary/[0.08]'
                  : 'text-sidebar-foreground hover:text-foreground hover:bg-sidebar-accent'
              )}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-primary rounded-r-full" />
              )}
              <item.icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
              {showLabels && <span className="sidebar-label-enter">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-2 py-2 border-t border-sidebar-border space-y-0.5 shrink-0">
        {!isMobile && (
          <button
            onClick={() => setPinned(!pinned)}
            title={pinned ? 'Desafixar menu' : 'Fixar menu aberto'}
            className={cn(
              'flex items-center gap-2.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors w-full whitespace-nowrap',
              !showLabels ? 'justify-center px-2 py-2' : 'px-3 py-[7px]'
            )}
          >
            {pinned
              ? <PinOff className="h-4 w-4 shrink-0" />
              : <Pin className="h-4 w-4 shrink-0" />
            }
            {showLabels && <span>{pinned ? 'Desafixar' : 'Fixar menu'}</span>}
          </button>
        )}
        <button
          onClick={signOut}
          className={cn(
            'flex items-center gap-2.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors w-full whitespace-nowrap',
            !showLabels ? 'justify-center px-2 py-2' : 'px-3 py-[7px]'
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {showLabels && <span>Sair</span>}
        </button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <>
        <button
          onClick={() => setMobileOpen(true)}
          className="fixed top-3 left-3 z-50 h-9 w-9 flex items-center justify-center rounded-lg bg-card border border-border/50 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Abrir menu"
        >
          <Menu className="h-4 w-4" />
        </button>
        {mobileOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
        )}
        <aside
          className={cn(
            'fixed left-0 top-0 h-screen w-64 bg-sidebar flex flex-col z-[70] border-r border-sidebar-border transition-transform duration-300 ease-in-out',
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {navContent}
        </aside>
      </>
    );
  }

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'fixed left-0 top-0 h-screen bg-sidebar flex flex-col z-50 border-r border-sidebar-border transition-all duration-250 ease-in-out overflow-hidden',
        expanded ? 'w-56' : 'w-[60px]'
      )}
    >
      {navContent}
    </aside>
  );
};

export default SidebarNav;
