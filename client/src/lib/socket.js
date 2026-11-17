import { io } from 'socket.io-client';
import { api } from './api.js';

let socket = null;
let retryingAuth = false;

export function connectSocket() {
  if (socket) return socket;
  // The session cookie rides along on the websocket handshake, so no token is sent by hand.
  // Default transports: long-polling first, then an upgrade to websocket. Vercel's
  // rewrites carry the polling requests to Render, while websockets cannot pass through them.
  socket = io('/');
  socket.on('connect', () => { retryingAuth = false; });
  // The access cookie expires after 15 minutes. If the handshake is rejected, refresh once and reconnect.
  socket.on('connect_error', async (err) => {
    if (err.message !== 'unauthorized' || retryingAuth) return;
    retryingAuth = true;
    try {
      await api.post('/auth/refresh');
      socket.connect();
    } catch { /* session is over; the app signs the user out */ }
  });
  return socket;
}

export function getSocket() { return socket; }

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}

/** Subscribe to one or more socket events for the life of a component. */
export function onSocket(events, handler) {
  const s = getSocket();
  if (!s) return () => {};
  const list = Array.isArray(events) ? events : [events];
  list.forEach((e) => s.on(e, handler));
  return () => list.forEach((e) => s.off(e, handler));
}
