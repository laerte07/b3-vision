import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, Scale, Calculator, GitBranch,
  FileText, Settings, LogOut, TrendingUp, Brain, Wallet,
  LineChart, ChevronLeft, ChevronRight, Menu, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useState, useEffect, createContext, useContext } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/portfolio', label: 'Carteira', icon: Briefcase },
  { path: '/rebalancing', label: 'Rebalanceamento', icon: Scale },
  { path: '/contributions', label: 'Aportes', icon: Wallet },
  { path: '/rentabilidade', label: 'Rentabilidade', icon: LineChart },
  { path: '/valuations', label: 'Valuations', icon: Calculator },
  { path: '/score', label: 'Score', icon: Brain },
  { path: '/correlation', label: 'Correlação', icon: GitBranch },
  { path: '/reports', label: 'Relatórios', icon: FileText },
  { path: '/settings', label: 'Configurações', icon: Settings },
];

// Context to share sidebar state with layout
export const SidebarContext = createContext({ collapsed: false, mobileOpen: false });

const Sidebar = () => {
  const location = useLocation();
  const { signOut } = useAuth();
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Close mobile drawer on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const navContent = (
    <>
      {/* Logo */}
      <div className={cn(
        'flex items-center h-14 border-b border-sidebar-border shrink-0',
        collapsed && !isMobile ? 'justify-center px-2' : 'px-4 justify-between'
      )}>
        <Link to="/dashboard" className="flex items-center gap-2.5 group">
          <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
          </div>
          {(!collapsed || isMobile) && (
            <span className="text-sm font-semibold text-foreground tracking-tight">Fortuna</span>
          )}
        </Link>
        {isMobile && (
          <button onClick={() => setMobileOpen(false)} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              title={collapsed && !isMobile ? item.label : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-md text-[13px] font-medium transition-all duration-150 relative group',
                collapsed && !isMobile ? 'justify-center px-2 py-2' : 'px-3 py-[7px]',
                isActive
                  ? 'text-primary bg-primary/[0.08]'
                  : 'text-sidebar-foreground hover:text-foreground hover:bg-sidebar-accent'
              )}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-primary rounded-r-full" />
              )}
              <item.icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
              {(!collapsed || isMobile) && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-2 py-2 border-t border-sidebar-border space-y-0.5 shrink-0">
        {!isMobile && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              'flex items-center gap-2.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors w-full',
              collapsed ? 'justify-center px-2 py-2' : 'px-3 py-[7px]'
            )}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            {!collapsed && <span>Recolher</span>}
          </button>
        )}
        <button
          onClick={signOut}
          className={cn(
            'flex items-center gap-2.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors w-full',
            collapsed && !isMobile ? 'justify-center px-2 py-2' : 'px-3 py-[7px]'
          )}
        >
          <LogOut className="h-4 w-4" />
          {(!collapsed || isMobile) && <span>Sair</span>}
        </button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <SidebarContext.Provider value={{ collapsed: false, mobileOpen }}>
        {/* Mobile trigger */}
        <button
          onClick={() => setMobileOpen(true)}
          className="fixed top-3 left-3 z-50 h-9 w-9 flex items-center justify-center rounded-lg bg-card border border-border/50 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Abrir menu"
        >
          <Menu className="h-4.5 w-4.5" />
        </button>

        {/* Backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
        )}

        {/* Drawer */}
        <aside
          className={cn(
            'fixed left-0 top-0 h-screen w-64 bg-sidebar flex flex-col z-[70] border-r border-sidebar-border transition-transform duration-300 ease-in-out',
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {navContent}
        </aside>
      </SidebarContext.Provider>
    );
  }

  return (
    <SidebarContext.Provider value={{ collapsed, mobileOpen: false }}>
      <aside
        className={cn(
          'fixed left-0 top-0 h-screen bg-sidebar flex flex-col z-50 transition-all duration-300 ease-in-out border-r border-sidebar-border',
          collapsed ? 'w-[60px]' : 'w-56'
        )}
      >
        {navContent}
      </aside>
    </SidebarContext.Provider>
  );
};

export default Sidebar;
