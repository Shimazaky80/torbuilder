import { createContext, useContext } from 'react';

/* The session lives in SessionProvider and is read here. Split from the
   provider because a file that exports both a component and a function cannot
   hot-reload, and every page that needs to know who is signed in should not
   have to import the component that renders them. */

export const SessionContext = createContext(null);

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider');
  return context;
};

export default useSession;
