import { createContext, useContext } from 'react';

/** Auth boot/session lifecycle. `checking` shows a splash so protected UI never flashes. */
export type AuthStatus = 'checking' | 'authed' | 'unauthed' | 'error';

export interface AuthContextValue {
  status: AuthStatus;
  /** Mark the session live (called by Unlock after a successful PIN). */
  onAuthed: () => void;
  /** End the session (Settings → Lock). */
  signOut: () => void;
  /** Retry the boot check after an `error` (hub was unreachable). */
  retry: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthContext.Provider>');
  return ctx;
}
