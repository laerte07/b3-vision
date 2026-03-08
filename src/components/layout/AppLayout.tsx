import { Outlet } from 'react-router-dom';
import { SidebarProvider, useSidebarState } from './Sidebar';
import { useIsMobile } from '@/hooks/use-mobile';

const MainContent = () => {
  const isMobile = useIsMobile();
  const { collapsed } = useSidebarState();

  return (
    <main
      className={
        isMobile
          ? 'w-full min-h-screen px-4 py-4 pt-14'
          : `min-h-screen p-6 lg:p-8 2xl:px-12 transition-all duration-300 ${collapsed ? 'ml-[60px]' : 'ml-56'}`
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
