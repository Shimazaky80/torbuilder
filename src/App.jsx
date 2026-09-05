import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { SuperAdmin } from './pages/SuperAdmin';
import { Suppliers } from './pages/Suppliers';
import { Clients } from './pages/Clients';
import { LibraryItems } from './pages/LibraryItems';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ToastProvider } from './context/ToastContext';
import './App.css';

function App() {
  return (
    <ToastProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <div className="app-container">
                  <Sidebar />
                  <main className="main-content">
                    <Routes>
                      <Route path="dashboard" element={<Dashboard />} />
                      <Route path="" element={<Navigate to="dashboard" replace />} />
                      <Route path="super-admin" element={<SuperAdmin />} />
                      <Route path="clients" element={<Clients />} />
                      <Route path="suppliers" element={<Suppliers />} />
                      <Route path="services" element={<Navigate to="/library-items" replace />} />
                      <Route path="library-items" element={<LibraryItems />} />
                      <Route path="packages" element={<div>Packages (Coming Soon)</div>} />
                      <Route path="itineraries" element={<div>Itineraries (Coming Soon)</div>} />
                      <Route path="tariffs" element={<div>Tariffs (Coming Soon)</div>} />
                      <Route path="analytics" element={<div>Analytics (Coming Soon)</div>} />
                      <Route path="users" element={<div>Users (Coming Soon)</div>} />
                      <Route path="settings" element={<div>Settings (Coming Soon)</div>} />
                      <Route path="*" element={<Navigate to="dashboard" replace />} />
                    </Routes>
                  </main>
                </div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Router>
    </ToastProvider>
  );
}

export default App;
