import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

const AppLayout = () => (
  <div className="flex min-h-screen">
    <Sidebar />
    <main className="flex-1 ml-60 p-6 lg:p-8 max-w-[1440px] transition-all duration-300">
      <Outlet />
    </main>
  </div>
);

export default AppLayout;
