import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { ResetPassword } from './pages/ResetPassword';
import { SuperAdmin } from './pages/SuperAdmin';
import { Suppliers } from './pages/Suppliers';
import { Clients } from './pages/Clients';
import { GuideTeam } from './pages/GuideTeam';
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
import { SessionProvider } from './components/SessionProvider';
import { RequireAccess, RequirePlatform } from './components/RequireAccess';
import { Users } from './pages/Users';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './context/ToastContext';
import { NavigationGuardProvider, useNavigationGuard } from './context/NavigationGuardContext';
import { useSession } from './hooks/useSession';
import './App.css';

/* The pages under the sidebar. Keyed on the menu-reset token: clicking the
   entry of the page already open moves that token, and the remount is what
   clears a filter, closes an editor and fetches the list again — the router
   alone would stay exactly where the operator is standing. */
/* Switching tenant has to discard the mounted page, not merely re-read it: each
   page loads once when it opens and holds those rows after that. For a company
   account the key never changes, so nothing remounts that did not before. */
const ScopedPages = () => {
  const { isPlatformAdmin, viewingCompany } = useSession();
  return <AppPages key={isPlatformAdmin ? `tenant:${viewingCompany || 'none'}` : 'own'} />;
};

const AppPages = () => {
  const { pageResetToken } = useNavigationGuard();

  /* Each page stands behind its module. A page opens at 'read' and decides what
     a person may change inside it, because a guide who can read the trip they
     are on must not be bounced to a panel — the builder simply has nothing to
     click. Only whole modules that are work, not sight — the catalogue, the
     money, the people — are withheld. */
  return (
    <ErrorBoundary key={pageResetToken}>
      <Routes>
        <Route path="dashboard" element={<RequireAccess module="dashboard"><Dashboard /></RequireAccess>} />
        <Route path="" element={<Navigate to="dashboard" replace />} />
        <Route path="super-admin" element={<RequirePlatform><SuperAdmin /></RequirePlatform>} />
        <Route path="clients" element={<RequireAccess module="clients"><Clients /></RequireAccess>} />
        <Route path="suppliers" element={<RequireAccess module="suppliers"><Suppliers /></RequireAccess>} />
        <Route path="guide-team" element={<RequireAccess module="guide_team"><GuideTeam /></RequireAccess>} />
        <Route path="services" element={<Navigate to="/library-items" replace />} />
        {/* The catalogue is an editing page. A consultant still reads contracted
            prices where they work — the itinerary sidebar, the rate card, the
            charge dialog — so withholding the editor hides nothing they need. */}
        <Route path="library-items" element={<RequireAccess module="library" level="write"><LibraryItems /></RequireAccess>} />
        <Route path="packages" element={<RequireAccess module="packages"><Packages /></RequireAccess>} />
        <Route path="packages/view/:packageId" element={<RequireAccess module="packages"><PackageView /></RequireAccess>} />
        <Route path="packages/builder/:packageId" element={<RequireAccess module="packages"><PackageBuilder /></RequireAccess>} />
        <Route path="itineraries" element={<RequireAccess module="itineraries"><Itineraries /></RequireAccess>} />
        <Route path="itineraries/builder" element={<RequireAccess module="itineraries"><ItineraryBuilder /></RequireAccess>} />
        <Route path="finance" element={<RequireAccess module="finance"><Finance /></RequireAccess>} />
        {/* The module was renamed Invoices -> Finance; keep old links working. */}
        <Route path="invoices" element={<Navigate to="/finance" replace />} />
        <Route path="tariffs" element={<RequireAccess module="tariffs"><Tariffs /></RequireAccess>} />
        <Route path="analytics" element={<RequireAccess module="analytics"><Analytics /></RequireAccess>} />
        <Route path="users" element={<RequireAccess module="users"><Users /></RequireAccess>} />
        <Route path="settings" element={<RequireAccess module="settings"><Settings /></RequireAccess>} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </ErrorBoundary>
  );
};

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
                <SessionProvider>
                  <NavigationGuardProvider>
                    <div className="app-container">
                      <Sidebar />
                      <main className="main-content">
                        <ScopedPages />
                      </main>
                    </div>
                  </NavigationGuardProvider>
                </SessionProvider>
              </ProtectedRoute>
            }
          />
        </Routes>
      </Router>
    </ToastProvider>
  );
}

export default App;
