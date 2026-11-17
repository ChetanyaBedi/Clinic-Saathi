import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, unwrap } from '../lib/api.js';
import { connectSocket, disconnectSocket } from '../lib/socket.js';

const AuthContext = createContext(null);

const EMPTY_SESSION = { user: null, clinic: null, subscription: null, entitlements: null, doctor: null, patient: null, homePath: null };

/**
 * Session state. Everything that decides access — role, clinic, branch, plan
 * features — comes from GET /auth/me; the client only mirrors it for UX.
 * The session cookie is set by the server, so sign-in only has to ask /auth/me who we are.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(EMPTY_SESSION);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const d = unwrap(await api.get('/auth/me'));
    setSession(d);
    connectSocket();
    return d;
  }, []);

  // On first load the cookie decides. An expired access cookie is refreshed
  // transparently by the API client, so a returning user stays signed in.
  useEffect(() => {
    loadMe().catch(() => setSession(EMPTY_SESSION)).finally(() => setLoading(false));
  }, [loadMe]);

  // Refresh failed mid-session: drop the user, and the route guard sends them to sign in.
  useEffect(() => {
    const expired = () => { disconnectSocket(); setSession(EMPTY_SESSION); };
    window.addEventListener('cs:session-expired', expired);
    return () => window.removeEventListener('cs:session-expired', expired);
  }, []);

  const login = async (identifier, password) => {
    await api.post('/auth/login', { identifier, password });
    return loadMe();
  };

  /** Patient OTP sign-in. Returns { needsRegistration, registrationToken } for new numbers. */
  const patientVerify = async ({ clinicSlug, phone, code }) => {
    const d = unwrap(await api.post('/auth/patient/verify-otp', { clinicSlug, phone, code }));
    if (d.needsRegistration) return d;
    return loadMe();
  };
  const patientRegister = async (payload) => {
    await api.post('/auth/patient/register', payload);
    return loadMe();
  };

  const logout = async () => {
    const wasPatient = session.user?.role === 'PATIENT';
    const slug = session.clinic?.slug;
    try { await api.post('/auth/logout'); } catch { /* the session may already be gone */ }
    disconnectSocket();
    setSession(EMPTY_SESSION);
    return wasPatient ? `/patient/login${slug ? `?clinic=${slug}` : ''}` : '/login';
  };

  const hasFeature = useCallback((feature) => {
    const f = session.entitlements?.features || [];
    return f.includes('*') || f.includes(feature);
  }, [session.entitlements]);

  const value = useMemo(
    () => ({ ...session, loading, login, patientVerify, patientRegister, logout, hasFeature, refreshMe: loadMe }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, loading, hasFeature]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
