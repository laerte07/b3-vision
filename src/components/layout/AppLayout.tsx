import { Outlet } from 'react-router-dom';
import { SidebarProvider, useSidebarState } from './Sidebar';
import { useIsMobile } from '@/hooks/use-mobile';

const MainContent = () => {
  const isMobile = useIsMobile();
  const { collapsed } = useSidebarState();

  return (
    <main
      style={!isMobile ? { marginLeft: collapsed ? 60 : 224 } : undefined}
      className={
        isMobile
          ? 'w-full min-h-screen px-4 py-4 pt-14'
          : 'flex-1 min-h-screen py-6 px-6 lg:px-8 2xl:px-12 transition-[margin] duration-300 ease-in-out'
      }
    >
      <Outlet />
    </main>
  );
};

const AppLayout = () => (
  <SidebarProvider>
    <div className="flex min-h-screen w-full">
      <MainContent />
    </div>
  </SidebarProvider>
);

export default AppLayout;
