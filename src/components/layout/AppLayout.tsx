import { Outlet } from 'react-router-dom';
import Sidebar, { SidebarContext } from './Sidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { useContext } from 'react';

const MainContent = () => {
  const isMobile = useIsMobile();
  const { collapsed } = useContext(SidebarContext);

  return (
    <main
      className={
        isMobile
          ? 'w-full min-h-screen p-4 pt-14'
          : `min-h-screen p-6 lg:p-8 max-w-[1440px] transition-all duration-300 ${collapsed ? 'ml-[60px]' : 'ml-56'}`
      }
    >
      <Outlet />
    </main>
  );
};

const AppLayout = () => (
  <div className="flex min-h-screen">
    <Sidebar />
    <MainContent />
  </div>
);

export default AppLayout;
