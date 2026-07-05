import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthContext, type AuthStatus } from './lib/auth';
import { checkAuth, setUnauthorizedHandler } from './lib/api';
import { AppShell } from './components/AppShell';
import { Splash } from './components/Splash';
import { Unlock } from './screens/Unlock';
import { Today } from './screens/Today';
import { Timeline } from './screens/Timeline';
import { Growth } from './screens/Growth';
import { Machines } from './screens/Machines';
import { DeviceConsole } from './screens/DeviceConsole';
import { Settings } from './screens/Settings';

export function App() {
  const [status, setStatus] = useState<AuthStatus>('checking');

  const runCheck = useCallback(() => {
    let cancelled = false;
    setStatus('checking');
    checkAuth()
      .then((ok) => { if (!cancelled) setStatus(ok ? 'authed' : 'unauthed'); })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, []);

  // Boot: is there already a live session?
  useEffect(() => runCheck(), [runCheck]);

  // Any protected 401 during the session drops us back to the unlock gate.
  useEffect(() => {
    setUnauthorizedHandler(() => setStatus('unauthed'));
    return () => setUnauthorizedHandler(null);
  }, []);

  const ctx = {
    status,
    onAuthed: () => setStatus('authed'),
    signOut: () => setStatus('unauthed'),
    retry: runCheck,
  };

  return (
    <AuthContext.Provider value={ctx}>
      {status === 'checking' && <Splash />}
      {status === 'error' && (
        <Splash
          message="Can't reach the hub."
          action={{ label: 'Retry', onClick: runCheck }}
        />
      )}
      {status === 'unauthed' && <Unlock onAuthed={ctx.onAuthed} />}
      {status === 'authed' && (
        <Routes>
          {/* Device console (Chat/Terminal) is full-screen — no tab bar. */}
          <Route path="/machines/:id" element={<DeviceConsole />} />
          <Route
            path="*"
            element={
              <AppShell>
                <Routes>
                  <Route path="/today" element={<Today />} />
                  <Route path="/timeline" element={<Timeline />} />
                  <Route path="/growth" element={<Growth />} />
                  <Route path="/machines" element={<Machines />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/today" replace />} />
                </Routes>
              </AppShell>
            }
          />
        </Routes>
      )}
    </AuthContext.Provider>
  );
}
