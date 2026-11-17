import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

// Session tokens live in httpOnly cookies, so page scripts can never read them.
// The access cookie covers the whole site; the refresh cookie is only sent to
// the auth routes, which keeps it off every other request.
export const ACCESS_COOKIE = 'cs_access';
export const REFRESH_COOKIE = 'cs_refresh';
const REFRESH_PATH = '/api/auth';

const base = {
  httpOnly: true,
  sameSite: 'lax',                       // blocks cross-site POSTs from carrying the session
  secure: env.nodeEnv === 'production',  // HTTPS only in production
};

/** Lifetime of a token, taken from its own `exp` claim, so cookies match the JWT. */
const msUntilExpiry = (token) => Math.max(0, jwt.decode(token).exp * 1000 - Date.now());

export function setSessionCookies(res, { accessToken, refreshToken }) {
  res.cookie(ACCESS_COOKIE, accessToken, { ...base, path: '/', maxAge: msUntilExpiry(accessToken) });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...base, path: REFRESH_PATH, maxAge: msUntilExpiry(refreshToken) });
}

export function clearSessionCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_PATH });
}

/** Reads one cookie from a raw Cookie header (used for socket.io handshakes). */
export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try { return decodeURIComponent(rest.join('=')); } catch { return null; }
    }
  }
  return null;
}
