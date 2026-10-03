import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { ResetPassword } from './pages/ResetPassword';
import { SuperAdmin } from './pages/SuperAdmin';
import { Suppliers } from './pages/Suppliers';
import { Clients } from './pages/Clients';
import { Itineraries } from './pages/Itineraries';
import { ItineraryBuilder } from './pages/ItineraryBuilder';
import { Finance } from './pages/Finance';
import { Settings } from './pages/Settings';
import { LibraryItems } from './pages/LibraryItems';
import { Analytics } from './pages/Analytics';
import { Tariffs } from './pages/Tariffs';
import { Packages } from './pages/Packages';
import { PackageBuilder } from './pages/PackageBuilder';
import { PackageView } from './pages/PackageView';
import { PartnerPortal } from './pages/PartnerPortal';
import { PartnerRegister } from './pages/PartnerRegister';
import { PartnerLogin } from './pages/PartnerLogin';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ToastProvider } from './context/ToastContext';
import { NavigationGuardProvider } from './context/NavigationGuardContext';
import './App.css';

function App() {
  return (
    <ToastProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/partner-register" element={<PartnerRegister />} />
          <Route path="/partner/login" element={<PartnerLogin />} />
          <Route path="/partner-login" element={<Navigate to="/partner/login" replace />} />
          <Route path="/partner/*" element={<ProtectedRoute accountType="partner"><PartnerPortal /></ProtectedRoute>} />
          <Route
            path="/*"
            element={
              <ProtectedRoute accountType="tenant">
                <NavigationGuardProvider>
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
                        <Route path="packages" element={<Packages />} />
                        <Route path="packages/view/:packageId" element={<PackageView />} />
                        <Route path="packages/builder/:packageId" element={<PackageBuilder />} />
                        <Route path="itineraries" element={<Itineraries />} />
                        <Route path="itineraries/builder" element={<ItineraryBuilder />} />
                        <Route path="finance" element={<Finance />} />
                        {/* The module was renamed Invoices -> Finance; keep old links working. */}
                        <Route path="invoices" element={<Navigate to="/finance" replace />} />
                        <Route path="tariffs" element={<Tariffs />} />
                        <Route path="analytics" element={<Analytics />} />
                        <Route path="users" element={<div>Users (Coming Soon)</div>} />
                        <Route path="settings" element={<Settings />} />
                        <Route path="*" element={<Navigate to="dashboard" replace />} />
                      </Routes>
                    </main>
                  </div>
                </NavigationGuardProvider>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Router>
    </ToastProvider>
  );
}

export default App;
