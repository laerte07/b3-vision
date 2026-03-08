import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Briefcase,
  Scale,
  Calculator,
  GitBranch,
  FileText,
  Settings,
  LogOut,
  TrendingUp,
  Brain,
  Wallet,
  LineChart,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useState } from 'react';

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

const Sidebar = () => {
  const location = useLocation();
  const { signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen bg-sidebar flex flex-col z-50 transition-all duration-300 ease-in-out border-r border-sidebar-border',
        collapsed ? 'w-[68px]' : 'w-60'
      )}
    >
      {/* Logo */}
      <div className={cn('flex items-center border-b border-sidebar-border h-16', collapsed ? 'justify-center px-2' : 'px-5')}>
        <Link to="/dashboard" className="flex items-center gap-2.5 group">
          <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
            <TrendingUp className="h-4 w-4 text-primary" />
          </div>
          {!collapsed && (
            <span className="text-base font-bold text-foreground tracking-tight">
              Fortuna
            </span>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto mt-2">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              title={collapsed ? item.label : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-md text-[13px] font-medium transition-all duration-150 relative',
                collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2',
                isActive
                  ? 'text-primary bg-primary/[0.08]'
                  : 'text-sidebar-foreground hover:text-foreground hover:bg-sidebar-accent'
              )}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-primary rounded-r-full" />
              )}
              <item.icon className="h-[16px] w-[16px] shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-2 border-t border-sidebar-border space-y-0.5">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            'flex items-center gap-2.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors w-full',
            collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2'
          )}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          {!collapsed && <span>Recolher</span>}
        </button>
        <button
          onClick={signOut}
          className={cn(
            'flex items-center gap-2.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors w-full',
            collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2'
          )}
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && <span>Sair</span>}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
