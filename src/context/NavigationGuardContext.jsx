import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';

const NavigationGuardContext = createContext(null);

export const NavigationGuardProvider = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();

  // id -> { labelRef, dirtyRef, saveFnRef }
  const guardsRef = useRef({});
  const pendingPathRef = useRef(null);
  const [pendingPath, setPendingPath] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pageResetToken, setPageResetToken] = useState(0);

  const registerGuard = useCallback((id, label) => {
    if (!guardsRef.current[id]) {
      guardsRef.current[id] = {
        labelRef: { current: label || 'your changes' },
        dirtyRef: { current: false },
        saveFnRef: { current: null }
      };
    } else {
      guardsRef.current[id].labelRef.current = label || guardsRef.current[id].labelRef.current;
    }
    return {
      setDirty: (v) => { guardsRef.current[id].dirtyRef.current = !!v; },
      setSaveFn: (fn) => { guardsRef.current[id].saveFnRef.current = fn || null; },
      unregister: () => { delete guardsRef.current[id]; }
    };
  }, []);

  const isAnyDirty = useCallback(() =>
    Object.values(guardsRef.current).some((g) => g.dirtyRef.current),
  []);

  const getActiveGuard = useCallback(() =>
    Object.values(guardsRef.current).find((g) => g.dirtyRef.current) || null,
  []);

  /* A menu click on the page already open asks for that page as it first
     opened — filters cleared, editors closed, list fetched again — not a journey
     to where the operator is already standing. The router has nowhere to go, so
     the pages under this token are remounted and the scroll returns to the top. */
  const resetCurrentPage = useCallback(() => {
    const scroller = document.querySelector('main.main-content');
    if (scroller) scroller.scrollTop = 0;
    setPageResetToken((token) => token + 1);
  }, []);

  const performNavigation = useCallback(() => {
    const path = pendingPathRef.current;
    pendingPathRef.current = null;
    setPendingPath(null);
    if (!path) return;
    if (location.pathname === path) {
      resetCurrentPage();
      return;
    }
    navigate(path);
  }, [navigate, location.pathname, resetCurrentPage]);

  const requestNavigate = useCallback((path) => {
    if (!isAnyDirty()) {
      if (location.pathname === path) {
        resetCurrentPage();
        return;
      }
      navigate(path);
      return;
    }
    pendingPathRef.current = path;
    setPendingPath(path);
  }, [navigate, isAnyDirty, location.pathname, resetCurrentPage]);

  const handleCancel = useCallback(() => {
    pendingPathRef.current = null;
    setPendingPath(null);
  }, []);

  const handleDiscard = useCallback(() => {
    Object.values(guardsRef.current).forEach((g) => { g.dirtyRef.current = false; });
    setSaving(false);
    performNavigation();
  }, [performNavigation]);

  const handleSaveAndLeave = useCallback(async () => {
    const guard = getActiveGuard();
    const saveFn = guard?.saveFnRef?.current || null;
    if (!saveFn) {
      handleDiscard();
      return;
    }
    setSaving(true);
    let proceed = true;
    try {
      const result = await saveFn();
      if (result === false) proceed = false;
    } catch {
      proceed = false;
    }
    setSaving(false);
    if (!proceed) {
      pendingPathRef.current = null;
      setPendingPath(null);
      return;
    }
    Object.values(guardsRef.current).forEach((g) => { g.dirtyRef.current = false; });
    performNavigation();
  }, [getActiveGuard, handleDiscard, performNavigation]);

  useEffect(() => {
    const handler = (e) => {
      if (isAnyDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isAnyDirty]);

  const dirtyLabel = pendingPath ? (getActiveGuard()?.labelRef?.current || 'your changes') : '';

  return (
    <NavigationGuardContext.Provider value={{ registerGuard, requestNavigate, pageResetToken }}>
      {children}
      {pendingPath && (
        <div className="modal-overlay">
          <div className="modal-content unsaved-modal">
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <AlertTriangle size={22} color="#d97706" />
                Unsaved changes
              </h2>
              <button className="close-btn" onClick={handleCancel} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <p style={{ color: '#475569', lineHeight: 1.6 }}>
              You have unsaved changes to <strong>{dirtyLabel}</strong>. What would you like
              to do before leaving this page?
            </p>
            <div className="form-actions">
              <button type="button" className="secondary-btn" onClick={handleCancel} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="secondary-btn danger-btn" onClick={handleDiscard} disabled={saving}>
                Discard &amp; Leave
              </button>
              <button type="button" className="primary-btn" onClick={handleSaveAndLeave} disabled={saving}>
                {saving ? 'Saving…' : 'Save & Leave'}
              </button>
            </div>
          </div>
        </div>
      )}
    </NavigationGuardContext.Provider>
  );
};

const useNavigationGuard = () => useContext(NavigationGuardContext);

export const usePageGuard = (id, label, isDirty, saveFn) => {
  const { registerGuard } = useNavigationGuard();
  const handleRef = useRef(null);

  useEffect(() => {
    if (!handleRef.current) handleRef.current = registerGuard(id, label);
    handleRef.current.setDirty(isDirty);
    handleRef.current.setSaveFn(saveFn);
    return () => { handleRef.current?.unregister(); handleRef.current = null; };
  }, [id, label, isDirty, saveFn, registerGuard]);

  return useNavigationGuard();
};

export { useNavigationGuard };