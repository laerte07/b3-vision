import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

const AppLayout = () => (
  <div className="flex min-h-screen">
    <Sidebar />
    <main className="flex-1 ml-64 p-8 max-w-[1400px]">
      <Outlet />
    </main>
  </div>
);

export default AppLayout;
