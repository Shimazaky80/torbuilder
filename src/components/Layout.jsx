import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export const Layout = () => {
  return (
    <div id="main-app-layout">
      <Sidebar />
      <main className="main-content-area">
        <Outlet />
      </main>
    </div>
  );
};
